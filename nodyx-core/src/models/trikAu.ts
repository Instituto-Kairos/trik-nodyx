// Módulo RPG (trik) — Universo Alternativo (trik_013). O AU divide o fórum e
// a galeria com o jogo principal; o que muda é o que a menção oferece:
// dentro de uma categoria AU, só aliases/NPCCs/NPCs do AU; fora, nunca eles.
import { db } from '../config/database'
import type { TrikAlias } from './trik'

/**
 * A categoria (ou algum ancestral dela) é raiz de AU? Sobe pelo parent_id;
 * `depth` corta ciclo, se houver. Categoria ausente/nula = universo principal.
 */
export async function isAuCategory(categoryId: string | null | undefined): Promise<boolean> {
  if (!categoryId) return false
  const { rows } = await db.query<{ au: boolean }>(
    `WITH RECURSIVE up(id, parent_id, depth) AS (
       SELECT id, parent_id, 0 FROM categories WHERE id = $1
       UNION ALL
       SELECT c.id, c.parent_id, up.depth + 1
         FROM categories c JOIN up ON c.id = up.parent_id
        WHERE up.depth < 50
     )
     SELECT EXISTS (
       SELECT 1 FROM trik_au_categories a JOIN up ON a.category_id = up.id
     ) AS au`,
    [categoryId],
  )
  return rows[0]?.au ?? false
}

/** Subárvore AU inteira — CTE reaproveitado pelas buscas de NPCC. */
export const AU_TREE_CTE = `au_tree(id) AS (
       SELECT category_id FROM trik_au_categories
       UNION
       SELECT c.id FROM categories c JOIN au_tree ON c.parent_id = au_tree.id
     )`

// ── Admin: raízes do AU (mesmo formato de /notify-categories) ───────────────

export interface TrikAuCategory {
  id:        string
  name:      string
  parent_id: string | null
  position:  number
  enabled:   boolean
}

export async function listAuCategories(communityId: string): Promise<TrikAuCategory[]> {
  const { rows } = await db.query<TrikAuCategory>(
    `SELECT c.id, c.name, c.parent_id, c.position,
            (ac.category_id IS NOT NULL) AS enabled
     FROM categories c
     LEFT JOIN trik_au_categories ac ON ac.category_id = c.id
     WHERE c.community_id = $1
     ORDER BY c.position ASC, c.name ASC`,
    [communityId]
  )
  return rows
}

// Substituição total, como setNotifyCategories.
export async function setAuCategories(
  categoryIds: string[],
  communityId: string,
  adminId: string
): Promise<void> {
  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM trik_au_categories ac
       USING categories c
       WHERE c.id = ac.category_id AND c.community_id = $1`,
      [communityId]
    )
    await client.query(
      `INSERT INTO trik_au_categories (category_id, enabled_by)
       SELECT c.id, $3 FROM categories c
       WHERE c.id = ANY($1::uuid[]) AND c.community_id = $2`,
      [categoryIds, communityId, adminId]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── /alias-au ────────────────────────────────────────────────────────────────

export interface TrikAuAlias {
  id:         string
  name:       string
  created_at: string
}

export async function listMyAuAliases(userId: string): Promise<TrikAuAlias[]> {
  const { rows } = await db.query<TrikAuAlias>(
    `SELECT id, name, created_at FROM trik_au_aliases WHERE user_id = $1 ORDER BY name ASC`,
    [userId]
  )
  return rows
}

/** null = o jogador já tem um alias AU com esse nome (sem diferenciar caixa). */
export async function createAuAlias(userId: string, name: string): Promise<TrikAuAlias | null> {
  const { rows } = await db.query<TrikAuAlias>(
    `INSERT INTO trik_au_aliases (user_id, name) VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING id, name, created_at`,
    [userId, name]
  )
  return rows[0] ?? null
}

/** Só apaga alias do próprio usuário. */
export async function deleteAuAlias(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM trik_au_aliases WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return (rowCount ?? 0) > 0
}

/** Autocomplete de `@` dentro do AU — mesmo formato de searchMentionableAliases. */
export async function searchAuAliases(communityId: string, q: string, limit = 8): Promise<TrikAlias[]> {
  const termo = q.trim()
  const { rows } = await db.query<TrikAlias>(
    `SELECT a.name                       AS alias,
            u.username                   AS username,
            COALESCE(p.name, u.username) AS player_name,
            u.avatar                     AS avatar
       FROM trik_au_aliases a
       JOIN users           u  ON u.id = a.user_id
       LEFT JOIN trik_players p ON p.id = u.id
       JOIN community_members cm ON cm.user_id = u.id AND cm.community_id = $1
      WHERE u.is_system = false
        AND ($2 = '' OR a.name ILIKE $3)
      ORDER BY a.name ASC
      LIMIT $4`,
    [communityId, termo, `%${termo}%`, limit],
  )
  return rows
}
