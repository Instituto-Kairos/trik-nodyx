import { db } from '../config/database'

export interface Tag {
  id:           string
  community_id: string
  name:         string
  slug:         string
  color:        string
  created_at:   Date
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

export async function listByCommunity(communityId: string): Promise<Tag[]> {
  const { rows } = await db.query<Tag>(
    `SELECT * FROM tags WHERE community_id = $1 ORDER BY name ASC`,
    [communityId]
  )
  return rows
}

export async function create(data: {
  community_id: string
  name:         string
  color:        string
}): Promise<Tag> {
  const slug = slugify(data.name)
  const { rows } = await db.query<Tag>(
    `INSERT INTO tags (community_id, name, slug, color)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.community_id, data.name, slug, data.color]
  )
  return rows[0]
}

/**
 * Renomeia e/ou recolore uma tag. O slug acompanha o nome, e os tópicos não
 * precisam ser tocados: thread_tags aponta para o id. Devolve null se a tag
 * não existir nesta comunidade; um slug repetido estoura como 23505 (UNIQUE).
 */
export async function update(id: string, communityId: string, data: {
  name?:  string
  color?: string
}): Promise<Tag | null> {
  const { rows } = await db.query<Tag>(
    `UPDATE tags
        SET name  = COALESCE($3, name),
            slug  = COALESCE($4, slug),
            color = COALESCE($5, color)
      WHERE id = $1 AND community_id = $2
      RETURNING *`,
    [id, communityId, data.name ?? null, data.name ? slugify(data.name) : null, data.color ?? null]
  )
  return rows[0] ?? null
}

export async function remove(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM tags WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}

export async function getTagsForThread(threadId: string): Promise<Tag[]> {
  const { rows } = await db.query<Tag>(
    `SELECT t.* FROM tags t
     JOIN thread_tags tt ON tt.tag_id = t.id
     WHERE tt.thread_id = $1
     ORDER BY t.name ASC`,
    [threadId]
  )
  return rows
}

export async function getTagsForThreads(threadIds: string[]): Promise<Map<string, Tag[]>> {
  if (threadIds.length === 0) return new Map()

  const { rows } = await db.query<Tag & { thread_id: string }>(
    `SELECT t.*, tt.thread_id FROM tags t
     JOIN thread_tags tt ON tt.tag_id = t.id
     WHERE tt.thread_id = ANY($1)
     ORDER BY t.name ASC`,
    [threadIds]
  )

  const map = new Map<string, Tag[]>()
  for (const row of rows) {
    const { thread_id, ...tag } = row as Tag & { thread_id: string }
    if (!map.has(thread_id)) map.set(thread_id, [])
    map.get(thread_id)!.push(tag as Tag)
  }
  return map
}

export async function setThreadTags(threadId: string, tagIds: string[]): Promise<void> {
  await db.query(`DELETE FROM thread_tags WHERE thread_id = $1`, [threadId])
  if (tagIds.length > 0) {
    const values = tagIds.map((_, i) => `($1, $${i + 2})`).join(', ')
    await db.query(
      `INSERT INTO thread_tags (thread_id, tag_id) VALUES ${values}`,
      [threadId, ...tagIds]
    )
  }
}
