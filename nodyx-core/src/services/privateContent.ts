// Conteúdo privado por cargo (trik_025): categorias e tópicos visíveis só para
// certos grades. A REGRA mora no banco (nx_can_view_category / nx_can_view_thread,
// ver migrations/trik_025_conteudo_privado.sql); aqui ficam os atalhos para usá-la
// em SQL e em código, e a leitura/gravação das listas de cargos.
//
// Toda leitura de conteúdo do fórum precisa passar por um destes filtros. Um
// ponto esquecido é um vazamento — por isso os trechos de SQL saem daqui, prontos.

import { db } from '../config/database'

/**
 * Trecho SQL: o tópico `alias` é visível para o usuário no parâmetro `param`
 * (ex.: `$3`). Um parâmetro NULL = visitante sem conta.
 */
export function threadVisibleSql(alias: string, param: string): string {
  return `nx_can_view_thread(${alias}.id, ${param}::uuid)`
}

/** Trecho SQL: a categoria `alias` é visível para o usuário em `param`. */
export function categoryVisibleSql(alias: string, param: string): string {
  return `nx_can_view_category(${alias}.id, ${param}::uuid)`
}

/** Trecho SQL: o tópico `alias` não tem restrição nenhuma (público para todos). */
export function threadPublicSql(alias: string): string {
  return `nx_can_view_thread(${alias}.id, NULL)`
}

export async function canViewThread(threadId: string, userId: string | null | undefined): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT nx_can_view_thread($1::uuid, $2::uuid) AS ok`, [threadId, userId ?? null])
  return rows[0]?.ok === true
}

export async function canViewCategory(categoryId: string, userId: string | null | undefined): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT nx_can_view_category($1::uuid, $2::uuid) AS ok`, [categoryId, userId ?? null])
  return rows[0]?.ok === true
}

/** Dos usuários dados, os que podem ver o tópico (menções, avisos, notificações). */
export async function usersWhoCanViewThread(threadId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return []
  const { rows } = await db.query<{ id: string }>(
    `SELECT u.id FROM unnest($2::uuid[]) AS u(id) WHERE nx_can_view_thread($1::uuid, u.id)`,
    [threadId, userIds])
  return rows.map(r => r.id)
}

export interface GradeRef { id: string; name: string; color: string }

export async function getThreadGrades(threadId: string): Promise<GradeRef[]> {
  const { rows } = await db.query<GradeRef>(
    `SELECT g.id, g.name, g.color FROM thread_grades tg JOIN community_grades g ON g.id = tg.grade_id
      WHERE tg.thread_id = $1 ORDER BY g.position, g.name`, [threadId])
  return rows
}

export async function getCategoryGrades(categoryId: string): Promise<GradeRef[]> {
  const { rows } = await db.query<GradeRef>(
    `SELECT g.id, g.name, g.color FROM category_grades cg JOIN community_grades g ON g.id = cg.grade_id
      WHERE cg.category_id = $1 ORDER BY g.position, g.name`, [categoryId])
  return rows
}

/**
 * Valida uma lista de cargos: todos existem e são DESTA comunidade.
 * Devolve a lista sem repetições, ou null se algum for inválido.
 */
export async function validGradeIds(communityId: string, ids: unknown): Promise<string[] | null> {
  if (!Array.isArray(ids)) return null
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!ids.every(i => typeof i === 'string' && uuid.test(i))) return null
  const unique = [...new Set((ids as string[]).map(i => i.toLowerCase()))]
  if (unique.length > 50) return null
  if (!unique.length) return []
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM community_grades WHERE community_id = $1 AND id = ANY($2::uuid[])`,
    [communityId, unique])
  return rows[0]?.n === unique.length ? unique : null
}

/** Troca a lista de cargos de um tópico (vazia = tópico segue a categoria). */
export async function setThreadGrades(threadId: string, gradeIds: string[]): Promise<void> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM thread_grades WHERE thread_id = $1`, [threadId])
    if (gradeIds.length) {
      await client.query(
        `INSERT INTO thread_grades (thread_id, grade_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [threadId, gradeIds])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Troca a lista de cargos de uma categoria (vazia = categoria pública). */
export async function setCategoryGrades(categoryId: string, gradeIds: string[]): Promise<void> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM category_grades WHERE category_id = $1`, [categoryId])
    if (gradeIds.length) {
      await client.query(
        `INSERT INTO category_grades (category_id, grade_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [categoryId, gradeIds])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** O cargo de um membro (ou null): o autor só pode restringir um tópico ao próprio cargo. */
export async function memberGradeId(communityId: string, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ grade_id: string | null }>(
    `SELECT grade_id FROM community_members WHERE community_id = $1 AND user_id = $2`, [communityId, userId])
  return rows[0]?.grade_id ?? null
}
