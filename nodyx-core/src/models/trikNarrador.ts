/**
 * Módulo RPG (trik) — xp de narrador. Ver trik_009_narrador.sql.
 *
 * Post do narrador (NARRADOR, em models/trik.ts) com #lore num tópico que vale
 * xp não credita personagem nenhum: o xp vai pra um pool do narrador, que o
 * admin distribui depois entre os personagens dele (aba /admin/trik/narrador).
 *
 * Separado de models/trik.ts pra ele não crescer mais (mesmo motivo de
 * models/trikMastery.ts).
 */

import { db } from '../config/database'
import { applyXpInTx, NARRADOR } from './trik'

/** id do usuário narrador — null se a conta não existe nesta instância. */
export async function getNarratorUserId(): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    // Também pelo nome antigo: o narrador pode ter trocado de nome
    // (username_history) sem que NARRADOR.username seja atualizado.
    `SELECT id FROM users
      WHERE is_system = false
        AND (LOWER(username) = LOWER($1)
             OR id IN (SELECT user_id FROM username_history WHERE LOWER(old_username) = LOWER($1)))
      LIMIT 1`,
    [NARRADOR.username],
  )
  return rows[0]?.id ?? null
}

// ── Narradores (trik_018, trik_020): cada um com as suas tags ───────────────

/** Tags que já significam outra coisa na plaquinha e não podem virar tag de narrador. */
const RESERVED_NARRATOR_TAGS = new Set(['treino', 'aula', 'tarefa', 'trabalho', 'com'])

/** Tag implícita do narrador fixo (NARRADOR): vale mesmo sem linha em trik_narrator_tags. */
const MAIN_TAG = 'lore'

export interface NarratorRow {
  user_id:  string
  username: string
  /** Sem '#'. Post com qualquer uma delas rende xp pro mesmo pool. */
  tags:     string[]
  /** O narrador fixo do #lore (NARRADOR): não pode ser removido pela aba. */
  is_main:  boolean
}

async function tagsByUser(): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{ user_id: string; tag: string }>(
    `SELECT user_id, tag FROM trik_narrator_tags ORDER BY created_at, tag`,
  )
  const map = new Map<string, string[]>()
  for (const r of rows) map.set(r.user_id, [...(map.get(r.user_id) ?? []), r.tag])
  return map
}

/** #lore primeiro e sem repetir, pro narrador fixo. */
function withMainTag(tags: string[]): string[] {
  return [MAIN_TAG, ...tags.filter(t => t.toLowerCase() !== MAIN_TAG)]
}

/** Todos os narradores. O fixo do #lore entra mesmo sem linha na tabela. */
export async function listNarrators(): Promise<NarratorRow[]> {
  const [{ rows }, tags, mainId] = await Promise.all([
    db.query<{ user_id: string; username: string }>(
      `SELECT n.user_id, u.username
         FROM trik_narrators n JOIN users u ON u.id = n.user_id
        ORDER BY n.created_at`,
    ),
    tagsByUser(),
    getNarratorUserId(),
  ])
  const list: NarratorRow[] = rows.map(r => {
    const is_main = r.user_id === mainId
    const own = tags.get(r.user_id) ?? []
    return { ...r, tags: is_main ? withMainTag(own) : own, is_main }
  })
  if (mainId && !list.some(n => n.user_id === mainId)) {
    const { rows: u } = await db.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [mainId])
    list.unshift({
      user_id: mainId, username: u[0]?.username ?? NARRADOR.username,
      tags: withMainTag(tags.get(mainId) ?? []), is_main: true,
    })
  }
  return list
}

/** Tags de narrador do usuário (sem '#'); vazio se ele não é narrador. */
export async function getNarratorTagsFor(userId: string): Promise<string[]> {
  const [{ rows }, mainId] = await Promise.all([
    db.query<{ tag: string }>(
      `SELECT tag FROM trik_narrator_tags WHERE user_id = $1 ORDER BY created_at, tag`,
      [userId],
    ),
    getNarratorUserId(),
  ])
  const own = rows.map(r => r.tag)
  return mainId === userId ? withMainTag(own) : own
}

/** `#tag` em qualquer parte do texto puro, em qualquer caixa. `#au` não casa `#aurora`. */
export function hasNarratorTag(text: string, tag: string): boolean {
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`#${esc}(?![\\wÀ-ÿ])`, 'i').test(text)
}

export class NarratorAdminError extends Error {
  constructor(
    public code: 'USER_NOT_FOUND' | 'INVALID_TAG' | 'TAG_TAKEN' | 'ALREADY_NARRATOR' | 'MAIN_NARRATOR'
      | 'NOT_NARRATOR' | 'LAST_TAG' | 'TAG_NOT_FOUND',
    message: string,
  ) {
    super(message)
  }
}

/** "#au, #evento festa" → ['au', 'evento', 'festa'] (sem repetir; não valida). */
export function splitTags(raw: string): string[] {
  const seen = new Set<string>()
  return raw.split(/[\s,;]+/)
    .map(t => t.trim().replace(/^#+/, ''))
    .filter(t => {
      const key = t.toLowerCase()
      if (!t || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function assertValidTag(tag: string): void {
  if (!/^[\wÀ-ÿ]{2,30}$/.test(tag) || RESERVED_NARRATOR_TAGS.has(tag.toLowerCase())) {
    throw new NarratorAdminError('INVALID_TAG', `#${tag} é inválida (2 a 30 letras/números, sem espaço; treino, aula, tarefa, trabalho e com são reservadas)`)
  }
}

/** Nenhuma das tags pode ser de outro narrador (#lore é sempre do fixo). */
function assertTagsFree(tags: string[], narrators: NarratorRow[], userId: string): void {
  for (const tag of tags) {
    const key = tag.toLowerCase()
    const owner = narrators.find(n => n.tags.some(t => t.toLowerCase() === key))
    if (owner && owner.user_id !== userId) throw new NarratorAdminError('TAG_TAKEN', `#${tag} já é de outro narrador`)
    if (!owner && key === MAIN_TAG) throw new NarratorAdminError('TAG_TAKEN', `#${MAIN_TAG} é do narrador fixo`)
  }
}

async function insertTags(q: Queryable, userId: string, tags: string[], adminId: string): Promise<void> {
  for (const tag of tags) {
    try {
      await q.query(
        `INSERT INTO trik_narrator_tags (tag, user_id, added_by) VALUES ($1, $2, $3)`,
        [tag, userId, adminId],
      )
    } catch (err: any) {
      if (err?.code === '23505') throw new NarratorAdminError('TAG_TAKEN', `#${tag} já é de outro narrador`)
      throw err
    }
  }
}

/** `rawTags`: uma ou várias tags, separadas por espaço ou vírgula. */
export async function addNarrator(username: string, rawTags: string, adminId: string): Promise<NarratorRow> {
  const tags = splitTags(rawTags)
  if (tags.length === 0) throw new NarratorAdminError('INVALID_TAG', 'Informe pelo menos uma tag')
  tags.forEach(assertValidTag)

  const { rows: users } = await db.query<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE LOWER(username) = LOWER($1) AND is_system = false LIMIT 1`,
    [username.trim().replace(/^@/, '')],
  )
  const user = users[0]
  if (!user) throw new NarratorAdminError('USER_NOT_FOUND', 'Usuário não encontrado')

  const atuais = await listNarrators()
  if (atuais.some(n => n.user_id === user.id)) throw new NarratorAdminError('ALREADY_NARRATOR', 'Esse usuário já é narrador')
  assertTagsFree(tags, atuais, user.id)

  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')
    await client.query(`INSERT INTO trik_narrators (user_id, added_by) VALUES ($1, $2)`, [user.id, adminId])
    await insertTags(client, user.id, tags, adminId)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return { user_id: user.id, username: user.username, tags, is_main: false }
}

/** Acrescenta tags (uma ou várias) a um narrador que já existe. */
export async function addNarratorTags(userId: string, rawTags: string, adminId: string): Promise<string[]> {
  const tags = splitTags(rawTags)
  if (tags.length === 0) throw new NarratorAdminError('INVALID_TAG', 'Informe pelo menos uma tag')
  tags.forEach(assertValidTag)

  const atuais = await listNarrators()
  const narrator = atuais.find(n => n.user_id === userId)
  if (!narrator) throw new NarratorAdminError('NOT_NARRATOR', 'Narrador não encontrado')
  assertTagsFree(tags, atuais, userId)

  const novas = tags.filter(t => !narrator.tags.some(o => o.toLowerCase() === t.toLowerCase()))
  await insertTags(db as unknown as Queryable, userId, novas, adminId)
  return [...narrator.tags, ...novas]
}

/** Tira uma tag do narrador. Prêmios já dados com ela ficam. Não deixa o
 *  narrador sem nenhuma (aí é remover o narrador) e o #lore do fixo não sai. */
export async function removeNarratorTag(userId: string, rawTag: string): Promise<string[]> {
  const tag = rawTag.trim().replace(/^#+/, '').toLowerCase()
  const narrator = (await listNarrators()).find(n => n.user_id === userId)
  if (!narrator) throw new NarratorAdminError('NOT_NARRATOR', 'Narrador não encontrado')
  if (narrator.is_main && tag === MAIN_TAG) {
    throw new NarratorAdminError('MAIN_NARRATOR', `#${MAIN_TAG} é fixa do narrador principal`)
  }
  if (!narrator.tags.some(t => t.toLowerCase() === tag)) {
    throw new NarratorAdminError('TAG_NOT_FOUND', `#${tag} não é desse narrador`)
  }
  if (narrator.tags.length <= 1) {
    throw new NarratorAdminError('LAST_TAG', 'O narrador precisa de pelo menos uma tag — pra tirar todas, remova o narrador')
  }
  await db.query(`DELETE FROM trik_narrator_tags WHERE user_id = $1 AND lower(tag) = $2`, [userId, tag])
  return narrator.tags.filter(t => t.toLowerCase() !== tag)
}

/** Tira o usuário da lista e libera as tags dele. O pool (prêmios e
 *  distribuições) fica guardado: se ele voltar a ser narrador, o saldo antigo
 *  reaparece. */
export async function removeNarrator(userId: string): Promise<boolean> {
  if ((await getNarratorUserId()) === userId) {
    throw new NarratorAdminError('MAIN_NARRATOR', 'O narrador do #lore não pode ser removido')
  }
  const { rowCount } = await db.query(`DELETE FROM trik_narrators WHERE user_id = $1`, [userId])
  await db.query(`DELETE FROM trik_narrator_tags WHERE user_id = $1`, [userId])
  return (rowCount ?? 0) > 0
}

/** Grava o prêmio do post. false = o post já tinha prêmio (edições
 *  concorrentes) — nada foi creditado de novo. */
export async function applyNarratorAward(userId: string, postId: string, xp: number): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO trik_narrator_awards (post_id, user_id, xp_awarded)
     VALUES ($1, $2, $3)
     ON CONFLICT (post_id) DO NOTHING
     RETURNING post_id`,
    [postId, userId, xp],
  )
  return rows.length > 0
}

/** Apagar a linha basta: o saldo é calculado (ver getNarratorBalance). Precisa
 *  rodar ANTES de o post ser apagado — o CASCADE levaria a linha junto, o que
 *  aqui dá no mesmo, mas mantém a convenção de revertSceneAward. */
export async function revertNarratorAward(postId: string): Promise<void> {
  await db.query(`DELETE FROM trik_narrator_awards WHERE post_id = $1`, [postId])
}

export async function listNarratorAwardedPostIdsByThread(threadId: string): Promise<string[]> {
  const { rows } = await db.query<{ post_id: string }>(
    `SELECT a.post_id
       FROM trik_narrator_awards a
       JOIN posts p ON p.id = a.post_id
      WHERE p.thread_id = $1`,
    [threadId],
  )
  return rows.map(r => r.post_id)
}

export interface NarratorBalance {
  earned:      number
  distributed: number
  /** earned - distributed. Pode ser negativo: post revertido depois de o xp
   *  já ter sido distribuído vira "dívida", paga pelos próximos #lore. */
  available:   number
}

interface Queryable {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>
}

async function balanceOf(q: Queryable, userId: string): Promise<NarratorBalance> {
  const { rows } = await q.query(
    `SELECT
       (SELECT COALESCE(SUM(xp_awarded), 0) FROM trik_narrator_awards        WHERE user_id = $1) AS earned,
       (SELECT COALESCE(SUM(xp), 0)         FROM trik_narrator_distributions WHERE user_id = $1) AS distributed`,
    [userId],
  )
  const earned      = Number(rows[0].earned)
  const distributed = Number(rows[0].distributed)
  return { earned, distributed, available: earned - distributed }
}

export function getNarratorBalance(userId: string): Promise<NarratorBalance> {
  return balanceOf(db as unknown as Queryable, userId)
}

export interface NarratorAwardRow {
  post_id:      string
  xp_awarded:   number
  created_at:   string
  thread_id:    string
  thread_title: string
  thread_slug:  string | null
  category_id:   string
  category_slug: string | null
}

export async function listNarratorAwards(userId: string, limit = 50): Promise<NarratorAwardRow[]> {
  const { rows } = await db.query<NarratorAwardRow>(
    `SELECT a.post_id, a.xp_awarded, a.created_at,
            t.id AS thread_id, t.title AS thread_title, t.slug AS thread_slug,
            t.category_id, c.slug AS category_slug
       FROM trik_narrator_awards a
       JOIN posts p      ON p.id = a.post_id
       JOIN threads t    ON t.id = p.thread_id
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC
      LIMIT $2`,
    [userId, limit],
  )
  return rows
}

export interface NarratorDistributionRow {
  id:             string
  xp:             number
  created_at:     string
  character_id:   string | null
  character_name: string | null
  /** Distribuição pra personagem do /registro-au (trik_018). */
  is_au:          boolean
}

export async function listNarratorDistributions(userId: string, limit = 50): Promise<NarratorDistributionRow[]> {
  const { rows } = await db.query<NarratorDistributionRow>(
    `SELECT d.id, d.xp, d.created_at, d.character_id,
            COALESCE(ch.name, au.name) AS character_name,
            (d.au_character_id IS NOT NULL OR au.id IS NOT NULL) AS is_au
       FROM trik_narrator_distributions d
       LEFT JOIN trik_characters ch    ON ch.id = d.character_id
       LEFT JOIN trik_au_characters au ON au.id = d.au_character_id
      WHERE d.user_id = $1
      ORDER BY d.created_at DESC
      LIMIT $2`,
    [userId, limit],
  )
  return rows
}

export interface NarratorCharacterRow {
  id:          string
  name:        string
  level:       number
  progress_xp: number
  /** xp pra sair do nível atual; null = nível máximo. */
  goal_xp:     number | null
}

/** Personagens do narrador (trik_players.id = users.id). */
export async function listNarratorCharacters(userId: string): Promise<NarratorCharacterRow[]> {
  const { rows } = await db.query(
    `SELECT c.id, c.name,
            COALESCE(g.level, 1)       AS level,
            COALESCE(g.progress_xp, 0) AS progress_xp,
            pr.goal_xp
       FROM trik_characters c
       LEFT JOIN trik_character_progress g ON g.character_id = c.id
       LEFT JOIN trik_progression pr
              ON pr.type = 'character' AND pr.level = COALESCE(g.level, 1)
      WHERE c.player_id = $1
      ORDER BY c.created_at`,
    [userId],
  )
  return rows.map(r => ({
    ...r,
    progress_xp: Number(r.progress_xp),
    goal_xp:     r.goal_xp === null ? null : Number(r.goal_xp),
  }))
}

export interface NarratorAuCharacterRow {
  id:   string
  name: string
  xp:   number
}

/** Personagens do /registro-au do narrador: o xp só acumula (sem nível). */
export async function listNarratorAuCharacters(userId: string): Promise<NarratorAuCharacterRow[]> {
  const { rows } = await db.query(
    `SELECT id, name, xp FROM trik_au_characters WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  )
  return rows.map(r => ({ ...r, xp: Number(r.xp) }))
}

export class NarratorDistributionError extends Error {
  constructor(public code: 'NOT_NARRATOR_CHARACTER' | 'INSUFFICIENT_XP', message: string) {
    super(message)
  }
}

/**
 * Tira `xp` do pool e aplica no personagem (com level up), numa transação só.
 * O lock na linha do usuário serializa duas distribuições simultâneas — sem
 * ele, as duas leriam o mesmo saldo e poderiam gastar além dele.
 */
export async function distributeNarratorXp(
  userId: string, characterId: string, xp: number, adminId: string,
  /** true = personagem do /registro-au: só soma xp, sem level up (trik_018). */
  au = false,
): Promise<{ characterName: string; leveledUp: boolean; balance: NarratorBalance }> {
  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [userId])

    const { rows: chars } = await client.query(
      au
        ? `SELECT name FROM trik_au_characters WHERE id = $1 AND user_id = $2`
        : `SELECT name FROM trik_characters WHERE id = $1 AND player_id = $2`,
      [characterId, userId],
    )
    if (!chars[0]) {
      throw new NarratorDistributionError('NOT_NARRATOR_CHARACTER', 'Esse personagem não é do narrador')
    }

    const before = await balanceOf(client, userId)
    if (xp > before.available) {
      throw new NarratorDistributionError('INSUFFICIENT_XP', `Saldo insuficiente (disponível: ${before.available} xp)`)
    }

    let leveledUp = false
    if (au) {
      await client.query(
        `INSERT INTO trik_narrator_distributions (user_id, au_character_id, xp, created_by)
         VALUES ($1, $2, $3, $4)`,
        [userId, characterId, xp, adminId],
      )
      await client.query(`UPDATE trik_au_characters SET xp = xp + $2 WHERE id = $1`, [characterId, xp])
    } else {
      await client.query(
        `INSERT INTO trik_narrator_distributions (user_id, character_id, xp, created_by)
         VALUES ($1, $2, $3, $4)`,
        [userId, characterId, xp, adminId],
      )
      ;({ leveledUp } = await applyXpInTx(client, characterId, xp))
    }

    await client.query('COMMIT')
    return {
      characterName: chars[0].name,
      leveledUp,
      balance: { ...before, distributed: before.distributed + xp, available: before.available - xp },
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
