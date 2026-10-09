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
    `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND is_system = false LIMIT 1`,
    [NARRADOR.username],
  )
  return rows[0]?.id ?? null
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
}

export async function listNarratorDistributions(userId: string, limit = 50): Promise<NarratorDistributionRow[]> {
  const { rows } = await db.query<NarratorDistributionRow>(
    `SELECT d.id, d.xp, d.created_at, d.character_id, ch.name AS character_name
       FROM trik_narrator_distributions d
       LEFT JOIN trik_characters ch ON ch.id = d.character_id
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
): Promise<{ characterName: string; leveledUp: boolean; balance: NarratorBalance }> {
  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [userId])

    const { rows: chars } = await client.query(
      `SELECT name FROM trik_characters WHERE id = $1 AND player_id = $2`,
      [characterId, userId],
    )
    if (!chars[0]) {
      throw new NarratorDistributionError('NOT_NARRATOR_CHARACTER', 'Esse personagem não é do narrador')
    }

    const before = await balanceOf(client, userId)
    if (xp > before.available) {
      throw new NarratorDistributionError('INSUFFICIENT_XP', `Saldo insuficiente (disponível: ${before.available} xp)`)
    }

    await client.query(
      `INSERT INTO trik_narrator_distributions (user_id, character_id, xp, created_by)
       VALUES ($1, $2, $3, $4)`,
      [userId, characterId, xp, adminId],
    )
    const { leveledUp } = await applyXpInTx(client, characterId, xp)

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
