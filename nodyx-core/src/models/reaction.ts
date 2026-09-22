import { db } from '../config/database'

export interface ReactionUser {
  username:   string
  name_color: string | null
  created_at: string  // ISO timestamp pour calculer "il y a X" côté frontend
}

export interface ReactionSummary {
  emoji:        string
  count:        number
  user_reacted: boolean
  users:        ReactionUser[]  // top 8 par (post_id, emoji), tri DESC par created_at
}

// Plafond du nombre d'usernames retournés par emoji pour le tooltip.
// Au-delà, on affiche "+N autres" côté frontend (le count total reste exact).
const USERS_PER_EMOJI_LIMIT = 8

// Primitivas idempotentes (add sempre adiciona, remove sempre remove) — ao
// contrário de toggleReaction, que inverte o estado. Usadas pelo bot Trik
// (services/trik/bot.ts) pra marcar/desmarcar "essa cena contou xp" sem
// depender de saber o estado atual antes de chamar.
export async function addReaction(postId: string, userId: string, emoji: string): Promise<void> {
  await db.query(
    `INSERT INTO post_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [postId, userId, emoji]
  )
}

export async function removeReaction(postId: string, userId: string, emoji: string): Promise<void> {
  await db.query(
    `DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3`,
    [postId, userId, emoji]
  )
}

export async function toggleReaction(
  postId: string,
  userId: string,
  emoji:  string
): Promise<{ added: boolean }> {

  const { rows } = await db.query(
    `SELECT 1 FROM post_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3`,
    [postId, userId, emoji]
  )

  if (rows.length > 0) {
    await db.query(
      `DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3`,
      [postId, userId, emoji]
    )
    return { added: false }
  }

  await db.query(
    `INSERT INTO post_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [postId, userId, emoji]
  )
  return { added: true }
}

// Bulk fetch reactions pour une liste de post_id.
// Fait 2 queries au lieu d'une triple-jointure pour rester lisible :
//   - Q1 : aggregat (count + user_reacted par emoji)
//   - Q2 : top 8 users récents par (post_id, emoji) avec username + name_color
// Le merge se fait en JS, complexité O(n+m).
export async function getReactionsForPosts(
  postIds:   string[],
  viewerId?: string
): Promise<Map<string, ReactionSummary[]>> {
  if (postIds.length === 0) return new Map()

  const viewer = viewerId ?? '00000000-0000-0000-0000-000000000000'

  // ── Q1 : aggregat des counts ────────────────────────────────────────────
  const [{ rows: aggregateRows }, { rows: userRows }] = await Promise.all([
    db.query<{
      post_id:      string
      emoji:        string
      count:        number
      user_reacted: boolean
    }>(
      `SELECT post_id, emoji, COUNT(*)::int AS count,
              BOOL_OR(user_id = $2) AS user_reacted
       FROM post_reactions
       WHERE post_id = ANY($1)
       GROUP BY post_id, emoji
       ORDER BY post_id, count DESC`,
      [postIds, viewer]
    ),
    // ── Q2 : top N users récents par (post_id, emoji) via ROW_NUMBER ─────
    // Window function pour ne sortir que les 8 plus récents par paire.
    db.query<{
      post_id:    string
      emoji:      string
      username:   string
      name_color: string | null
      created_at: Date
    }>(
      `SELECT post_id, emoji, username, name_color, created_at
       FROM (
         SELECT
           pr.post_id,
           pr.emoji,
           u.username,
           up.name_color,
           pr.created_at,
           ROW_NUMBER() OVER (
             PARTITION BY pr.post_id, pr.emoji
             ORDER BY pr.created_at DESC
           ) AS rn
         FROM post_reactions pr
         JOIN users u ON u.id = pr.user_id
         LEFT JOIN user_profiles up ON up.user_id = pr.user_id
         WHERE pr.post_id = ANY($1)
       ) ranked
       WHERE rn <= $2`,
      [postIds, USERS_PER_EMOJI_LIMIT]
    ),
  ])

  // ── Merge : on indexe les users par (post_id|emoji) ────────────────────
  const userIndex = new Map<string, ReactionUser[]>()
  for (const u of userRows) {
    const key = `${u.post_id}|${u.emoji}`
    if (!userIndex.has(key)) userIndex.set(key, [])
    userIndex.get(key)!.push({
      username:   u.username,
      name_color: u.name_color,
      created_at: u.created_at.toISOString(),
    })
  }

  const map = new Map<string, ReactionSummary[]>()
  for (const row of aggregateRows) {
    const key = `${row.post_id}|${row.emoji}`
    if (!map.has(row.post_id)) map.set(row.post_id, [])
    map.get(row.post_id)!.push({
      emoji:        row.emoji,
      count:        row.count,
      user_reacted: row.user_reacted,
      users:        userIndex.get(key) ?? [],
    })
  }
  return map
}
