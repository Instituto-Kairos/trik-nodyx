/**
 * Módulo RPG (trik) — rotas das Fases 1 e 2.
 * Ver plans/fase-um.md (seções 3, 4, 5) e plans/fase-dois.md (Fluxo 2).
 *
 * Dois plugins exportados (mesmo padrão de routes/octoguard.ts):
 *  - trikPlayerPlugin : préfixe /api/v1/trik (requireAuth) — consumido
 *    pelos modais de /registro, /plaquinha e /levelup.
 *  - trikAdminPlugin  : préfixe /api/v1/admin/trik (adminOnly) — configura
 *    qual canal é #fichas (registro) / #plaquinhas (plaquinha) / anúncios,
 *    e lê o estado de XP de um tópico (trik_threads, marcado via
 *    routes/forums.ts PATCH /threads/:id — não daqui).
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import path from 'path'
import { db } from '../config/database'
import { adminOnly } from '../middleware/adminOnly'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import * as ChannelModel from '../models/channel'
import * as TrikModel from '../models/trik'
import * as TrikMastery from '../models/trikMastery'
import { getPlayerAndCharacters, submitRegistro } from '../services/trik/registro'
import { submitPlaquinha } from '../services/trik/registro/plaquinha'
import { submitLevelup } from '../services/trik/xp/levelup'
import { postTrikMessage, getTrikBotProfile, updateTrikBotProfile } from '../services/trik/bot'
import { botSafe } from '../services/trik/text'
import { scanBuffer } from '../services/fileScanner'

const ALLOWED_MIME_AVATAR = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// ── Resolve instance community (cached) — mesmo padrão de routes/admin.ts ───

let _communityId: string | null = null

async function getCommunityId(): Promise<string | null> {
  if (_communityId) return _communityId
  const slug = process.env.NODYX_COMMUNITY_SLUG
  if (slug) {
    const { rows } = await db.query(`SELECT id FROM communities WHERE slug = $1`, [slug])
    if (rows[0]) { _communityId = rows[0].id; return _communityId }
  }
  const { rows } = await db.query(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  if (rows[0]) { _communityId = rows[0].id; return _communityId }
  return null
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const TesteBody = z.object({
  channelId: z.string().uuid(),
})

const RegistroBody = z.object({
  channelId: z.string().uuid(),
  player: z.object({
    name:      z.string().min(1).max(100),
    pronouns:  z.string().max(50).optional(),
    birthDate: z.string().optional(),
  }).optional(),
  character: z.object({
    name:                z.string().min(1).max(100),
    pronouns:            z.string().max(50).optional(),
    birthDate:           z.string().optional(),
    faceclaimName:       z.string().max(100).optional(),
    faceclaimBirthDate:  z.string().optional(),
    // Só http(s): z.string().url() aceita também javascript:/data:, e o link é
    // guardado e mostrado como <a href> na tela admin de registros.
    fichaLink:           z.string().url().max(500)
      .refine(u => /^https?:\/\//i.test(u), 'O link da ficha precisa começar com http:// ou https://'),
    pantheon:            z.string().max(100).optional(),
    divineBond:          z.string().max(100).optional(),
    divineGift:          z.string().max(240).optional(),
    principlesPicked:    z.array(z.enum(['mente', 'coracao', 'corpo'])),
    conductPicked:       z.array(z.enum(['presenca', 'proposito', 'sangue'])),
  }),
})

// Admin: correção de um registro já gravado. PATCH parcial — só as chaves
// presentes são escritas (ver buildSet em models/trik.ts). `.strict()` para
// que um campo escrito errado no formulário vire 400 em vez de virar silêncio.
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data precisa ser AAAA-MM-DD')

const naoVazio = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict().refine(
    body => Object.keys(body).length > 0,
    'Nada para atualizar',
  )

const RegistroPlayerPatch = naoVazio({
  name:         z.string().min(1).max(100).optional(),
  pronouns:     z.string().max(50).nullable().optional(),
  birthDate:    ISO_DATE.nullable().optional(),
  permitActive: z.boolean().optional(),
})

const RegistroCharacterPatch = naoVazio({
  name:               z.string().min(1).max(100).optional(),
  pronouns:           z.string().max(50).nullable().optional(),
  birthDate:          ISO_DATE.nullable().optional(),
  faceclaimName:      z.string().max(100).nullable().optional(),
  faceclaimBirthDate: ISO_DATE.nullable().optional(),
  // Mesma regra do RegistroBody: o link vira <a href> na tela admin, e
  // z.string().url() sozinho aceita javascript:/data:.
  fichaLink:          z.string().url().max(500)
    .refine(u => /^https?:\/\//i.test(u), 'O link da ficha precisa começar com http:// ou https://')
    .optional(),
  pantheon:           z.string().max(100).nullable().optional(),
  divineBond:         z.string().max(100).nullable().optional(),
  divineGift:         z.string().max(240).nullable().optional(),
})

const RegistroIdParams = z.object({ id: z.string().uuid() })

const PlaquinhaBody = z.object({
  channelId:         z.string().uuid(),
  characterId:       z.string().uuid(),
  templateName:      z.string().min(1).max(200),
  templateSignature: z.string().min(1),
})

const BotProfileBody = z.object({
  bio:       z.string().max(500).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
})

const ChannelPurposesBody = z.object({
  entries: z.array(z.object({
    channelId: z.string().uuid(),
    purpose:   z.enum(['registro', 'plaquinha', 'levelup', 'anuncio']),
  })),
})

// Sem aptitudeId nesta fase — orçamento de Aptidões ainda não definido
// (ver plans/fase-dois-passo-a-passo.md, passo 0). channelId + gate de
// canal seguem o mesmo padrão de /registro e /plaquinha (fase-dois.md
// deixa o gate como "opcional", mas a consistência com o resto do módulo
// venceu: mesmo framework, mesma validação server-side).
const LevelupBody = z.object({
  channelId:   z.string().uuid(),
  characterId: z.string().uuid(),
  deltas: z.object({
    conductPresenca:   z.number().int().min(0).default(0),
    conductProposito:  z.number().int().min(0).default(0),
    conductSangue:     z.number().int().min(0).default(0),
    principlesMente:   z.number().int().min(0).default(0),
    principlesCoracao: z.number().int().min(0).default(0),
    principlesCorpo:   z.number().int().min(0).default(0),
  }),
  preferenceId: z.string().uuid().optional(),
  goalId:       z.string().uuid().optional(),
})

// 'character' = nível do personagem (applyXpInTx). 'weapon'
// (maestria, #treino) e 'knowledge' (aulas, #aula) = curvas lidas por
// models/trikMastery.ts: reqMastery/reqEducation são os "treinos/aulas
// necessários" pra sair de cada nível (0/omitido = nível máximo), e goalXp
// não é usado nesses dois types (o admin manda 1, só porque a coluna é NOT
// NULL). reward_conduct/principles/preferences/goal só fazem sentido pra
// 'character'; pros outros dois ficam sempre 0/false.
const XpType = z.enum(['character', 'knowledge', 'weapon'])

const XpLevelsQuery = z.object({
  type: XpType.default('character'),
})

const XpLevelsBody = z.object({
  type: XpType,
  levels: z.array(z.object({
    level:             z.number().int().min(1),
    goalXp:            z.number().int().min(1),
    rewardConduct:     z.number().int().min(0).default(0),
    rewardPrinciples:  z.number().int().min(0).default(0),
    rewardPreferences: z.number().int().min(0).default(0),
    rewardGoal:        z.boolean().default(false),
    // Sem .default(): omitido continua omitido no payload repassado ao model
    // (que trata como 0). SMALLINT no banco → teto 32767.
    reqMastery:        z.number().int().min(0).max(32767).optional(),
    reqEducation:      z.number().int().min(0).max(32767).optional(),
  })),
})

// Catálogo de armas (#treino) / matérias (#aula) — cadastro rápido no admin.
const CatalogType = z.enum(TrikMastery.MASTERY_KINDS)
const CatalogQuery = z.object({ type: CatalogType })
const CatalogBody = z.object({
  type: CatalogType,
  // Nome só de símbolos (ex.: "!!!") normaliza pra vazio — nunca casaria com
  // nenhuma hashtag, então cadastrar seria um registro morto.
  name: z.string().trim().min(1).max(60)
    .refine(n => TrikMastery.normalizeCatalogName(n) !== '', 'O nome precisa ter letras ou números'),
  // Só arma tem categoria (obrigatória); pra matéria é ignorada. Fica só no
  // banco — não vira hashtag, serve pra validar bônus por categoria (Fase 3).
  category: z.string().trim().max(60).optional(),
}).superRefine((body, ctx) => {
  if (body.type === 'weapon' && !TrikMastery.normalizeCatalogName(body.category ?? '')) {
    ctx.addIssue({ code: 'custom', path: ['category'], message: 'Informe a categoria da arma (ex.: Espadas)' })
  }
})
const CatalogIdParams = z.object({ id: z.string().uuid() })

// Catálogo de tipos de bônus (trik_bonus) — cadastro rápido no admin, mesmo
// padrão do catálogo de armas/matérias acima. bonus_value é texto (não
// número) porque a Fase 3 ainda não fechou o formato do valor (pode ser
// "+1", "x2" etc.) — só o banco (VARCHAR(3)) e o schema aqui.
const BonusBody = z.object({
  bonusType:  z.string().trim().min(1).max(42),
  bonusValue: z.string().trim().min(1).max(3),
  isCategory: z.boolean().default(false),
})
const BonusIdParams = z.object({ id: z.string().uuid() })

// ═══════════════════════════════════════════════════════════════════════════
// PLAYER PLUGIN — préfixe /api/v1/trik (requireAuth)
// ═══════════════════════════════════════════════════════════════════════════

export async function trikPlayerPlugin(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // Perfil público do bot Trik (avatar + bio) — qualquer membro logado pode
  // ver, não só admin (ao contrário de GET /admin/trik/bot, que também
  // devolve isso mas é só pra tela de edição). Consumido pelo widget de
  // popup ao clicar em "Trik" na sidebar de membros.
  app.get('/bot', async (_request, reply) => {
    const bot = await getTrikBotProfile()
    if (!bot) return reply.code(503).send({ error: 'Bot indisponível' })
    return reply.send({ bot })
  })

  // /teste: comando de teste (sem modal) — o bot Trik marca (@menciona)
  // quem mandou, só pra validar a notificação/link de @menção. Sem gate de
  // canal (trik_channels) de propósito: funciona em qualquer canal — e por
  // isso é só pra admin: aberto a qualquer membro, dava pra fazer o bot postar
  // em canal privado/somente-leitura e disparar notificações sem limite.
  app.post('/teste', {
    preHandler: [adminOnly, validate({ body: TesteBody })],
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof TesteBody>
    await postTrikMessage(body.channelId, `🧪 Teste de marcação: @${request.user!.username}`)
    return reply.send({ ok: true })
  })

  app.get('/players/me', async (request, reply) => {
    const data = await getPlayerAndCharacters(request.user!.userId)
    return reply.send(data)
  })

  app.get('/characters/mine', async (request, reply) => {
    const { characters } = await getPlayerAndCharacters(request.user!.userId)
    return reply.send({ characters })
  })

  // GET /api/v1/trik/aliases?q= — alvos mencionáveis por nome de personagem.
  //
  // Alimenta o autocomplete de `@` no chat e no fórum. Cada item traz o par
  // "personagem · jogador" porque é a PESSOA que valida qual jogador quis
  // marcar: se dois jogadores têm um "Kaelen", voltam os dois e ela escolhe.
  //
  // O cliente insere `@[<alias>](<username>)` no texto; quem notifica é
  // resolveMentions() (utils/mentions.ts), que lê o username entre parênteses.
  // Ou seja, este endpoint é só descoberta — nenhuma autorização depende dele.
  app.get('/aliases', async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const { q } = request.query as { q?: string }
    // Um `q` longo não é um caso de uso, é um scan de tabela disfarçado.
    const termo = (q ?? '').trim().slice(0, 100)

    const aliases = await TrikModel.searchMentionableAliases(communityId, termo)
    return reply.send({ aliases })
  })

  app.post('/registro', {
    preHandler: validate({ body: RegistroBody }),
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof RegistroBody>
    // Revalida o gate de canal no servidor — o gate do client (commandRegistry)
    // é só UX, não segurança (ver plans/fase-um.md, seção 3).
    if (!await TrikModel.isChannelPurpose(body.channelId, 'registro')) {
      return reply.code(403).send({ error: 'Este canal não está configurado para /registro', code: 'FORBIDDEN_CHANNEL' })
    }
    const result = await submitRegistro(request.user!.userId, body)
    if (!result.ok) {
      const status = result.code === 'DUPLICATE_NAME' ? 409 : 400
      return reply.code(status).send({ error: result.message, code: result.code })
    }
    await postTrikMessage(
      body.channelId,
      // O nome é digitado pelo jogador: botSafe evita HTML e @menção em massa. O
      // @username do autor é a menção intencional e fica de fora.
      `✅ <strong>${botSafe(result.character.name)}</strong> foi registrado(a) com sucesso por @${request.user!.username}.`
    )
    return reply.code(201).send({ player: result.player, character: result.character })
  })

  app.post('/plaquinha', {
    preHandler: validate({ body: PlaquinhaBody }),
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof PlaquinhaBody>
    if (!await TrikModel.isChannelPurpose(body.channelId, 'plaquinha')) {
      return reply.code(403).send({ error: 'Este canal não está configurado para /plaquinha', code: 'FORBIDDEN_CHANNEL' })
    }
    const result = await submitPlaquinha(request.user!.userId, body.characterId, body.templateName, body.templateSignature)
    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 400
      return reply.code(status).send({ error: result.message, code: result.code })
    }
    await postTrikMessage(
      body.channelId,
      `🏷️ Plaquinha de <strong>${botSafe(result.character.name)}</strong> atualizada: “${botSafe(result.character.template_name ?? '')}”.`
    )
    return reply.send({ character: result.character })
  })

  // GET /levelup/state: personagens do jogador com pontos disponíveis
  // (Conduct/Principles/Preferences) ou Objetivo desbloqueado (has_goal)
  // ainda não escolhido — os únicos elegíveis a aparecer no modal /levelup.
  app.get('/levelup/state', async (request, reply) => {
    const { characters } = await getPlayerAndCharacters(request.user!.userId)

    const withBudget = await Promise.all(characters.map(async c => {
      const progress = await TrikModel.getOrCreateProgress(c.id)
      const bonuses  = await TrikModel.getCharacterBonuses(c.id)
      return {
        character: c,
        progress,
        bonuses,
        available: {
          conduct:     progress.points_conduct     - progress.spent_conduct,
          principles:  progress.points_principles  - progress.spent_principles,
          preferences: progress.points_preferences - progress.spent_preferences,
        },
      }
    }))

    const eligible = withBudget.filter(w =>
      w.available.conduct > 0 || w.available.principles > 0 || w.available.preferences > 0 ||
      (w.progress.has_goal && !w.bonuses?.goal_id)
    )

    const [preferences, goals] = await Promise.all([
      TrikModel.listPreferences(),
      TrikModel.listGoals(),
    ])
    return reply.send({ characters: eligible, preferences, goals })
  })

  app.post('/levelup', {
    preHandler: validate({ body: LevelupBody }),
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof LevelupBody>
    if (!await TrikModel.isChannelPurpose(body.channelId, 'levelup')) {
      return reply.code(403).send({ error: 'Este canal não está configurado para /levelup', code: 'FORBIDDEN_CHANNEL' })
    }
    const result = await submitLevelup(request.user!.userId, body)
    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 400
      return reply.code(status).send({ error: result.message, code: result.code })
    }
    return reply.send({ character: result.character })
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN PLUGIN — préfixe /api/v1/admin/trik (adminOnly)
// ═══════════════════════════════════════════════════════════════════════════

export async function trikAdminPlugin(app: FastifyInstance) {
  app.addHook('preHandler', adminOnly)

  // Tabela de registros (só leitura): jogadores → personagens, com a plaquinha
  // e o nível/xp de cada um — o que o /registro e o /plaquinha gravaram.
  app.get('/registros', async (_request, reply) => {
    return reply.send({ players: await TrikModel.listRegistros() })
  })

  // Correção de um registro. O /registro grava uma vez e não reabre
  // (upsertPlayer é DO NOTHING), então sem isto um nome ou um link de ficha
  // digitado errado só se conserta no banco.
  //
  // `permitActive` (o "Passe" na tela) entra pelo patch do jogador: é a única
  // escrita dessa coluna no código todo — antes disso ela ficava no DEFAULT
  // FALSE da migration pra todo mundo.
  app.patch('/registros/players/:id', {
    preHandler: validate({ params: RegistroIdParams, body: RegistroPlayerPatch }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof RegistroIdParams>
    const patch = request.body as z.infer<typeof RegistroPlayerPatch>
    const player = await TrikModel.updateRegistroPlayer(id, patch)
    if (!player) return reply.code(404).send({ error: 'Jogador não encontrado', code: 'NOT_FOUND' })
    return reply.send({ player })
  })

  app.patch('/registros/characters/:id', {
    preHandler: validate({ params: RegistroIdParams, body: RegistroCharacterPatch }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof RegistroIdParams>
    const patch = request.body as z.infer<typeof RegistroCharacterPatch>
    try {
      const character = await TrikModel.updateRegistroCharacter(id, patch)
      if (!character) return reply.code(404).send({ error: 'Personagem não encontrado', code: 'NOT_FOUND' })
      return reply.send({ character })
    } catch (err: any) {
      // UNIQUE (player_id, name): o mesmo jogador já tem um personagem com
      // esse nome. Dois jogadores PODEM ter homônimos, então não é global.
      if (err?.code === '23505') {
        return reply.code(409).send({ error: 'Esse jogador já tem um personagem com esse nome', code: 'DUPLICATE_NAME' })
      }
      throw err
    }
  })

  app.get('/channels', async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const [channels, purposes] = await Promise.all([
      ChannelModel.listByCommunity(communityId),
      TrikModel.getChannelPurposes(),
    ])

    const purposesByChannel = new Map<string, string[]>()
    for (const p of purposes) {
      const list = purposesByChannel.get(p.channel_id) ?? []
      list.push(p.purpose)
      purposesByChannel.set(p.channel_id, list)
    }

    return reply.send({
      channels: channels.map(c => ({
        id: c.id,
        name: c.name,
        purposes: purposesByChannel.get(c.id) ?? [],
      })),
    })
  })

  app.put('/channels', {
    preHandler: validate({ body: ChannelPurposesBody }),
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof ChannelPurposesBody>
    await TrikModel.setChannelPurposes(body.entries, request.user!.userId)
    return reply.send({ ok: true })
  })

  // ── Curva de XP (trik_progression) — consumida por applyXpInTx
  // (models/trik.ts) a cada cena que gera xp. Substituição total da curva
  // do type na mesma transação (DELETE + INSERT), mesmo padrão de
  // setChannelPurposes acima — a curva inteira é pequena, reconciliar
  // linha a linha não compensa a complexidade.

  app.get('/xp-levels', {
    preHandler: validate({ query: XpLevelsQuery }),
  }, async (request, reply) => {
    const query = request.query as z.infer<typeof XpLevelsQuery>
    const levels = await TrikModel.listXpLevels(query.type)
    return reply.send({ levels })
  })

  app.put('/xp-levels', {
    preHandler: validate({ body: XpLevelsBody }),
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof XpLevelsBody>
    const levelNumbers = body.levels.map(l => l.level)
    if (new Set(levelNumbers).size !== levelNumbers.length) {
      return reply.code(400).send({ error: 'Nível repetido na curva', code: 'VALIDATION' })
    }
    await TrikModel.setXpLevels(body.type, body.levels)
    return reply.send({ ok: true })
  })

  // ── Catálogo de armas (#treino) / matérias (#aula) ─────────────────────────
  // Só o que estiver cadastrado aqui conta no Fluxo 1: hashtag sem match é
  // ignorada (processScenePost). Duplicata é case/acento-insensitive — o
  // mesmo critério que faz `#espadalonga` bater com "Espada Longa".

  app.get('/catalog', {
    preHandler: validate({ query: CatalogQuery }),
  }, async (request, reply) => {
    const { type } = request.query as z.infer<typeof CatalogQuery>
    return reply.send({ entries: await TrikMastery.listCatalog(type) })
  })

  app.post('/catalog', {
    preHandler: validate({ body: CatalogBody }),
  }, async (request, reply) => {
    const { type, name, category } = request.body as z.infer<typeof CatalogBody>
    const existing = await TrikMastery.findCatalogByName(type, name)
    if (existing) {
      return reply.code(409).send({ error: `Já existe "${existing.name}" no catálogo`, code: 'DUPLICATE_NAME' })
    }
    const entry = type === 'weapon'
      ? await TrikMastery.createCatalogEntry(type, name, category)
      : await TrikMastery.createCatalogEntry(type, name)
    return reply.code(201).send({ entry })
  })

  app.delete('/catalog/:id', {
    preHandler: validate({ params: CatalogIdParams, query: CatalogQuery }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof CatalogIdParams>
    const { type } = request.query as z.infer<typeof CatalogQuery>
    if (!await TrikMastery.deleteCatalogEntry(type, id)) return reply.code(404).send({ error: 'Item não encontrado', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  // ── Catálogo de tipos de bônus (trik_aptitudes/preferences/goals.bonus_id) ──

  app.get('/bonus', async (_request, reply) => {
    return reply.send({ entries: await TrikModel.listBonus() })
  })

  app.post('/bonus', {
    preHandler: validate({ body: BonusBody }),
  }, async (request, reply) => {
    const { bonusType, bonusValue, isCategory } = request.body as z.infer<typeof BonusBody>
    const entry = await TrikModel.createBonus(bonusType, bonusValue, isCategory)
    return reply.code(201).send({ entry })
  })

  app.delete('/bonus/:id', {
    preHandler: validate({ params: BonusIdParams }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof BonusIdParams>
    if (!await TrikModel.deleteBonus(id)) return reply.code(404).send({ error: 'Item não encontrado', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  // GET /admin/trik/threads/:id — estado de XP de um tópico do fórum.
  // O toggle em si é feito por PATCH /api/v1/forums/threads/:id
  // (is_xp_enabled), restrito a owner/admin — ver routes/forums.ts.
  app.get('/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send({ enabled: await TrikModel.isXpThread(id) })
  })

  // ── Perfil do bot "Trik" (avatar + bio exibidos no chat/painel de membros) ──

  app.get('/bot', async (_request, reply) => {
    const bot = await getTrikBotProfile()
    if (!bot) return reply.code(503).send({ error: 'Bot indisponível' })
    return reply.send({ bot })
  })

  app.put('/bot', {
    preHandler: validate({ body: BotProfileBody }),
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof BotProfileBody>
    const bot = await updateTrikBotProfile(body)
    if (!bot) return reply.code(503).send({ error: 'Bot indisponível' })
    return reply.send({ bot })
  })

  app.post('/bot/avatar', async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })
    if (!ALLOWED_MIME_AVATAR.includes(data.mimetype)) {
      return reply.code(400).send({ error: 'Formato não suportado (JPEG, PNG, WebP, GIF)' })
    }

    // Buffer o arquivo pra escanear os magic bytes antes de gravar em disco
    // — mesmo padrão de POST /admin/branding/upload.
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk as Buffer)
    const fileBuffer = Buffer.concat(chunks)

    const scan = scanBuffer(fileBuffer, data.mimetype)
    if (!scan.ok) {
      return reply.code(400).send({ error: `Arquivo rejeitado: ${scan.reason}` })
    }

    const ext      = data.mimetype.split('/')[1].replace('jpeg', 'jpg')
    const filename = `${randomUUID()}.${ext}`
    const dir      = path.join(process.cwd(), 'uploads', 'trik-bot')
    mkdirSync(dir, { recursive: true })
    await import('fs/promises').then(fs => fs.writeFile(path.join(dir, filename), fileBuffer))

    return reply.send({ url: `/uploads/trik-bot/${filename}` })
  })
}
