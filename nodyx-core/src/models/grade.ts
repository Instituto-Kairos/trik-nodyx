import { db } from '../config/database'
import type { Permission } from '../services/permissions'

// ── Types ────────────────────────────────────────────────────

// Permissions d'un grade : uniquement les permissions de l'équipe
// (services/permissions.ts, GRADE_PERMISSIONS). Un grade AJOUTE ces droits au
// socle du rôle, il n'en retire jamais (migration 126).
export type Permissions = Partial<Record<Permission, boolean>>

export interface Grade {
  id:           string
  community_id: string
  name:         string
  color:        string
  position:     number
  permissions:  Permissions
  created_at:   Date
}

// Grade with member assignment info
export interface MemberGrade extends Grade {
  member_user_id: string
}

// ── Queries ──────────────────────────────────────────────────

export async function listByCommunity(communityId: string): Promise<Grade[]> {
  const { rows } = await db.query<Grade>(
    `SELECT * FROM community_grades
     WHERE community_id = $1
     ORDER BY position ASC, created_at ASC`,
    [communityId]
  )
  return rows
}

export async function findById(id: string): Promise<Grade | null> {
  const { rows } = await db.query<Grade>(
    `SELECT * FROM community_grades WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function create(data: {
  community_id: string
  name:         string
  color?:       string
  position?:    number
  permissions?: Partial<Permissions>
}): Promise<Grade> {
  const { rows } = await db.query<Grade>(
    `INSERT INTO community_grades (community_id, name, color, position, permissions)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      data.community_id,
      data.name,
      data.color       ?? '#99AAB5',
      data.position    ?? 0,
      JSON.stringify(data.permissions ?? {}),
    ]
  )
  return rows[0]
}

export async function update(id: string, communityId: string, data: {
  name?:        string
  color?:       string
  position?:    number
  permissions?: Partial<Permissions>
}): Promise<Grade | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.name        !== undefined) { fields.push(`name = $${i++}`);        values.push(data.name)        }
  if (data.color       !== undefined) { fields.push(`color = $${i++}`);       values.push(data.color)       }
  if (data.position    !== undefined) { fields.push(`position = $${i++}`);    values.push(data.position)    }
  if (data.permissions !== undefined) { fields.push(`permissions = $${i++}`); values.push(JSON.stringify(data.permissions)) }

  if (fields.length === 0) return findById(id)

  values.push(id, communityId)
  const { rows } = await db.query<Grade>(
    `UPDATE community_grades SET ${fields.join(', ')}
     WHERE id = $${i} AND community_id = $${i + 1}
     RETURNING *`,
    values
  )
  return rows[0] ?? null
}

/** Cargo principal de substituição: o primeiro (por posição) dos outros cargos do membro. */
const NEXT_PRIMARY_SQL = `
  SELECT mg.grade_id
    FROM member_grades mg
    JOIN community_grades g ON g.id = mg.grade_id
   WHERE mg.community_id = cm.community_id
     AND mg.user_id      = cm.user_id
     AND mg.grade_id    <> $1::uuid
   ORDER BY g.position ASC, g.created_at ASC
   LIMIT 1`

export async function remove(id: string, communityId: string): Promise<boolean> {
  // Quem tinha este cargo como PRINCIPAL e tem outros passa a exibir o próximo,
  // em vez de ficar sem cargo (o FK zeraria grade_id).
  await db.query(
    `UPDATE community_members cm SET grade_id = (${NEXT_PRIMARY_SQL})
     WHERE cm.community_id = $2 AND cm.grade_id = $1::uuid`,
    [id, communityId]
  )
  const { rowCount } = await db.query(
    `DELETE FROM community_grades WHERE id = $1 AND community_id = $2`,
    [id, communityId]
  )
  return (rowCount ?? 0) > 0
}

/** Todos os cargos de um membro, do mais alto (position menor) ao mais baixo. */
export async function listForMember(communityId: string, userId: string): Promise<Grade[]> {
  const { rows } = await db.query<Grade>(
    `SELECT g.*
       FROM member_grades mg
       JOIN community_grades g ON g.id = mg.grade_id AND g.community_id = mg.community_id
      WHERE mg.community_id = $1 AND mg.user_id = $2
      ORDER BY g.position ASC, g.created_at ASC`,
    [communityId, userId]
  )
  return rows
}

/** Os cargos desta comunidade entre `ids` (ids de outra comunidade ou inexistentes ficam de fora). */
export async function findManyInCommunity(communityId: string, ids: string[]): Promise<Grade[]> {
  if (ids.length === 0) return []
  const { rows } = await db.query<Grade>(
    `SELECT * FROM community_grades WHERE community_id = $1 AND id = ANY($2::uuid[])`,
    [communityId, ids]
  )
  return rows
}

/**
 * Define o conjunto COMPLETO de cargos de um membro (substitui o anterior).
 * O cargo principal (o que aparece ao lado do nome) continua o mesmo se ainda
 * estiver no conjunto; senão vira o de menor position. Conjunto vazio = sem cargo.
 * Tudo numa transação: o membro nunca fica com o conjunto pela metade.
 */
export async function setMemberGrades(
  communityId: string,
  userId: string,
  gradeIds: string[]
): Promise<{ found: boolean; gradeValid: boolean }> {
  const ids = [...new Set(gradeIds)]
  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const member = await client.query(
      `SELECT grade_id FROM community_members WHERE community_id = $1 AND user_id = $2 FOR UPDATE`,
      [communityId, userId]
    )
    if (member.rows.length === 0) {
      await client.query('ROLLBACK')
      return { found: false, gradeValid: true }
    }

    const valid = ids.length === 0 ? { rows: [] as Grade[] } : await client.query<Grade>(
      `SELECT id, position, created_at FROM community_grades
        WHERE community_id = $1 AND id = ANY($2::uuid[])
        ORDER BY position ASC, created_at ASC`,
      [communityId, ids]
    )
    if (valid.rows.length !== ids.length) {
      await client.query('ROLLBACK')
      return { found: true, gradeValid: false }
    }

    await client.query(
      `DELETE FROM member_grades WHERE community_id = $1 AND user_id = $2 AND grade_id <> ALL($3::uuid[])`,
      [communityId, userId, ids]
    )
    if (ids.length > 0) {
      await client.query(
        `INSERT INTO member_grades (community_id, user_id, grade_id)
         SELECT $1, $2, unnest($3::uuid[]) ON CONFLICT DO NOTHING`,
        [communityId, userId, ids]
      )
    }

    const current = member.rows[0].grade_id as string | null
    const primary = current && ids.includes(current) ? current : (valid.rows[0]?.id ?? null)
    await client.query(
      `UPDATE community_members SET grade_id = $3::uuid WHERE community_id = $1 AND user_id = $2`,
      [communityId, userId, primary]
    )

    await client.query('COMMIT')
    return { found: true, gradeValid: true }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Só o cargo PRINCIPAL (o exibido). Para definir o conjunto de cargos use
 * setMemberGrades. O cargo entra também em member_grades (trigger do banco);
 * os outros cargos do membro não são tocados.
 */
export async function assignToMember(
  communityId: string,
  userId: string,
  gradeId: string | null
): Promise<{ found: boolean; gradeValid: boolean }> {
  // Atomic: verify grade belongs to this community in the same statement.
  // $1 est typé (::uuid) à CHAQUE usage : sans type, « $1 IS NULL » laisse
  // PostgreSQL incapable de déduire le type du paramètre et la requête plante
  // (42P08 « could not determine data type of parameter $1 ») pour TOUTE
  // attribution, grade comme retrait. L'attribution n'a jamais marché avant ça.
  const { rowCount } = await db.query(
    `UPDATE community_members SET grade_id = $1::uuid
     WHERE community_id = $2 AND user_id = $3
     AND (
       $1::uuid IS NULL
       OR EXISTS (SELECT 1 FROM community_grades WHERE id = $1::uuid AND community_id = $2)
     )`,
    [gradeId, communityId, userId]
  )
  if ((rowCount ?? 0) > 0) return { found: true, gradeValid: true }

  // Distinguish "grade not in community" from "member not found"
  const { rows } = await db.query(
    `SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2`,
    [communityId, userId]
  )
  const found = rows.length > 0
  return { found, gradeValid: !found } // if member found, grade was invalid
}
