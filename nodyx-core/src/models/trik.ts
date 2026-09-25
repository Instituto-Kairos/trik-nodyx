import { db } from '../config/database'
import { applyMasteryInTx, revertMastery, type MasteryKind, type MasteryResult } from './trikMastery'

/** Cliente de transação (pg PoolClient) — só o que as funções `*InTx` usam. */
interface TxClient {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

export interface TrikPlayer {
  id:            string
  name:          string
  pronouns:      string | null
  birth_date:    string | null
  permit_active: boolean
  created_at:    string
  updated_at:    string
}

export interface TrikCharacter {
  id:                   string
  player_id:            string
  name:                 string
  pronouns:             string | null
  birth_date:           string | null
  faceclaim_name:       string | null
  faceclaim_birth_date: string | null
  ficha_link:           string
  pantheon:             string | null
  divine_bond:          string | null
  divine_gift:          string | null
  conduct_presenca:     number
  conduct_proposito:    number
  conduct_sangue:       number
  principles_mente:     number
  principles_coracao:   number
  principles_corpo:     number
  template_name:        string | null
  template_signature:   string | null
  created_at:           string
  updated_at:           string
  last_active_at:       string
}

// 'cena' saiu na Fase 2 — o jogo ativo roda em trik_threads (tópicos do
// fórum), não em canais de chat. 'anuncio' entrou (canal de aviso de
// level up) — ver trik_002_xp.sql.
export type TrikChannelPurpose = 'registro' | 'plaquinha' | 'levelup' | 'anuncio'

export interface TrikChannelEntry {
  channel_id: string
  purpose:    TrikChannelPurpose
}

export interface NewCharacterInput {
  name:                 string
  pronouns?:            string | null
  birthDate?:           string | null
  faceclaimName?:       string | null
  faceclaimBirthDate?:  string | null
  fichaLink:            string
  pantheon?:            string | null
  divineBond?:          string | null
  divineGift?:          string | null
  conductPresenca:      number
  conductProposito:     number
  conductSangue:        number
  principlesMente:      number
  principlesCoracao:    number
  principlesCorpo:      number
}

// ─── Players ────────────────────────────────────────────────────────────────

export async function getPlayer(userId: string): Promise<TrikPlayer | null> {
  const { rows } = await db.query<TrikPlayer>(
    `SELECT * FROM trik_players WHERE id = $1`,
    [userId]
  )
  return rows[0] ?? null
}

export async function upsertPlayer(
  userId: string,
  data: { name: string; pronouns?: string | null; birthDate?: string | null }
): Promise<TrikPlayer> {
  const { rows } = await db.query<TrikPlayer>(
    `INSERT INTO trik_players (id, name, pronouns, birth_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [userId, data.name, data.pronouns ?? null, data.birthDate ?? null]
  )
  if (rows[0]) return rows[0]
  // Já existia — devolve a linha atual sem sobrescrever (campos de jogador
  // só são preenchidos no primeiro /registro).
  const existing = await getPlayer(userId)
  if (!existing) throw new Error('upsertPlayer: linha não encontrada após ON CONFLICT DO NOTHING')
  return existing
}

// ─── Characters ─────────────────────────────────────────────────────────────

export async function getCharactersByPlayer(playerId: string): Promise<TrikCharacter[]> {
  const { rows } = await db.query<TrikCharacter>(
    `SELECT * FROM trik_characters WHERE player_id = $1 ORDER BY created_at ASC`,
    [playerId]
  )
  return rows
}

export async function getCharacterById(id: string): Promise<TrikCharacter | null> {
  const { rows } = await db.query<TrikCharacter>(
    `SELECT * FROM trik_characters WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function findCharacterByName(playerId: string, name: string): Promise<TrikCharacter | null> {
  const { rows } = await db.query<TrikCharacter>(
    `SELECT * FROM trik_characters WHERE player_id = $1 AND name = $2`,
    [playerId, name]
  )
  return rows[0] ?? null
}

export async function createCharacter(playerId: string, data: NewCharacterInput): Promise<TrikCharacter> {
  const { rows } = await db.query<TrikCharacter>(
    `INSERT INTO trik_characters (
       player_id, name, pronouns, birth_date,
       faceclaim_name, faceclaim_birth_date, ficha_link,
       pantheon, divine_bond, divine_gift,
       conduct_presenca, conduct_proposito, conduct_sangue,
       principles_mente, principles_coracao, principles_corpo
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      playerId, data.name, data.pronouns ?? null, data.birthDate ?? null,
      data.faceclaimName ?? null, data.faceclaimBirthDate ?? null, data.fichaLink,
      data.pantheon ?? null, data.divineBond ?? null, data.divineGift ?? null,
      data.conductPresenca, data.conductProposito, data.conductSangue,
      data.principlesMente, data.principlesCoracao, data.principlesCorpo,
    ]
  )
  return rows[0]
}

export async function updateCharacterTemplate(
  characterId: string,
  templateName: string,
  templateSignature: string
): Promise<TrikCharacter> {
  const { rows } = await db.query<TrikCharacter>(
    `UPDATE trik_characters
        SET template_name = $2, template_signature = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [characterId, templateName, templateSignature]
  )
  return rows[0]
}

export async function hasMultipleCharacters(playerId: string): Promise<boolean> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM trik_characters WHERE player_id = $1`,
    [playerId]
  )
  return Number(rows[0]?.count ?? 0) > 1
}

// ─── Channel purposes ───────────────────────────────────────────────────────

export async function getChannelPurposes(): Promise<TrikChannelEntry[]> {
  const { rows } = await db.query<TrikChannelEntry>(
    `SELECT channel_id, purpose FROM trik_channels`
  )
  return rows
}

export async function isChannelPurpose(channelId: string, purpose: TrikChannelPurpose): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM trik_channels WHERE channel_id = $1 AND purpose = $2`,
    [channelId, purpose]
  )
  return rows.length > 0
}

export async function setChannelPurposes(
  entries: { channelId: string; purpose: TrikChannelPurpose }[],
  adminId: string
): Promise<void> {
  // db é um Pool — cada db.query() pode sair numa conexão diferente, então
  // BEGIN/COMMIT precisam do mesmo client (mesmo padrão de routes/polls.ts).
  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM trik_channels`)
    for (const entry of entries) {
      await client.query(
        `INSERT INTO trik_channels (channel_id, purpose, enabled_by) VALUES ($1, $2, $3)`,
        [entry.channelId, entry.purpose, adminId]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Fase 2: progresso de XP (1:1 com trik_characters) ─────────────────────

export interface TrikCharacterProgress {
  character_id:       string
  level:               number
  progress_xp:         number
  points_conduct:      number
  points_principles:   number
  points_preferences:  number
  spent_conduct:       number
  spent_principles:    number
  spent_preferences:   number
  has_goal:            boolean
  updated_at:          string
}

export async function getOrCreateProgress(characterId: string): Promise<TrikCharacterProgress> {
  const { rows } = await db.query<TrikCharacterProgress>(
    `INSERT INTO trik_character_progress (character_id) VALUES ($1)
     ON CONFLICT (character_id) DO NOTHING
     RETURNING *`,
    [characterId]
  )
  if (rows[0]) return rows[0]
  const { rows: existing } = await db.query<TrikCharacterProgress>(
    `SELECT * FROM trik_character_progress WHERE character_id = $1`,
    [characterId]
  )
  if (!existing[0]) throw new Error('getOrCreateProgress: linha não encontrada após ON CONFLICT DO NOTHING')
  return existing[0]
}

interface TrikXpLevelRow {
  goal_xp:            string
  reward_conduct:     number
  reward_principles:  number
  reward_preferences: number
  reward_goal:        boolean
}

/**
 * Soma xpDelta em progress_xp e sobe de nível enquanto progress_xp cruzar o
 * goal_xp do nível atual (lookup em trik_progression a cada volta — sem linha
 * pro próximo nível, para de subir e represa o xp excedente em progress_xp).
 * SELECT ... FOR UPDATE evita race entre duas cenas do mesmo personagem
 * postadas quase ao mesmo tempo.
 *
 * Roda dentro da transação do chamador (`client`, sem BEGIN/COMMIT) — ver
 * applySceneAward, que junta prêmio + xp + maestria numa transação só.
 *
 * Só cobre o type 'character' (grava em trik_character_progress). A maestria
 * de arma/matéria (types 'weapon'/'knowledge', disparada por #treino/#aula)
 * tem função equivalente própria em models/trikMastery.ts.
 */
export async function applyXpInTx(
  client: TxClient,
  characterId: string,
  xpDelta: number
): Promise<{ progress: TrikCharacterProgress; leveledUp: boolean }> {
  await client.query(
    `INSERT INTO trik_character_progress (character_id) VALUES ($1) ON CONFLICT (character_id) DO NOTHING`,
    [characterId]
  )
  const { rows: lockedRows } = await client.query(
    `SELECT * FROM trik_character_progress WHERE character_id = $1 FOR UPDATE`,
    [characterId]
  )
  const current = lockedRows[0] as TrikCharacterProgress

  let progressXp        = Number(current.progress_xp) + xpDelta
  let level              = current.level
  let pointsConduct      = current.points_conduct
  let pointsPrinciples   = current.points_principles
  let pointsPreferences  = current.points_preferences
  let hasGoal            = current.has_goal
  let leveledUp          = false

  while (true) {
    const { rows: levelRows } = await client.query(
      `SELECT goal_xp, reward_conduct, reward_principles, reward_preferences, reward_goal
         FROM trik_progression WHERE type = 'character' AND level = $1`,
      [level]
    )
    const nextGoal = levelRows[0] as TrikXpLevelRow | undefined
    if (!nextGoal) break // sem curva definida pro nível atual — nível máximo, xp represa

    const goalXp = Number(nextGoal.goal_xp)
    if (progressXp < goalXp) break

    progressXp -= goalXp
    level += 1
    pointsConduct     += nextGoal.reward_conduct
    pointsPrinciples  += nextGoal.reward_principles
    pointsPreferences += nextGoal.reward_preferences
    hasGoal = hasGoal || nextGoal.reward_goal
    leveledUp = true
  }

  const { rows: updatedRows } = await client.query(
    `UPDATE trik_character_progress
        SET progress_xp = $2, level = $3, points_conduct = $4,
            points_principles = $5, points_preferences = $6, has_goal = $7,
            updated_at = NOW()
      WHERE character_id = $1
      RETURNING *`,
    [characterId, progressXp, level, pointsConduct, pointsPrinciples, pointsPreferences, hasGoal]
  )

  return { progress: updatedRows[0] as TrikCharacterProgress, leveledUp }
}

// ─── Fase 2: scene awards (1:1 com posts, pra permitir revert) ─────────────

/** Crédito de maestria de uma cena #treino/#aula (cena com as duas tags é
 *  tratada como cena normal, ver processScenePost). `units` já vem
 *  arredondado em 2 casas. */
export interface SceneMasteryAward {
  kind:   MasteryKind
  itemId: string
  units:  number
}

export interface SceneAwardResult {
  leveledUp: boolean
  /** Só presente quando a cena creditou maestria. */
  mastery?:  MasteryResult
}

/**
 * Prêmio de uma cena, TUDO numa transação: a linha de trik_scene_awards, o xp
 * de personagem (com level up) e, se houver, a maestria. Se qualquer passo
 * falhar nada é gravado — antes eram três transações separadas, e uma falha no
 * meio deixava um prêmio registrado pra xp que nunca foi aplicado (e que o
 * revert depois descontava).
 *
 * Devolve null quando o post JÁ tem prêmio (`ON CONFLICT (post_id) DO NOTHING`):
 * duas edições quase simultâneas do mesmo post não creditam duas vezes.
 */
export async function applySceneAward(
  characterId: string,
  postId: string,
  xpAwarded: number,
  mastery?: SceneMasteryAward
): Promise<SceneAwardResult | null> {
  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')

    const { rows: inserted } = await client.query(
      `INSERT INTO trik_scene_awards
         (character_id, post_id, xp_awarded, weapon_id, knowledge_id, mastery_awarded, mastery_kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (post_id) DO NOTHING
       RETURNING id`,
      [
        characterId, postId, xpAwarded,
        mastery?.kind === 'weapon'    ? mastery.itemId : null,
        mastery?.kind === 'knowledge' ? mastery.itemId : null,
        mastery?.units ?? 0,
        mastery?.kind ?? null,
      ]
    )
    if (inserted.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    const { leveledUp } = await applyXpInTx(client, characterId, xpAwarded)
    const masteryResult = mastery
      ? await applyMasteryInTx(client, mastery.kind, characterId, mastery.itemId, mastery.units)
      : undefined

    await client.query('COMMIT')
    return { leveledUp, ...(masteryResult && { mastery: masteryResult }) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Desconta o xp bruto do post (e a maestria de arma/matéria, se a cena tiver
 * creditado alguma) e apaga o registro. NUNCA desfaz um level up já aplicado
 * (ver fase-dois.md — pontos de level já podem ter sido gastos em /levelup),
 * e por isso NÃO tem piso em 0: quando a cena tinha cruzado o nível, o xp
 * volta como progresso negativo ("dívida") e as próximas cenas o pagam antes
 * de contar pro nível seguinte. Com o piso, editar um post que subiu de nível
 * devolvia esse xp de graça no reprocessamento.
 *
 * O DELETE ... RETURNING pega e apaga a linha atomicamente: dois reverts
 * concorrentes do mesmo post não descontam duas vezes.
 *
 * ATENÇÃO: precisa rodar ANTES de o post ser apagado — trik_scene_awards tem
 * ON DELETE CASCADE em posts(id), e com o post já removido não sobra linha
 * pra reverter. Cena sem #treino/#aula tem weapon_id/knowledge_id nulos e
 * mastery_awarded = 0: reverte só o xp de personagem.
 */
export async function revertSceneAward(postId: string): Promise<void> {
  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `DELETE FROM trik_scene_awards WHERE post_id = $1
       RETURNING character_id, xp_awarded, weapon_id, knowledge_id, mastery_awarded, mastery_kind`,
      [postId]
    ) as { rows: { character_id: string; xp_awarded: number; weapon_id: string | null; knowledge_id: string | null; mastery_awarded: string | null; mastery_kind: MasteryKind | null }[] }
    if (rows[0]) {
      const award = rows[0]
      await client.query(
        `UPDATE trik_character_progress
            SET progress_xp = progress_xp - $2, updated_at = NOW()
          WHERE character_id = $1`,
        [award.character_id, award.xp_awarded]
      )
      // Item apagado do catálogo → o id virou NULL (ON DELETE SET NULL): não há
      // mais progresso a descontar, só o xp de personagem acima.
      const itemId = award.weapon_id ?? award.knowledge_id
      const masteryUnits = Number(award.mastery_awarded ?? 0)
      if (award.mastery_kind && itemId && masteryUnits > 0) {
        await revertMastery(award.mastery_kind, award.character_id, itemId, masteryUnits, client)
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Posts de um tópico que têm prêmio de cena — pra desfazer o xp ANTES de o
 *  tópico ser apagado (o CASCADE leva os prêmios junto com os posts). */
export async function listAwardedPostIdsByThread(threadId: string): Promise<string[]> {
  const { rows } = await db.query<{ post_id: string }>(
    `SELECT a.post_id
       FROM trik_scene_awards a
       JOIN posts p ON p.id = a.post_id
      WHERE p.thread_id = $1`,
    [threadId]
  )
  return rows.map(r => r.post_id)
}

/** Personagens do jogador já validados pelo /plaquinha (âncoras
 *  preenchidas) — só esses entram no match de header do Fluxo 1. */
export async function getCharactersWithTemplate(playerId: string): Promise<TrikCharacter[]> {
  const { rows } = await db.query<TrikCharacter>(
    `SELECT * FROM trik_characters
      WHERE player_id = $1 AND template_name IS NOT NULL AND template_signature IS NOT NULL`,
    [playerId]
  )
  return rows
}

// ─── Admin: tabela de registros (GET /admin/trik/registros) ────────────────
// Só leitura — o que o /registro e o /plaquinha gravaram, jogador → personagens,
// com o nível/xp de cada um. O pool não tem type parser: colunas DATE saem
// como texto no SQL (senão o pg devolve Date à meia-noite local e o JSON
// desloca o dia) e BIGINT (xp) chega como string, convertido abaixo.

export interface TrikRegistroCharacter {
  id:                   string
  name:                 string
  pronouns:             string | null
  birth_date:           string | null
  faceclaim_name:       string | null
  faceclaim_birth_date: string | null
  ficha_link:           string
  pantheon:             string | null
  divine_bond:          string | null
  divine_gift:          string | null
  conduct_presenca:     number
  conduct_proposito:    number
  conduct_sangue:       number
  principles_mente:     number
  principles_coracao:   number
  principles_corpo:     number
  template_name:        string | null
  template_signature:   string | null
  created_at:           string
  last_active_at:       string
  level:                number
  progress_xp:          number
  /** xp pra sair do nível atual; null = nível máximo (sem linha na curva). */
  goal_xp:              number | null
}

export interface TrikRegistroPlayer {
  id:            string
  username:      string
  name:          string
  pronouns:      string | null
  birth_date:    string | null
  permit_active: boolean
  created_at:    string
  characters:    TrikRegistroCharacter[]
}

/** Um alias mencionável = um personagem, já emparelhado com seu jogador. */
export interface TrikAlias {
  alias:       string   // nome do personagem, como aparece na cena
  username:    string   // quem é notificado de verdade
  player_name: string   // nome OOC do jogador, para a validação combinada
  avatar:      string | null
}

/**
 * Aliases mencionáveis: um personagem é um apelido DO JOGADOR, então o que sai
 * daqui já é o par "nome do personagem · jogador" pronto para o autocomplete
 * exibir e validar. Marcar o alias marca o jogador.
 *
 * Escopado à comunidade e sem contas de sistema, pelo mesmo motivo que
 * resolveMentions() o é (garde-fou do upstream, audit 16/09): um jogador
 * excluído da comunidade não deve ser notificável por um personagem antigo.
 *
 * A colisão de nomes NÃO é resolvida aqui de propósito. `trik_characters` tem
 * UNIQUE (player_id, name), ou seja, dois jogadores PODEM ter um "Kaelen" cada.
 * Nesse caso as duas linhas voltam e é a pessoa que escolhe no dropdown, vendo
 * o jogador ao lado — é a validação combinada. Filtrar aqui seria decidir no
 * escuro por ela.
 */
export async function searchMentionableAliases(
  communityId: string,
  q: string,
  limit = 8,
): Promise<TrikAlias[]> {
  const termo = q.trim()
  const { rows } = await db.query<TrikAlias>(
    `SELECT c.name        AS alias,
            u.username    AS username,
            p.name        AS player_name,
            u.avatar      AS avatar
       FROM trik_characters c
       JOIN trik_players    p  ON p.id = c.player_id
       JOIN users           u  ON u.id = p.id
       JOIN community_members cm ON cm.user_id = u.id AND cm.community_id = $1
      WHERE u.is_system = false
        AND ($2 = '' OR c.name ILIKE $3)
      ORDER BY c.name ASC
      LIMIT $4`,
    [communityId, termo, `%${termo}%`, limit],
  )
  return rows
}

export async function listRegistros(): Promise<TrikRegistroPlayer[]> {
  const [players, characters] = await Promise.all([
    db.query(
      `SELECT p.id, u.username, p.name, p.pronouns, p.birth_date::text AS birth_date,
              p.permit_active, p.created_at
         FROM trik_players p
         JOIN users u ON u.id = p.id
        ORDER BY p.created_at DESC`
    ),
    db.query(
      `SELECT c.id, c.player_id, c.name, c.pronouns, c.birth_date::text AS birth_date,
              c.faceclaim_name, c.faceclaim_birth_date::text AS faceclaim_birth_date,
              c.ficha_link, c.pantheon, c.divine_bond, c.divine_gift,
              c.conduct_presenca, c.conduct_proposito, c.conduct_sangue,
              c.principles_mente, c.principles_coracao, c.principles_corpo,
              c.template_name, c.template_signature, c.created_at, c.last_active_at,
              COALESCE(g.level, 1)       AS level,
              COALESCE(g.progress_xp, 0) AS progress_xp,
              pr.goal_xp
         FROM trik_characters c
         LEFT JOIN trik_character_progress g ON g.character_id = c.id
         LEFT JOIN trik_progression pr
                ON pr.type = 'character' AND pr.level = COALESCE(g.level, 1)
        ORDER BY c.created_at`
    ),
  ])

  const byPlayer = new Map<string, TrikRegistroCharacter[]>()
  for (const { player_id, ...c } of characters.rows) {
    const list = byPlayer.get(player_id) ?? []
    list.push({
      ...c,
      progress_xp: Number(c.progress_xp),
      goal_xp:     c.goal_xp === null ? null : Number(c.goal_xp),
    })
    byPlayer.set(player_id, list)
  }

  return players.rows.map(p => ({ ...p, characters: byPlayer.get(p.id) ?? [] }))
}

// ─── Admin: correção de um registro (PATCH /admin/trik/registros/...) ──────
// O /registro é um mutirão de uma vez só: o jogador preenche o modal e o que
// entrou, entrou (upsertPlayer é DO NOTHING, createCharacter é INSERT). Sem
// isto, um erro de digitação num nome ou num link de ficha só se conserta no
// banco. O PATCH é parcial de propósito — o botão de passe manda só
// `permitActive`, o formulário manda o resto.
//
// Deliberadamente FORA daqui: conduct_*/principles_* e os campos de
// progressão. Esses pontos têm orçamento (points_*/spent_* em
// trik_character_progress, ver applyLevelupInTx) e mexer neles por fora
// dessa contabilidade dessincroniza o /levelup. template_* também fica de
// fora: é o /plaquinha que grava.

/** Chave aceita no corpo do PATCH → coluna. Whitelist: o SET é montado por
 *  concatenação, então nada que venha do cliente pode virar nome de coluna. */
const REGISTRO_PLAYER_COLUMNS = {
  name:         'name',
  pronouns:     'pronouns',
  birthDate:    'birth_date',
  permitActive: 'permit_active',
} as const

const REGISTRO_CHARACTER_COLUMNS = {
  name:               'name',
  pronouns:           'pronouns',
  birthDate:          'birth_date',
  faceclaimName:      'faceclaim_name',
  faceclaimBirthDate: 'faceclaim_birth_date',
  fichaLink:          'ficha_link',
  pantheon:           'pantheon',
  divineBond:         'divine_bond',
  divineGift:         'divine_gift',
} as const

export type RegistroPlayerPatch    = Partial<Record<keyof typeof REGISTRO_PLAYER_COLUMNS,    string | boolean | null>>
export type RegistroCharacterPatch = Partial<Record<keyof typeof REGISTRO_CHARACTER_COLUMNS, string | null>>

/** Monta `col = $n` só para as chaves presentes. `$1` fica reservado ao id. */
function buildSet(
  columns: Record<string, string>,
  patch: Record<string, unknown>,
): { sets: string[]; values: unknown[] } {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, column] of Object.entries(columns)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    values.push(patch[key])
    sets.push(`${column} = $${values.length + 1}`)
  }
  return { sets, values }
}

/** null = jogador inexistente. Patch vazio nunca chega aqui (o schema recusa). */
export async function updateRegistroPlayer(
  id: string,
  patch: RegistroPlayerPatch,
): Promise<TrikPlayer | null> {
  const { sets, values } = buildSet(REGISTRO_PLAYER_COLUMNS, patch)
  if (!sets.length) return getPlayer(id)
  const { rows } = await db.query<TrikPlayer>(
    `UPDATE trik_players
        SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, pronouns, birth_date::text AS birth_date,
                permit_active, created_at, updated_at`,
    [id, ...values],
  )
  return rows[0] ?? null
}

/** null = personagem inexistente. Colisão de nome (UNIQUE player_id+name)
 *  sobe como erro 23505 — quem chama traduz pra 409. */
export async function updateRegistroCharacter(
  id: string,
  patch: RegistroCharacterPatch,
): Promise<TrikCharacter | null> {
  const { sets, values } = buildSet(REGISTRO_CHARACTER_COLUMNS, patch)
  if (!sets.length) {
    const { rows } = await db.query<TrikCharacter>(`SELECT * FROM trik_characters WHERE id = $1`, [id])
    return rows[0] ?? null
  }
  const { rows } = await db.query<TrikCharacter>(
    `UPDATE trik_characters
        SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1
      RETURNING id, player_id, name, pronouns, birth_date::text AS birth_date,
                faceclaim_name, faceclaim_birth_date::text AS faceclaim_birth_date,
                ficha_link, pantheon, divine_bond, divine_gift,
                conduct_presenca, conduct_proposito, conduct_sangue,
                principles_mente, principles_coracao, principles_corpo,
                template_name, template_signature,
                created_at, updated_at, last_active_at`,
    [id, ...values],
  )
  return rows[0] ?? null
}

// ─── Fase 2: curva de XP (editável via admin, GET/PUT /admin/trik/xp-levels) ──
// Consumida por applyXpInTx a cada cena que gera xp. Migration
// só popula um seed placeholder (níveis 1-3) — sem editar aqui, personagens
// travam no nível 3 pra sempre (comportamento esperado de "nível máximo",
// não um bug, mas não é a curva real do jogo). Tabela trik_progression —
// path_id/req_development ainda não são lidos/escritos por nada. req_mastery (type 'weapon') e req_education (type 'knowledge') são
// os "treinos/aulas necessários" lidos por models/trikMastery.ts; nesses dois
// types goal_xp não é usado (fica em 1, só existe porque a coluna é NOT NULL).

export interface TrikXpLevel {
  type:                string
  level:               number
  goal_xp:             string // BIGINT — pg devolve como string
  req_mastery:         number
  req_education:       number
  reward_conduct:      number
  reward_principles:   number
  reward_preferences:  number
  reward_goal:         boolean
}

export async function listXpLevels(type: string): Promise<TrikXpLevel[]> {
  const { rows } = await db.query<TrikXpLevel>(
    `SELECT * FROM trik_progression WHERE type = $1 ORDER BY level`,
    [type]
  )
  return rows
}

export interface XpLevelInput {
  level:              number
  goalXp:             number
  rewardConduct:      number
  rewardPrinciples:   number
  rewardPreferences:  number
  rewardGoal:         boolean
  /** Só relevante no type 'weapon' — omitido/0 = nível máximo. */
  reqMastery?:        number
  /** Só relevante no type 'knowledge' — omitido/0 = nível máximo. */
  reqEducation?:      number
}

/**
 * Substitui a curva inteira de um `type` numa transação (DELETE + INSERT,
 * mesmo padrão de setChannelPurposes) — mais simples que reconciliar
 * add/remove/update linha a linha, e a curva é sempre uma lista pequena.
 * Uma corrida com um level-up em andamento no meio da troca é uma janela
 * pequena e um cenário raro (edição de curva não é uma operação frequente);
 * não vale a complexidade de travar a tabela pra evitar.
 */
export async function setXpLevels(type: string, levels: XpLevelInput[]): Promise<void> {
  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM trik_progression WHERE type = $1`, [type])
    for (const lvl of levels) {
      await client.query(
        `INSERT INTO trik_progression
           (type, level, goal_xp, reward_conduct, reward_principles, reward_preferences, reward_goal,
            req_mastery, req_education)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [type, lvl.level, lvl.goalXp, lvl.rewardConduct, lvl.rewardPrinciples, lvl.rewardPreferences, lvl.rewardGoal,
         lvl.reqMastery ?? 0, lvl.reqEducation ?? 0]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Fase 2: tópicos elegíveis pra contagem de XP ──────────────────────────

export async function isXpThread(threadId: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM trik_threads WHERE thread_id = $1`, [threadId])
  return rows.length > 0
}

export async function setXpThread(threadId: string, enabled: boolean, adminId: string): Promise<void> {
  if (enabled) {
    await db.query(
      `INSERT INTO trik_threads (thread_id, enabled_by) VALUES ($1, $2) ON CONFLICT (thread_id) DO NOTHING`,
      [threadId, adminId]
    )
  } else {
    await db.query(`DELETE FROM trik_threads WHERE thread_id = $1`, [threadId])
  }
}

// ─── Fase 2: catálogos e bônus do /levelup ─────────────────────────────────
// Sem Aptidões nesta fase (orçamento ainda não definido — ver
// plans/fase-dois-passo-a-passo.md, passo 0): listAptitudes existe porque o
// catálogo em si (trik_aptitudes) já é criado pela migration, mas nenhuma
// rota desta fase usa first_aptitude_id/second_aptitude_id ainda.

export interface TrikCatalogEntry {
  id:        string
  name:      string
  category:  string | null
  bonus_id:  string | null
}

export async function listAptitudes(): Promise<TrikCatalogEntry[]> {
  const { rows } = await db.query<TrikCatalogEntry>(`SELECT * FROM trik_aptitudes ORDER BY name`)
  return rows
}

export async function listPreferences(): Promise<TrikCatalogEntry[]> {
  const { rows } = await db.query<TrikCatalogEntry>(`SELECT * FROM trik_preferences ORDER BY name`)
  return rows
}

export async function listGoals(): Promise<TrikCatalogEntry[]> {
  const { rows } = await db.query<TrikCatalogEntry>(`SELECT * FROM trik_goals ORDER BY name`)
  return rows
}

// ─── Fase 2/3: catálogo de tipos de bônus (trik_bonus) ─────────────────────
// Cadastro via interface própria no admin (/admin/trik/bonus), mesmo padrão
// de trik_weapons/trik_knowledges (TrikMastery). Ainda não consumido por
// nenhuma regra — trik_aptitudes/preferences/goals só guardam o bonus_id.

export interface TrikBonusEntry {
  id:          string
  bonus_type:  string
  bonus_value: string
  is_category: boolean
}

export async function listBonus(): Promise<TrikBonusEntry[]> {
  const { rows } = await db.query<TrikBonusEntry>(`SELECT * FROM trik_bonus ORDER BY bonus_type`)
  return rows
}

export async function createBonus(bonusType: string, bonusValue: string, isCategory: boolean): Promise<TrikBonusEntry> {
  const { rows } = await db.query<TrikBonusEntry>(
    `INSERT INTO trik_bonus (bonus_type, bonus_value, is_category) VALUES ($1, $2, $3)
     RETURNING *`,
    [bonusType.trim(), bonusValue.trim(), isCategory]
  )
  return rows[0]
}

export async function deleteBonus(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM trik_bonus WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}

export interface TrikCharacterBonuses {
  character_id:          string
  first_aptitude_id:      string | null
  second_aptitude_id:     string | null
  first_preference_id:    string | null
  second_preference_id:   string | null
  goal_id:                string | null
}

export async function getCharacterBonuses(characterId: string): Promise<TrikCharacterBonuses | null> {
  const { rows } = await db.query<TrikCharacterBonuses>(
    `SELECT * FROM trik_character_bonuses WHERE character_id = $1`,
    [characterId]
  )
  return rows[0] ?? null
}

// Só os slots que a Fase 2 preenche (ver nota acima sobre Aptidões).
export type BonusSlot = 'first_preference_id' | 'second_preference_id' | 'goal_id'
const ALLOWED_BONUS_SLOTS: BonusSlot[] = ['first_preference_id', 'second_preference_id', 'goal_id']

/** Preenche um slot de trik_character_bonuses só se ainda estiver vazio —
 *  a checagem "slot livre" também é feita no service antes de chamar isto,
 *  o WHERE aqui é defesa contra corrida entre dois submits concorrentes. */
export async function setCharacterBonusSlot(characterId: string, slot: BonusSlot, valueId: string): Promise<void> {
  if (!ALLOWED_BONUS_SLOTS.includes(slot)) {
    throw new Error(`setCharacterBonusSlot: slot inválido: ${slot}`)
  }
  await db.query(
    `INSERT INTO trik_character_bonuses (character_id, ${slot}) VALUES ($1, $2)
     ON CONFLICT (character_id) DO UPDATE SET ${slot} = EXCLUDED.${slot}
     WHERE trik_character_bonuses.${slot} IS NULL`,
    [characterId, valueId]
  )
}

// ─── Fase 2: /levelup — aplica alocação de pontos + bônus escolhidos ───────

export interface LevelupDeltas {
  conductPresenca:    number
  conductProposito:   number
  conductSangue:      number
  principlesMente:    number
  principlesCoracao:  number
  principlesCorpo:    number
}

export interface LevelupBonusFill {
  slot:    BonusSlot
  valueId: string
}

/** Erro de regra de negócio do /levelup (orçamento de pontos estourado, slot de
 *  bônus já preenchido, id de catálogo inexistente). O service converte em
 *  VALIDATION (400) — qualquer outro erro continua sendo um erro de verdade. */
export class LevelupRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LevelupRejectedError'
  }
}

const PG_FOREIGN_KEY_VIOLATION = '23503'

/**
 * Aplica os deltas de /levelup numa transação: soma nos 6 atributos de
 * trik_characters, soma o gasto em trik_character_progress.spent_* (cada
 * slot de preferência preenchido conta como 1 gasto de spent_preferences —
 * goal_id não consome pool, é desbloqueado por has_goal), e preenche os
 * slots de bônus indicados.
 *
 * O orçamento e os slots são conferidos AQUI, com a linha de progresso travada
 * (FOR UPDATE), e não só no service: a checagem do service lê um snapshot fora
 * da transação, então dois submits simultâneos (duplo clique, duas abas)
 * passavam os dois e estouravam o orçamento. Qualquer violação aborta a
 * transação inteira (LevelupRejectedError) — nada é gasto pela metade.
 */
export async function applyLevelupAllocation(
  characterId: string,
  deltas: LevelupDeltas,
  bonusFills: LevelupBonusFill[] = []
): Promise<TrikCharacter> {
  for (const fill of bonusFills) {
    if (!ALLOWED_BONUS_SLOTS.includes(fill.slot)) {
      throw new Error(`applyLevelupAllocation: slot inválido: ${fill.slot}`)
    }
  }

  const spentConduct    = deltas.conductPresenca   + deltas.conductProposito  + deltas.conductSangue
  const spentPrinciples = deltas.principlesMente    + deltas.principlesCoracao + deltas.principlesCorpo
  const spentPreferences = bonusFills.filter(f => f.slot !== 'goal_id').length

  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')

    const { rows: progressRows } = await client.query(
      `SELECT points_conduct, spent_conduct, points_principles, spent_principles,
              points_preferences, spent_preferences, has_goal
         FROM trik_character_progress
        WHERE character_id = $1
          FOR UPDATE`,
      [characterId]
    )
    const p = progressRows[0]
    if (!p) throw new LevelupRejectedError('Sem pontos disponíveis')
    if (spentConduct > p.points_conduct - p.spent_conduct) {
      throw new LevelupRejectedError('Pontos de Conduta insuficientes')
    }
    if (spentPrinciples > p.points_principles - p.spent_principles) {
      throw new LevelupRejectedError('Pontos de Princípios insuficientes')
    }
    if (spentPreferences > p.points_preferences - p.spent_preferences) {
      throw new LevelupRejectedError('Sem pontos de Preferência disponíveis')
    }
    if (bonusFills.some(f => f.slot === 'goal_id') && !p.has_goal) {
      throw new LevelupRejectedError('Objetivo ainda não desbloqueado')
    }

    const { rows } = await client.query(
      `UPDATE trik_characters
          SET conduct_presenca   = conduct_presenca   + $2,
              conduct_proposito  = conduct_proposito  + $3,
              conduct_sangue     = conduct_sangue     + $4,
              principles_mente   = principles_mente   + $5,
              principles_coracao = principles_coracao + $6,
              principles_corpo   = principles_corpo   + $7,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        characterId, deltas.conductPresenca, deltas.conductProposito, deltas.conductSangue,
        deltas.principlesMente, deltas.principlesCoracao, deltas.principlesCorpo,
      ]
    ) as { rows: TrikCharacter[] }

    if (spentConduct > 0 || spentPrinciples > 0 || spentPreferences > 0) {
      await client.query(
        `UPDATE trik_character_progress
            SET spent_conduct = spent_conduct + $2,
                spent_principles = spent_principles + $3,
                spent_preferences = spent_preferences + $4,
                updated_at = NOW()
          WHERE character_id = $1`,
        [characterId, spentConduct, spentPrinciples, spentPreferences]
      )
    }

    for (const fill of bonusFills) {
      // O WHERE só deixa preencher slot vazio: 0 linhas = alguém preencheu antes
      // (corrida entre dois submits). Aborta tudo, em vez de queimar o ponto de
      // preferência sem gravar a escolha.
      const { rows: filled } = await client.query(
        `INSERT INTO trik_character_bonuses (character_id, ${fill.slot}) VALUES ($1, $2)
         ON CONFLICT (character_id) DO UPDATE SET ${fill.slot} = EXCLUDED.${fill.slot}
         WHERE trik_character_bonuses.${fill.slot} IS NULL
         RETURNING character_id`,
        [characterId, fill.valueId]
      )
      if (filled.length === 0) {
        throw new LevelupRejectedError(
          fill.slot === 'goal_id' ? 'Objetivo já escolhido' : 'Essa preferência já foi preenchida'
        )
      }
    }

    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    // preferenceId/goalId que não existe no catálogo: erro de entrada, não de servidor.
    if ((err as { code?: string })?.code === PG_FOREIGN_KEY_VIOLATION) {
      throw new LevelupRejectedError('Preferência ou objetivo inexistente')
    }
    throw err
  } finally {
    client.release()
  }
}
