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
import * as TrikNarrador from '../models/trikNarrador'
import * as TrikEffects from '../models/trikEffects'
import * as TrikInterests from '../models/trikInterests'
import * as TrikAu from '../models/trikAu'
import { syncGameWeek, dayAlerts } from '../services/trik/weather'
import { getCharacterSheet } from '../models/trikSheet'
import { getPlayerAndCharacters, submitRegistro } from '../services/trik/registro'
import { submitPlaquinha } from '../services/trik/registro/plaquinha'
import { submitLevelup } from '../services/trik/xp/levelup'
import { notifyLevelUp } from '../services/trik/xp'
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

const NarradorDistribuirBody = z.object({
  characterId: z.string().uuid(),
  xp:          z.number().int().positive().max(1_000_000),
})

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
    pantheonId:          z.string().uuid().optional(),
    divineBondId:        z.string().uuid().optional(),
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
  // Panteão e vínculo vêm do catálogo (trik_005), como no /registro: o texto
  // em trik_characters é só a cópia do nome, então não se edita direto —
  // senão o nome exibido e o pantheon_id de trik_character_bonuses divergem.
  // Os dois andam juntos: ausentes = não mexe (registro antigo de texto livre
  // fica como está); pantheonId null = limpa os dois.
  pantheonId:         z.string().uuid().nullable().optional(),
  divineBondId:       z.string().uuid().nullable().optional(),
  divineGift:         z.string().max(240).nullable().optional(),
})
  .refine(
    body => !('divineBondId' in body) || 'pantheonId' in body,
    'divineBondId precisa vir junto de pantheonId',
  )
  .refine(
    body => !body.divineBondId || !!body.pantheonId,
    'Escolha o panteão do vínculo divino',
  )

const RegistroIdParams = z.object({ id: z.string().uuid() })

const PlaquinhaBody = z.object({
  channelId:         z.string().uuid(),
  characterId:       z.string().uuid(),
  templateName:      z.string().min(1).max(200),
  templateSignature: z.string().min(1),
  // trik_014: 'au' grava num personagem do /registro-au. Mesmo comando e mesmo
  // canal — o modal lista os dois universos.
  universe:          z.enum(['main', 'au']).default('main'),
})

const BotProfileBody = z.object({
  bio:       z.string().max(500).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
})

const ChannelPurposesBody = z.object({
  entries: z.array(z.object({
    channelId: z.string().uuid(),
    purpose:   z.enum(['registro', 'plaquinha', 'levelup', 'anuncio', 'clima', 'alertas', 'registro-au']),
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
  naturalAptitudeId:  z.string().uuid().optional(),
  acquiredAptitudeId: z.string().uuid().optional(),
})

// /interesse (trik_012): mesmo canal do /levelup.
const InterestBody = z.object({
  channelId:   z.string().uuid(),
  characterId: z.string().uuid(),
  slot:        z.enum(TrikInterests.INTEREST_SLOTS),
  kind:        z.enum(TrikMastery.MASTERY_KINDS),
  category:    z.string().trim().min(1).max(60),
})

const INTEREST_ERRORS: Record<string, string> = {
  LOCKED_SLOT:      'Este slot de interesse ainda não foi liberado',
  WEEKLY_LIMIT:     'Este interesse já foi trocado nesta semana — a próxima troca abre no domingo',
  UNKNOWN_CATEGORY: 'Categoria não cadastrada',
  DUPLICATE:        'Os dois interesses não podem ter a mesma categoria',
  UNCHANGED:        'Esse já é o interesse atual',
}

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
    // Slots de aptidão que o nível libera (trik_010) — só 'character'. Sem
    // .default(), igual reqMastery: omitido = 0 no model.
    rewardNaturalAptitudes:  z.number().int().min(0).max(32767).optional(),
    rewardAcquiredAptitudes: z.number().int().min(0).max(32767).optional(),
    // Slots de interesse que o nível abre (trik_012) — só 'character'.
    rewardPrimaryInterest:   z.number().int().min(0).max(1).optional(),
    rewardSecondaryInterest: z.number().int().min(0).max(1).optional(),
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
  // Obrigatória pros dois tipos (matéria ganhou categoria na trik_010). Fica
  // só no banco — não vira hashtag, serve pra bônus por categoria (Fase 3).
  category: z.string().trim().max(60)
    .refine(c => TrikMastery.normalizeCatalogName(c) !== '', 'Informe a categoria (ex.: Espadas, Idiomas)'),
})
const CatalogIdParams = z.object({ id: z.string().uuid() })

// Catálogo de panteões/divindades (trik_005) — dropdowns do /registro. Os
// bônus são efeitos (EffectBody abaixo), não mais um campo do panteão.
const PantheonBody = z.object({ name: z.string().trim().min(1).max(100) })
const DeityBody = PantheonBody
const PantheonIdParams = z.object({ id: z.string().uuid() })

// ── Fase 3 (trik_010): catálogos com efeito, efeitos, listas desbloqueáveis,
// regiões e semana de jogo. Ver models/trikEffects.ts.

const BonusCatalogKind = z.enum(TrikEffects.BONUS_CATALOG_KINDS)
const BonusCatalogQuery = z.object({ kind: BonusCatalogKind })
const BonusCatalogBody = z.object({
  kind:     BonusCatalogKind,
  name:     z.string().trim().min(1).max(100),
  // Agrupador ("Mental", "Físico"…) escolhido num dropdown — obrigatório:
  // é por ele que o admin decide o que gera desconto nas validações.
  category: z.string().trim().min(1).max(50),
})
const BonusCategoryBody = z.object({
  kind:     BonusCatalogKind,
  category: z.string().trim().min(1).max(50),
})
const IdParams = z.object({ id: z.string().uuid() })

// Espelha os CHECKs de trik_effects (trik_010) pra devolver 400 com motivo
// legível — o banco continua sendo a última barreira (23514 → 400 também).
const EffectBody = z.object({
  ownerKind:         z.enum(TrikEffects.EFFECT_OWNER_KINDS),
  ownerId:           z.string().uuid(),
  effect:            z.enum(TrikEffects.EFFECTS),
  activity:          z.enum(TrikEffects.ACTIVITIES).default('todas'),
  weaponId:          z.string().uuid().nullable().default(null),
  knowledgeId:       z.string().uuid().nullable().default(null),
  weaponCategory:    z.string().trim().min(1).max(60).nullable().default(null),
  knowledgeCategory: z.string().trim().min(1).max(60).nullable().default(null),
  alertKind:         z.enum(TrikEffects.ALERT_KINDS).nullable().default(null),
  conditionKind:     z.enum(TrikEffects.CONDITION_KINDS).default('sempre'),
  conditionValue:    z.string().trim().nullable().default(null),
  value:             z.number().positive().max(999).nullable().default(null),
}).superRefine((b, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  const targets = [b.weaponId, b.knowledgeId, b.weaponCategory, b.knowledgeCategory, b.alertKind].filter(t => t !== null)
  if (targets.length > 1) issue('weaponId', 'Escolha no máximo um alvo')
  if ((b.weaponId || b.weaponCategory) && b.activity !== 'treino') issue('activity', 'Alvo de arma só vale em treino')
  if ((b.knowledgeId || b.knowledgeCategory) && b.activity !== 'aula') issue('activity', 'Alvo de matéria só vale em aula')

  const isAlert = TrikEffects.ALERT_EFFECTS.includes(b.effect)
  if (isAlert && !b.alertKind) issue('alertKind', 'Informe o tipo de alerta (calor, frio ou umidade)')
  if (!isAlert && b.alertKind) issue('alertKind', 'Tipo de alerta só vale em anula_alerta/sensibilidade')

  const isNumeric = TrikEffects.NUMERIC_EFFECTS.includes(b.effect)
  if (isNumeric && b.value === null) issue('value', 'Informe o valor')
  if (!isNumeric && b.value !== null) issue('value', 'Esse efeito não tem valor')

  const v = b.conditionValue ?? ''
  const conditionOk =
    ((b.conditionKind === 'sempre' || b.conditionKind === 'companhia') && b.conditionValue === null) ||
    (b.conditionKind === 'periodo' && (TrikEffects.PERIODS as readonly string[]).includes(v)) ||
    (b.conditionKind === 'clima'   && (TrikEffects.BONUS_CLIMATES as readonly string[]).includes(v))
  if (!conditionOk) issue('conditionValue', 'Condição inválida pra esse tipo')
})

const TraitBody = z.object({
  kind:   z.enum(TrikEffects.TRAIT_KINDS),
  itemId: z.string().uuid(),
})
const CharacterTraitParams = z.object({
  id:     z.string().uuid(),
  kind:   z.enum(TrikEffects.TRAIT_KINDS),
  itemId: z.string().uuid(),
})

const LocationBody = z.object({
  name:      z.string().trim().min(1).max(100),
  latitude:  z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})
const ThreadLocationBody = z.object({ locationId: z.string().uuid().nullable() })

// Domingo (semana dom–sáb), YYYY-MM-DD. O CHECK do banco confere de novo.
const GameWeekBody = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(d => new Date(`${d}T00:00:00Z`).getUTCDay() === 0, 'A semana começa no domingo'),
})

// Categorias que notificam todos os membros a cada post — substituição total.
const NotifyCategoriesBody = z.object({
  categoryIds: z.array(z.string().uuid()).max(500),
})

// /alias-au (trik_013). `]` e quebra de linha fechariam o `@[…]` da menção.
const AuAliasBody = z.object({
  name: z.string().trim().min(1).max(100).refine(n => !/[\]\n]/.test(n), 'O alias não pode ter "]" nem quebra de linha'),
})

// /registro-au (trik_014): mesma restrição de nome do alias AU (vira menção).
const RegistroAuBody = z.object({
  channelId: z.string().uuid(),
  name:      AuAliasBody.shape.name,
  fichaLink: z.string().url().max(500),
})

/** `?category=` das buscas de menção: id inválido/ausente = universo principal. */
async function auContext(category: string | undefined): Promise<boolean> {
  if (!category || !/^[0-9a-f-]{36}$/i.test(category)) return false
  return TrikAu.isAuCategory(category)
}

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

    const { q, category } = request.query as { q?: string; category?: string }
    // Um `q` longo não é um caso de uso, é um scan de tabela disfarçado.
    const termo = (q ?? '').trim().slice(0, 100)
    // Dentro do AU (trik_013) o personagem não existe: entram os aliases AU.
    const au = await auContext(category)

    const [narrador, aliases] = await Promise.all([
      TrikModel.narradorAlias(communityId, termo),
      au ? TrikAu.searchAuAliases(communityId, termo) : TrikModel.searchMentionableAliases(communityId, termo),
    ])
    return reply.send({ aliases: narrador ? [narrador, ...aliases] : aliases })
  })

  // GET /api/v1/trik/npcc?q= — tópicos da categoria NPCC para `@npcc:`.
  //
  // O cliente insere `@[<título>](npcc:<thread id>)`: renderiza como link pro
  // tópico e não notifica ninguém (resolveMentions ignora o prefixo `npcc:`).
  // Só descoberta, como /aliases.
  app.get('/npcc', async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const { q, category } = request.query as { q?: string; category?: string }
    const termo = (q ?? '').trim().slice(0, 100)

    const npccs = await TrikModel.searchNpccThreads(communityId, termo, 8, await auContext(category))
    return reply.send({ npccs })
  })

  // GET /api/v1/trik/npc?q= — imagens do álbum NPC da galeria para `@npc:`.
  //
  // Mesmo esquema do /npcc: o cliente insere `@[<título>](npc:<image id>)`,
  // que renderiza como link para /galeria/<id> e não notifica ninguém.
  app.get('/npc', async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const { q, category } = request.query as { q?: string; category?: string }
    const termo = (q ?? '').trim().slice(0, 100)

    const npcs = await TrikModel.searchNpcImages(communityId, termo, 8, await auContext(category))
    return reply.send({ npcs })
  })

  // ── /alias-au (trik_013): aliases livres do AU, sem limite e sem ficha ────

  app.get('/au-aliases', async (request, reply) => {
    return reply.send({ aliases: await TrikAu.listMyAuAliases(request.user!.userId) })
  })

  app.post('/au-aliases', {
    preHandler: validate({ body: AuAliasBody }),
  }, async (request, reply) => {
    const { name } = request.body as z.infer<typeof AuAliasBody>
    const alias = await TrikAu.createAuAlias(request.user!.userId, name)
    if (!alias) return reply.code(409).send({ error: 'Você já tem um alias AU com esse nome', code: 'DUPLICATE' })
    return reply.code(201).send({ alias })
  })

  app.delete('/au-aliases/:id', {
    preHandler: validate({ params: IdParams }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParams>
    const ok = await TrikAu.deleteAuAlias(request.user!.userId, id)
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'Alias não encontrado', code: 'NOT_FOUND' })
  })

  // ── /registro-au (trik_014): personagens AU — nome + ficha, xp sem nível ──

  app.get('/au-characters', async (request, reply) => {
    return reply.send({ characters: await TrikAu.listMyAuCharacters(request.user!.userId) })
  })

  app.post('/registro-au', {
    preHandler: validate({ body: RegistroAuBody }),
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof RegistroAuBody>
    if (!await TrikModel.isChannelPurpose(body.channelId, 'registro-au')) {
      return reply.code(403).send({ error: 'Este canal não está configurado para /registro-au', code: 'FORBIDDEN_CHANNEL' })
    }
    const character = await TrikAu.createAuCharacter(request.user!.userId, body.name, body.fichaLink)
    if (!character) return reply.code(409).send({ error: 'Você já tem um personagem AU com esse nome', code: 'DUPLICATE_NAME' })
    await postTrikMessage(
      body.channelId,
      `✅ <strong>${botSafe(character.name)}</strong> foi registrado(a) no AU por @${request.user!.username}.`
    )
    return reply.code(201).send({ character })
  })

  // Opções dos dropdowns de panteão/vínculo divino do modal de /registro.
  app.get('/pantheons', async (_request, reply) => {
    return reply.send({ pantheons: await TrikModel.listPantheons() })
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
    if (body.universe === 'au') {
      if (!body.templateName.trim() || !body.templateSignature.trim()) {
        return reply.code(400).send({ error: 'Nome e assinatura da plaquinha não podem ficar vazios', code: 'VALIDATION' })
      }
      const character = await TrikAu.updateAuCharacterTemplate(
        request.user!.userId, body.characterId, body.templateName.trim(), body.templateSignature.trim()
      )
      if (!character) return reply.code(404).send({ error: 'Personagem AU não encontrado', code: 'NOT_FOUND' })
      await postTrikMessage(
        body.channelId,
        `🏷️ Plaquinha de <strong>${botSafe(character.name)}</strong> (AU) atualizada: “${botSafe(character.template_name ?? '')}”.`
      )
      return reply.send({ character })
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
          naturalAptitudes:  progress.points_natural_aptitudes  - progress.spent_natural_aptitudes,
          acquiredAptitudes: progress.points_acquired_aptitudes - progress.spent_acquired_aptitudes,
        },
      }
    }))

    const eligible = withBudget.filter(w =>
      w.available.conduct > 0 || w.available.principles > 0 || w.available.preferences > 0 ||
      w.available.naturalAptitudes > 0 || w.available.acquiredAptitudes > 0 ||
      (w.progress.has_goal && !w.bonuses?.goal_id)
    )

    const [preferences, goals, aptitudes] = await Promise.all([
      TrikModel.listPreferences(),
      TrikModel.listGoals(),
      TrikModel.listAptitudes(),
    ])
    return reply.send({ characters: eligible, preferences, goals, aptitudes })
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

  // GET /interesses/state: personagens do jogador com os slots abertos e o
  // interesse atual de cada um, mais as categorias que dá pra escolher.
  app.get('/interesses/state', async (request, reply) => {
    const { characters } = await getPlayerAndCharacters(request.user!.userId)
    const interests = await TrikInterests.listCharacterInterests(characters.map(c => c.id))
    const withSlots = await Promise.all(characters.map(async c => {
      const progress = await TrikModel.getOrCreateProgress(c.id)
      return {
        character: c,
        unlocked: {
          primario:   progress.points_primary_interest   > 0,
          secundario: progress.points_secondary_interest > 0,
        },
        interests: interests[c.id] ?? [],
      }
    }))
    const [weapon, knowledge] = await Promise.all([
      TrikInterests.listCategories('weapon'),
      TrikInterests.listCategories('knowledge'),
    ])
    return reply.send({
      characters: withSlots.filter(w => w.unlocked.primario || w.unlocked.secundario),
      categories: { weapon, knowledge },
      reduction:  TrikInterests.INTEREST_REDUCTION,
    })
  })

  app.post('/interesse', {
    preHandler: validate({ body: InterestBody }),
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof InterestBody>
    if (!await TrikModel.isChannelPurpose(body.channelId, 'levelup')) {
      return reply.code(403).send({ error: 'Este canal não está configurado para /interesse', code: 'FORBIDDEN_CHANNEL' })
    }
    const { characters } = await getPlayerAndCharacters(request.user!.userId)
    if (!characters.some(c => c.id === body.characterId)) {
      return reply.code(403).send({ error: 'Esse personagem não pertence a você', code: 'FORBIDDEN' })
    }
    const result = await TrikInterests.setCharacterInterest(body.characterId, body.slot, body.kind, body.category)
    if (!result.ok) {
      return reply.code(400).send({ error: INTEREST_ERRORS[result.code], code: result.code })
    }
    return reply.send({ interest: result.interest })
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
    const { pantheonId, divineBondId, ...patch } = request.body as z.infer<typeof RegistroCharacterPatch>

    // Mesma validação do /registro (services/trik/registro): a divindade
    // precisa ser desse panteão, e os dois precisam existir no catálogo.
    let divine: TrikModel.DivineChoice | undefined
    if (pantheonId === null) {
      divine = { pantheonId: null, divineBondId: null, pantheon: null, divineBond: null }
    } else if (pantheonId) {
      const choice = await TrikModel.resolvePantheonChoice(pantheonId, divineBondId ?? null)
      if (!choice) return reply.code(400).send({ error: 'Panteão ou divindade fora do catálogo', code: 'VALIDATION' })
      divine = { pantheonId, divineBondId: divineBondId ?? null, pantheon: choice.pantheon, divineBond: choice.deity }
    }

    try {
      const character = await TrikModel.updateRegistroCharacter(id, patch, divine)
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

  app.delete('/registros/characters/:id', {
    preHandler: validate({ params: RegistroIdParams }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof RegistroIdParams>
    if (!await TrikModel.deleteRegistroCharacter(id)) {
      return reply.code(404).send({ error: 'Personagem não encontrado', code: 'NOT_FOUND' })
    }
    return reply.code(204).send()
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
    const entry = await TrikMastery.createCatalogEntry(type, name, category)
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

  // ── Catálogo de panteões e divindades (trik_pantheons/trik_deities) ────────
  // Cada panteão/divindade vem com os seus efeitos (trik_effects).

  app.get('/pantheons', async (_request, reply) => {
    const [pantheons, effects] = await Promise.all([TrikModel.listPantheons(), TrikEffects.listPantheonEffects()])
    return reply.send({
      pantheons: pantheons.map(p => ({
        ...p,
        effects: effects[p.id] ?? [],
        deities: p.deities.map(d => ({ ...d, effects: effects[d.id] ?? [] })),
      })),
    })
  })

  app.post('/pantheons', {
    preHandler: validate({ body: PantheonBody }),
  }, async (request, reply) => {
    const { name } = request.body as z.infer<typeof PantheonBody>
    try {
      return reply.code(201).send({ pantheon: { ...await TrikModel.createPantheon(name), effects: [] } })
    } catch (err: any) {
      if (err?.code === '23505') return reply.code(409).send({ error: 'Esse panteão já existe', code: 'DUPLICATE_NAME' })
      throw err
    }
  })

  app.delete('/pantheons/:id', {
    preHandler: validate({ params: PantheonIdParams }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof PantheonIdParams>
    if (!await TrikModel.deletePantheon(id)) return reply.code(404).send({ error: 'Panteão não encontrado', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  app.post('/pantheons/:id/deities', {
    preHandler: validate({ params: PantheonIdParams, body: DeityBody }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof PantheonIdParams>
    const { name } = request.body as z.infer<typeof DeityBody>
    try {
      const deity = await TrikModel.createDeity(id, name)
      if (!deity) return reply.code(404).send({ error: 'Panteão não encontrado', code: 'NOT_FOUND' })
      return reply.code(201).send({ deity: { ...deity, effects: [] } })
    } catch (err: any) {
      if (err?.code === '23505') return reply.code(409).send({ error: 'Essa divindade já existe nesse panteão', code: 'DUPLICATE_NAME' })
      throw err
    }
  })

  app.delete('/deities/:id', {
    preHandler: validate({ params: PantheonIdParams }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof PantheonIdParams>
    if (!await TrikModel.deleteDeity(id)) return reply.code(404).send({ error: 'Divindade não encontrada', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  // ── Catálogos com efeito (aba Bônus): aptidões, preferências, objetivos e as
  // listas desbloqueáveis (transtornos, distúrbios, habilidades únicas,
  // peculiaridades). Cada item vem com os seus efeitos.

  app.get('/bonus-catalog', {
    preHandler: validate({ query: BonusCatalogQuery }),
  }, async (request, reply) => {
    const { kind } = request.query as z.infer<typeof BonusCatalogQuery>
    return reply.send({ items: await TrikEffects.listBonusCatalog(kind) })
  })

  app.post('/bonus-catalog', {
    preHandler: validate({ body: BonusCatalogBody }),
  }, async (request, reply) => {
    const { kind, name, category } = request.body as z.infer<typeof BonusCatalogBody>
    const duplicate = { error: `Já existe "${name}" nessa lista`, code: 'DUPLICATE_NAME' }
    try {
      const item = await TrikEffects.createBonusCatalogItem(kind, name, category)
      if (!item) return reply.code(409).send(duplicate)
      return reply.code(201).send({ item })
    } catch (err: any) {
      if (err?.code === '23505') return reply.code(409).send(duplicate)
      throw err
    }
  })

  app.patch('/bonus-catalog/:id', {
    preHandler: validate({ params: IdParams, body: BonusCategoryBody }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParams>
    const { kind, category } = request.body as z.infer<typeof BonusCategoryBody>
    if (!await TrikEffects.setBonusCatalogCategory(kind, id, category)) {
      return reply.code(404).send({ error: 'Item não encontrado', code: 'NOT_FOUND' })
    }
    return reply.code(204).send()
  })

  app.delete('/bonus-catalog/:id', {
    preHandler: validate({ params: IdParams, query: BonusCatalogQuery }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParams>
    const { kind } = request.query as z.infer<typeof BonusCatalogQuery>
    try {
      if (!await TrikEffects.deleteBonusCatalogItem(kind, id)) return reply.code(404).send({ error: 'Item não encontrado', code: 'NOT_FOUND' })
    } catch (err: any) {
      // Aptidão/preferência/objetivo escolhidos no /levelup são definitivos
      // (trik_character_bonuses sem ON DELETE): não apaga em uso.
      if (err?.code === '23503') {
        return reply.code(409).send({ error: 'Algum personagem já escolheu esse item no /levelup — não dá pra remover', code: 'IN_USE' })
      }
      throw err
    }
    return reply.code(204).send()
  })

  // ── Efeitos (trik_effects) de qualquer dono, inclusive panteão/divindade.
  // Sem edição: o editor da tela apaga e cria de novo.

  app.post('/effects', {
    preHandler: validate({ body: EffectBody }),
  }, async (request, reply) => {
    const { ownerKind, ownerId, ...input } = request.body as z.infer<typeof EffectBody>
    try {
      const effect = await TrikEffects.createEffect(ownerKind, ownerId, input)
      if (!effect) return reply.code(404).send({ error: 'Item dono do efeito não encontrado', code: 'NOT_FOUND' })
      return reply.code(201).send({ effect })
    } catch (err: any) {
      // 23503 aqui = arma/matéria do alvo não existe; 23514 = CHECK do banco.
      if (err?.code === '23503' || err?.code === '23514') {
        return reply.code(400).send({ error: 'Efeito inválido', code: 'VALIDATION' })
      }
      throw err
    }
  })

  app.delete('/effects/:id', {
    preHandler: validate({ params: IdParams }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParams>
    if (!await TrikEffects.deleteEffect(id)) return reply.code(404).send({ error: 'Efeito não encontrado', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  // ── Listas desbloqueadas no personagem (admin/narrador atribui) ────────────

  // Ficha completa de um personagem (aba Registros → "Ficha completa").
  app.get('/characters/:id/sheet', {
    preHandler: validate({ params: IdParams }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParams>
    const sheet = await getCharacterSheet(id)
    if (!sheet) return reply.code(404).send({ error: 'Personagem não encontrado', code: 'NOT_FOUND' })
    return reply.send({ sheet })
  })

  app.get('/character-traits', async (_request, reply) => {
    return reply.send({ traits: await TrikEffects.listAllCharacterTraits() })
  })

  app.get('/characters/:id/traits', {
    preHandler: validate({ params: IdParams }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParams>
    return reply.send({ traits: await TrikEffects.listCharacterTraits(id) })
  })

  app.post('/characters/:id/traits', {
    preHandler: validate({ params: IdParams, body: TraitBody }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParams>
    const { kind, itemId } = request.body as z.infer<typeof TraitBody>
    try {
      const created = await TrikEffects.unlockTrait(id, kind, itemId, request.user!.userId)
      return reply.code(created ? 201 : 200).send({ created })
    } catch (err: any) {
      if (err?.code === '23503') return reply.code(404).send({ error: 'Personagem ou item não encontrado', code: 'NOT_FOUND' })
      throw err
    }
  })

  app.delete('/characters/:id/traits/:kind/:itemId', {
    preHandler: validate({ params: CharacterTraitParams }),
  }, async (request, reply) => {
    const { id, kind, itemId } = request.params as z.infer<typeof CharacterTraitParams>
    if (!await TrikEffects.removeTrait(id, kind, itemId)) return reply.code(404).send({ error: 'Não estava desbloqueado', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  // ── Regiões (aba Clima) e região do tópico ─────────────────────────────────

  app.get('/locations', async (_request, reply) => {
    return reply.send({ locations: await TrikEffects.listLocations() })
  })

  app.post('/locations', {
    preHandler: validate({ body: LocationBody }),
  }, async (request, reply) => {
    const { name, latitude, longitude } = request.body as z.infer<typeof LocationBody>
    try {
      return reply.code(201).send({ location: await TrikEffects.createLocation(name, latitude, longitude) })
    } catch (err: any) {
      if (err?.code === '23505') return reply.code(409).send({ error: 'Essa região já existe', code: 'DUPLICATE_NAME' })
      throw err
    }
  })

  app.delete('/locations/:id', {
    preHandler: validate({ params: IdParams }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParams>
    if (!await TrikEffects.deleteLocation(id)) return reply.code(404).send({ error: 'Região não encontrada', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  app.put('/threads/:id/location', {
    preHandler: validate({ params: IdParams, body: ThreadLocationBody }),
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParams>
    const { locationId } = request.body as z.infer<typeof ThreadLocationBody>
    try {
      if (!await TrikEffects.setThreadLocation(id, locationId)) {
        return reply.code(404).send({ error: 'Tópico não está marcado pra contar XP', code: 'NOT_FOUND' })
      }
    } catch (err: any) {
      if (err?.code === '23503') return reply.code(400).send({ error: 'Região não encontrada', code: 'VALIDATION' })
      throw err
    }
    return reply.code(204).send()
  })

  // Alertas saem dos limites do código (não ficam gravados) — a tela só mostra.
  const withAlerts = (days: TrikEffects.TrikWeatherDay[]) => days.map(d => ({ ...d, alerts: dayAlerts(d) }))

  // ── Semana de jogo (aba Clima). Selecionar a semana busca o clima de cada
  // região na Open-Meteo e posta o aviso no canal Clima (services/trik/weather).

  app.get('/game-week', async (_request, reply) => {
    const weekStart = await TrikEffects.getGameWeek()
    const weather = weekStart ? await TrikEffects.listWeatherWeek(weekStart) : []
    return reply.send({ weekStart, weather: withAlerts(weather) })
  })

  app.put('/game-week', {
    preHandler: validate({ body: GameWeekBody }),
  }, async (request, reply) => {
    const { weekStart } = request.body as z.infer<typeof GameWeekBody>
    await TrikEffects.setGameWeek(weekStart, request.user!.userId)
    const { weather, failed, noticeSent } = await syncGameWeek(weekStart)
    return reply.send({ weekStart, weather: withAlerts(weather), failed, noticeSent })
  })

  // ── Categorias que notificam todos os membros (trik_notify_categories) ─────
  // Devolve a lista plana com parent_id; a árvore é montada na tela. O
  // disparo em si é em routes/forums.ts (notificarCategoria).

  app.get('/notify-categories', async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    return reply.send({ categories: await TrikModel.listNotifyCategories(communityId) })
  })

  app.put('/notify-categories', {
    preHandler: validate({ body: NotifyCategoriesBody }),
  }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const { categoryIds } = request.body as z.infer<typeof NotifyCategoriesBody>
    await TrikModel.setNotifyCategories(categoryIds, communityId, request.user!.userId)
    return reply.send({ ok: true })
  })

  // ── Universo Alternativo (trik_013): raízes AU, herdadas pela subárvore ────

  app.get('/au-categories', async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    return reply.send({ categories: await TrikAu.listAuCategories(communityId) })
  })

  app.get('/au-characters', async (_request, reply) => {
    return reply.send({ characters: await TrikAu.listAllAuCharacters() })
  })

  app.put('/au-categories', {
    preHandler: validate({ body: NotifyCategoriesBody }),
  }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const { categoryIds } = request.body as z.infer<typeof NotifyCategoriesBody>
    await TrikAu.setAuCategories(categoryIds, communityId, request.user!.userId)
    return reply.send({ ok: true })
  })

  // ── Xp de narrador (#lore) — ver models/trikNarrador.ts ───────────────────

  app.get('/narrador', async (_request, reply) => {
    const userId = await TrikNarrador.getNarratorUserId()
    if (!userId) {
      return reply.send({ narrator: null, username: TrikModel.NARRADOR.username })
    }
    const [balance, characters, awards, distributions] = await Promise.all([
      TrikNarrador.getNarratorBalance(userId),
      TrikNarrador.listNarratorCharacters(userId),
      TrikNarrador.listNarratorAwards(userId),
      TrikNarrador.listNarratorDistributions(userId),
    ])
    return reply.send({
      narrator: { userId, username: TrikModel.NARRADOR.username },
      balance, characters, awards, distributions,
    })
  })

  app.post('/narrador/distribuir', {
    preHandler: validate({ body: NarradorDistribuirBody }),
  }, async (request, reply) => {
    const { characterId, xp } = request.body as z.infer<typeof NarradorDistribuirBody>
    const userId = await TrikNarrador.getNarratorUserId()
    if (!userId) return reply.code(404).send({ error: 'Conta do narrador não encontrada', code: 'NOT_FOUND' })

    try {
      const result = await TrikNarrador.distributeNarratorXp(userId, characterId, xp, request.user!.userId)
      if (result.leveledUp) {
        notifyLevelUp(characterId, result.characterName)
          .catch(err => request.log.warn({ err }, '[trik:narrador] notifyLevelUp failed'))
      }
      return reply.send(result)
    } catch (err) {
      if (err instanceof TrikNarrador.NarratorDistributionError) {
        return reply.code(400).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // GET /admin/trik/threads/:id — estado de XP e região (Fase 3) de um tópico.
  // O toggle em si é feito por PATCH /api/v1/forums/threads/:id
  // (is_xp_enabled), restrito a owner/admin — ver routes/forums.ts.
  app.get('/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [enabled, locationId] = await Promise.all([TrikModel.isXpThread(id), TrikEffects.getThreadLocation(id)])
    return reply.send({ enabled, locationId })
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
