import { db } from '../config/database'

export type NotificationType = 'thread_reply' | 'post_thanks' | 'mention' | 'wave'

export interface Notification {
  id:         string
  user_id:    string
  type:       NotificationType
  actor_id:   string | null
  thread_id:  string | null
  post_id:    string | null
  is_read:    boolean
  created_at: Date
}

export interface NotificationWithActor extends Notification {
  actor_username: string | null
  actor_avatar:   string | null
  thread_title:   string | null
  category_id:    string | null
  // Para montar o link canônico sem uma segunda ida ao servidor. Sem os slugs
  // o link cai nos UUIDs, que funcionam mas custam um redirect 301 a cada
  // clique (a página do tópico reescreve para a forma canônica).
  category_slug:  string | null
  thread_slug:    string | null
  // Quantos posts do tópico vêm ANTES do post citado, para descobrir em que
  // página ele está. Um tópico é paginado de 30 em 30: sem isto o link levava
  // sempre à página 1, e a mensagem que gerou a notificação simplesmente não
  // estava no DOM — a âncora não tinha onde ancorar.
  post_index:     number | null
}

export async function create(data: {
  user_id:   string
  type:      string
  actor_id?: string | null
  thread_id?: string | null
  post_id?:   string | null
}): Promise<Notification> {
  const { rows } = await db.query<Notification>(
    `INSERT INTO notifications (user_id, type, actor_id, thread_id, post_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.user_id, data.type, data.actor_id ?? null, data.thread_id ?? null, data.post_id ?? null]
  )
  return rows[0]
}

export async function listForUser(
  userId: string,
  limit   = 30
): Promise<NotificationWithActor[]> {
  const { rows } = await db.query<NotificationWithActor>(
    // `post_index` conta os posts ANTERIORES ao citado, na MESMA ordenação que
    // a listagem do tópico usa (posts.created_at ASC). Empate de created_at
    // fica indefinido dos dois lados — a listagem também não desempata —, e no
    // pior caso a âncora cai na página vizinha.
    `SELECT n.*,
            u.username     AS actor_username,
            u.avatar       AS actor_avatar,
            t.title        AS thread_title,
            t.category_id  AS category_id,
            t.slug         AS thread_slug,
            cat.slug       AS category_slug,
            CASE WHEN p.id IS NULL THEN NULL ELSE (
              SELECT COUNT(*)::int FROM posts p2
              WHERE p2.thread_id = p.thread_id AND p2.created_at < p.created_at
            ) END          AS post_index
     FROM notifications n
     LEFT JOIN users      u   ON u.id  = n.actor_id
     LEFT JOIN threads    t   ON t.id  = n.thread_id
     LEFT JOIN categories cat ON cat.id = t.category_id
     LEFT JOIN posts      p   ON p.id  = n.post_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [userId, limit]
  )
  return rows
}

export async function markAsRead(id: string, userId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return (rowCount ?? 0) > 0
}

export async function markAllAsRead(userId: string): Promise<void> {
  await db.query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [userId]
  )
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
    [userId]
  )
  return rows[0].count
}

// Supprime toutes les notifications lues d'un utilisateur
export async function deleteAllRead(userId: string): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM notifications WHERE user_id = $1 AND is_read = true`,
    [userId]
  )
  return rowCount ?? 0
}

// Purge globale : supprime les notifications lues de plus de 30 jours
export async function purgeOldRead(daysOld = 30): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM notifications WHERE is_read = true AND created_at < NOW() - ($1 * INTERVAL '1 day')`,
    [daysOld]
  )
  return rowCount ?? 0
}
