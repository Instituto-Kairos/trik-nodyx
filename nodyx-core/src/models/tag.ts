import { db } from '../config/database'

export interface Tag {
  id:           string
  community_id: string
  name:         string
  slug:         string
  color:        string
  position:     number
  created_at:   Date
  /** Categorias onde a tag vale. Vazio = todas (trik: migration 144). */
  category_ids?: string[]
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

/** Todas as tags, na ordem definida pela equipe, cada uma com o número de tópicos que a usam. */
export async function listByCommunity(communityId: string): Promise<Array<Tag & { thread_count: number }>> {
  const { rows } = await db.query<Tag & { thread_count: number }>(
    `SELECT t.*, (SELECT COUNT(*)::int FROM thread_tags tt WHERE tt.tag_id = t.id) AS thread_count,
            COALESCE((SELECT array_agg(tc.category_id) FROM tag_categories tc WHERE tc.tag_id = t.id), '{}') AS category_ids
       FROM tags t WHERE t.community_id = $1 ORDER BY t.position ASC, t.name ASC`,
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
    `INSERT INTO tags (community_id, name, slug, color, position)
     VALUES ($1, $2, $3, $4,
       (SELECT COALESCE(MAX(position), 0) + 1 FROM tags WHERE community_id = $1))
     RETURNING *`,
    [data.community_id, data.name, slug, data.color]
  )
  return rows[0]
}

/**
 * Grava a ordem das tags: `ids` na sequência desejada vira position 1..n.
 * Só toca tags desta comunidade; ids desconhecidos são ignorados. Tags que
 * ficaram fora da lista vão para depois das listadas, mantendo a ordem relativa.
 */
export async function reorder(communityId: string, ids: string[]): Promise<void> {
  await db.query(
    `WITH ordem AS (
       SELECT t.id,
              ROW_NUMBER() OVER (
                ORDER BY COALESCE(a.ord, 2147483647), t.position, t.name
              ) AS rn
         FROM tags t
         LEFT JOIN unnest($2::uuid[]) WITH ORDINALITY AS a(id, ord) ON a.id = t.id
        WHERE t.community_id = $1
     )
     UPDATE tags SET position = ordem.rn
       FROM ordem
      WHERE tags.id = ordem.id`,
    [communityId, ids]
  )
}

/** Renommer ou recolorer. Le slug suit le nom (il ne sert dans aucune adresse). Null si absent. */
export async function update(id: string, communityId: string, data: { name?: string; color?: string }): Promise<Tag | null> {
  const sets: string[] = []
  const vals: unknown[] = [id, communityId]
  if (data.name !== undefined) {
    vals.push(data.name); sets.push(`name = $${vals.length}`)
    vals.push(slugify(data.name)); sets.push(`slug = $${vals.length}`)
  }
  if (data.color !== undefined) { vals.push(data.color); sets.push(`color = $${vals.length}`) }
  if (!sets.length) return null
  const { rows } = await db.query<Tag>(
    `UPDATE tags SET ${sets.join(', ')} WHERE id = $1 AND community_id = $2 RETURNING *`,
    vals
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
     ORDER BY t.position ASC, t.name ASC`,
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
     ORDER BY t.position ASC, t.name ASC`,
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

/**
 * Les tags d'un sujet deviennent EXACTEMENT ceux demandés, en UNE requête :
 * tout ou rien. Avant, on effaçait puis on réinsérait en deux temps ; une
 * coupure entre les deux laissait le sujet sans aucun tag.
 * Seuls les tags qui existent sont posés, sans doublon : un identifiant en
 * double ou disparu entre-temps ne fait plus tomber l'enregistrement du sujet.
 * Ceux qui restent ne sont pas touchés (ni effacés, ni recréés).
 */
export async function setThreadTags(threadId: string, tagIds: string[]): Promise<void> {
  await db.query(
    `WITH wanted AS (SELECT t.id FROM tags t WHERE t.id = ANY($2::uuid[])),
          gone   AS (DELETE FROM thread_tags WHERE thread_id = $1 AND tag_id NOT IN (SELECT id FROM wanted))
     INSERT INTO thread_tags (thread_id, tag_id)
     SELECT $1, id FROM wanted
     ON CONFLICT DO NOTHING`,
    [threadId, [...new Set(tagIds)]]
  )
}

/**
 * As categorias onde a tag vale passam a ser EXATAMENTE `categoryIds` (vazio =
 * todas). Só aceita categorias desta comunidade; devolve false se alguma não for.
 */
export async function setCategories(tagId: string, communityId: string, categoryIds: string[]): Promise<boolean> {
  const ids = [...new Set(categoryIds.map((c) => c.toLowerCase()))]
  if (ids.length) {
    const { rows } = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM categories WHERE id = ANY($1::uuid[]) AND community_id = $2`,
      [ids, communityId]
    )
    if ((rows[0]?.n ?? 0) !== ids.length) return false
  }
  await db.query(
    `WITH gone AS (DELETE FROM tag_categories WHERE tag_id = $1 AND category_id <> ALL($2::uuid[]))
     INSERT INTO tag_categories (tag_id, category_id)
     SELECT $1, c FROM unnest($2::uuid[]) AS c
     ON CONFLICT DO NOTHING`,
    [tagId, ids]
  )
  return true
}

/** Das `tagIds`, as que NÃO podem ser usadas em `categoryId`. */
export async function tagsNotAllowedIn(categoryId: string, tagIds: string[]): Promise<string[]> {
  if (!tagIds.length) return []
  const { rows } = await db.query<{ id: string }>(
    `SELECT t.id FROM tags t
      WHERE t.id = ANY($1::uuid[])
        AND EXISTS (SELECT 1 FROM tag_categories tc WHERE tc.tag_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM tag_categories tc WHERE tc.tag_id = t.id AND tc.category_id = $2)`,
    [tagIds, categoryId]
  )
  return rows.map((r) => r.id)
}
