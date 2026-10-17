// Troca de nome de usuário + histórico de nomes antigos (trik_011).
// Ver o comentário da migration: o histórico mantém menções e links antigos
// apontando pra conta certa e reserva os nomes já usados.

import { db } from '../config/database'

/** Intervalo mínimo entre duas trocas do mesmo usuário. */
export const USERNAME_CHANGE_INTERVAL_DAYS = 30

/**
 * O nome está ocupado por OUTRA conta — como nome atual ou como nome antigo?
 * Sem diferenciar maiúsculas: "Ana" e "ana" num mesmo fórum confundem quem
 * lê e quem menciona. O próprio usuário pode retomar um nome que já foi dele.
 */
export async function isUsernameTaken(username: string, exceptUserId: string | null = null): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) AND ($2::uuid IS NULL OR id <> $2)
     UNION ALL
     SELECT 1 FROM username_history WHERE LOWER(old_username) = LOWER($1) AND ($2::uuid IS NULL OR user_id <> $2)
     LIMIT 1`,
    [username.trim(), exceptUserId]
  )
  return rows.length > 0
}

/** Nome atual de quem usou `username` antes (null = nome nunca existiu). */
export async function resolveRenamedUsername(username: string): Promise<string | null> {
  const { rows } = await db.query<{ username: string }>(
    `SELECT u.username FROM username_history h JOIN users u ON u.id = h.user_id
      WHERE LOWER(h.old_username) = LOWER($1) LIMIT 1`,
    [username]
  )
  return rows[0]?.username ?? null
}

/** Quando a próxima troca fica liberada (null = já pode trocar). */
export async function nextUsernameChangeAt(userId: string): Promise<Date | null> {
  const { rows } = await db.query<{ next_at: Date }>(
    `SELECT MAX(changed_at) + make_interval(days => $2) AS next_at
       FROM username_history WHERE user_id = $1`,
    [userId, USERNAME_CHANGE_INTERVAL_DAYS]
  )
  const next = rows[0]?.next_at
  return next && new Date(next) > new Date() ? new Date(next) : null
}

export class UsernameChangeError extends Error {
  constructor(public code: 'TAKEN' | 'TOO_SOON' | 'SAME' | 'NOT_FOUND', message: string) {
    super(message)
  }
}

/**
 * Troca o nome numa transação: trava a linha do usuário, confere de novo o
 * intervalo e a disponibilidade (a checagem da rota é fora de transação),
 * guarda o nome antigo e grava o novo. Retomar um nome antigo próprio tira
 * ele do histórico (volta a ser o atual).
 */
export async function changeUsername(userId: string, newUsername: string): Promise<{ oldUsername: string; username: string }> {
  const username = newUsername.trim()
  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT username FROM users WHERE id = $1 FOR UPDATE`, [userId])
    if (!rows[0]) throw new UsernameChangeError('NOT_FOUND', 'Usuário não encontrado')
    const oldUsername = rows[0].username as string
    if (oldUsername === username) throw new UsernameChangeError('SAME', 'Esse já é o seu nome de usuário')

    const { rows: recent } = await client.query(
      `SELECT 1 FROM username_history
        WHERE user_id = $1 AND changed_at > NOW() - make_interval(days => $2) LIMIT 1`,
      [userId, USERNAME_CHANGE_INTERVAL_DAYS]
    )
    if (recent.length > 0) {
      throw new UsernameChangeError('TOO_SOON', `Só dá pra trocar o nome uma vez a cada ${USERNAME_CHANGE_INTERVAL_DAYS} dias`)
    }

    const { rows: taken } = await client.query(
      `SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2
       UNION ALL
       SELECT 1 FROM username_history WHERE LOWER(old_username) = LOWER($1) AND user_id <> $2
       LIMIT 1`,
      [username, userId]
    )
    if (taken.length > 0) throw new UsernameChangeError('TAKEN', 'Esse nome de usuário já está em uso')

    await client.query(
      `DELETE FROM username_history WHERE user_id = $1 AND LOWER(old_username) = LOWER($2)`,
      [userId, username]
    )
    // Registra sempre, inclusive quando só a caixa muda ("ana" → "Ana"): a
    // linha é o que conta o intervalo de 30 dias, e apontar pro próprio dono
    // não reserva nada de ninguém. Conflito só pode ser com linha do próprio
    // usuário (o índice é único e o nome antigo é dele).
    await client.query(
      `INSERT INTO username_history (user_id, old_username) VALUES ($1, $2)
       ON CONFLICT (LOWER(old_username)) DO UPDATE SET changed_at = NOW()`,
      [userId, oldUsername]
    )
    await client.query(`UPDATE users SET username = $2, updated_at = NOW() WHERE id = $1`, [userId, username])
    await client.query('COMMIT')
    return { oldUsername, username }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if ((err as { code?: string })?.code === '23505') {
      throw new UsernameChangeError('TAKEN', 'Esse nome de usuário já está em uso')
    }
    throw err
  } finally {
    client.release()
  }
}
