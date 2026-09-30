import { db } from '../config/database'
import { getReactionsForPosts, type ReactionSummary } from './reaction'
import { getThanksForPosts } from './thanks'

// ── Types ────────────────────────────────────────────────────

export interface Post {
  id:         string
  thread_id:  string
  author_id:  string
  content:    string
  // Módulo RPG (trik): post que este continua na cena (mesmo tópico) — trik_004.
  reply_to_id: string | null
  is_edited:  boolean
  created_at: Date
  updated_at: Date
}

// Post with author info — used in thread view
export interface PostWithAuthor extends Post {
  author_username:          string
  author_avatar:            string | null
  author_name_color:        string | null
  author_name_glow:         string | null
  author_name_glow_intensity: number | null
  author_name_animation:    string | null
  author_name_font_family:  string | null
  author_name_font_url:     string | null
  author_points:            number
  author_tags:         string[]
  author_member_since: Date
  author_grade_name:   string | null
  author_grade_color:  string | null
  // Social
  reactions:    ReactionSummary[]
  thanks_count: number
  user_thanked: boolean
  // Fio de cena (trik): de onde este post vem e quem o continua.
  scene: SceneLinks
}

// Referência a outro post do tópico. `post_index` = quantos posts vêm antes
// dele (a página é floor(post_index / POSTS_PER_PAGE) + 1, como nas
// notificações), então o frontend monta o link sem nova consulta.
export interface ScenePostRef {
  id:              string
  author_username: string
  post_index:      number
}

export interface SceneLinks {
  // Ancestrais do mais antigo ao mais próximo. Cena longa vem aparada: o
  // primeiro post da cena + os SCENE_TRAIL_TAIL mais próximos; `chain_length`
  // diz quantos há ao todo, para o frontend marcar o trecho omitido.
  chain:        ScenePostRef[]
  chain_length: number
  // Posts que continuam este diretamente, em ordem cronológica.
  replies:      ScenePostRef[]
}

const SCENE_TRAIL_TAIL = 3
// Teto da recursão. reply_to_id só aponta para um post que já existia, então
// ciclo não se forma — o teto é só para uma cena absurda não custar caro.
const SCENE_MAX_DEPTH  = 1000

// ── Queries ──────────────────────────────────────────────────

export async function findById(id: string): Promise<PostWithAuthor | null> {
  const { rows } = await db.query<PostWithAuthor>(
    `SELECT p.*,
            u.username   AS author_username,
            u.avatar     AS author_avatar,
            up.name_color          AS author_name_color,
            up.name_glow           AS author_name_glow,
            up.name_glow_intensity AS author_name_glow_intensity,
            up.name_animation      AS author_name_animation,
            up.name_font_family    AS author_name_font_family,
            up.name_font_url       AS author_name_font_url,
            u.points     AS author_points,
            u.created_at AS author_member_since,
            COALESCE(up.tags, '{}') AS author_tags,
            cg.name      AS author_grade_name,
            cg.color     AS author_grade_color
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN user_profiles up ON up.user_id = p.author_id
     JOIN threads t ON t.id = p.thread_id
     JOIN categories cat ON cat.id = t.category_id
     LEFT JOIN community_members cm ON cm.community_id = cat.community_id AND cm.user_id = p.author_id
     LEFT JOIN community_grades cg ON cg.id = cm.grade_id
     WHERE p.id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function listByThread(threadId: string, opts: {
  limit?:    number
  offset?:   number
  viewerId?: string
} = {}): Promise<PostWithAuthor[]> {
  const limit  = opts.limit  ?? 30
  const offset = opts.offset ?? 0
  const { rows } = await db.query<PostWithAuthor>(
    `SELECT p.*,
            u.username   AS author_username,
            u.avatar     AS author_avatar,
            up.name_color          AS author_name_color,
            up.name_glow           AS author_name_glow,
            up.name_glow_intensity AS author_name_glow_intensity,
            up.name_animation      AS author_name_animation,
            up.name_font_family    AS author_name_font_family,
            up.name_font_url       AS author_name_font_url,
            u.points     AS author_points,
            u.created_at AS author_member_since,
            COALESCE(up.tags, '{}') AS author_tags,
            cg.name      AS author_grade_name,
            cg.color     AS author_grade_color
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN user_profiles up ON up.user_id = p.author_id
     JOIN threads t ON t.id = p.thread_id
     JOIN categories cat ON cat.id = t.category_id
     LEFT JOIN community_members cm ON cm.community_id = cat.community_id AND cm.user_id = p.author_id
     LEFT JOIN community_grades cg ON cg.id = cm.grade_id
     WHERE p.thread_id = $1
     ORDER BY p.created_at ASC, p.id ASC
     LIMIT $2 OFFSET $3`,
    [threadId, limit, offset]
  )

  if (rows.length === 0) return rows

  const postIds = rows.map(p => p.id)
  const [reactionsMap, thanksMap, sceneMap] = await Promise.all([
    getReactionsForPosts(postIds, opts.viewerId),
    getThanksForPosts(postIds, opts.viewerId),
    getSceneLinks(threadId, postIds),
  ])

  return rows.map(p => ({
    ...p,
    reactions:    reactionsMap.get(p.id) ?? [],
    thanks_count: thanksMap.get(p.id)?.count        ?? 0,
    user_thanked: thanksMap.get(p.id)?.user_thanked ?? false,
    scene:        sceneMap.get(p.id) ?? { chain: [], chain_length: 0, replies: [] },
  }))
}

// Breadcrumb e continuações dos posts de UMA página do tópico, em duas
// consultas para a página inteira (nunca uma por post).
//
// `idx` numera o tópico todo numa passada só, na mesma ordenação da listagem
// (created_at, id): contar "posts anteriores" com subconsulta por ancestral
// custaria uma varredura do tópico para cada elo de cada cena.
export async function getSceneLinks(threadId: string, postIds: string[]): Promise<Map<string, SceneLinks>> {
  const out = new Map<string, SceneLinks>()
  if (postIds.length === 0) return out

  const idxCte = `
    idx AS (
      SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at, id) - 1)::int AS post_index
      FROM posts WHERE thread_id = $1
    )`

  const [chains, replies] = await Promise.all([
    db.query<{ origin_id: string; depth: number; total: number } & ScenePostRef>(
      `WITH RECURSIVE chain AS (
         SELECT p.id AS origin_id, p.reply_to_id AS ancestor_id, 1 AS depth
         FROM posts p
         WHERE p.id = ANY($2::uuid[]) AND p.reply_to_id IS NOT NULL
         UNION ALL
         SELECT c.origin_id, a.reply_to_id, c.depth + 1
         FROM chain c
         JOIN posts a ON a.id = c.ancestor_id
         WHERE a.reply_to_id IS NOT NULL AND c.depth < ${SCENE_MAX_DEPTH}
       ),
       ranked AS (
         SELECT c.*, MAX(c.depth) OVER (PARTITION BY c.origin_id) AS total
         FROM chain c
       ),
       ${idxCte}
       SELECT r.origin_id, r.depth, r.total::int AS total,
              a.id, u.username AS author_username, i.post_index
       FROM ranked r
       JOIN posts a ON a.id = r.ancestor_id
       JOIN users u ON u.id = a.author_id
       JOIN idx   i ON i.id = a.id
       WHERE r.depth <= ${SCENE_TRAIL_TAIL} OR r.depth = r.total
       ORDER BY r.origin_id, r.depth DESC`,
      [threadId, postIds]
    ),
    db.query<{ parent_id: string } & ScenePostRef>(
      `WITH ${idxCte}
       SELECT c.reply_to_id AS parent_id, c.id, u.username AS author_username, i.post_index
       FROM posts c
       JOIN users u ON u.id = c.author_id
       JOIN idx   i ON i.id = c.id
       WHERE c.reply_to_id = ANY($2::uuid[])
       ORDER BY i.post_index`,
      [threadId, postIds]
    ),
  ])

  const entry = (id: string): SceneLinks => {
    let e = out.get(id)
    if (!e) { e = { chain: [], chain_length: 0, replies: [] }; out.set(id, e) }
    return e
  }
  for (const r of chains.rows) {
    const e = entry(r.origin_id)
    e.chain.push({ id: r.id, author_username: r.author_username, post_index: r.post_index })
    e.chain_length = r.total
  }
  for (const r of replies.rows) {
    entry(r.parent_id).replies.push({ id: r.id, author_username: r.author_username, post_index: r.post_index })
  }
  return out
}

// Alvo de uma resposta encadeada: só o necessário para validar (mesmo tópico)
// e notificar o autor.
export async function getReplyTarget(id: string): Promise<{ id: string; thread_id: string; author_id: string } | null> {
  const { rows } = await db.query<{ id: string; thread_id: string; author_id: string }>(
    `SELECT id, thread_id, author_id FROM posts WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function create(data: {
  thread_id:    string
  author_id:    string
  content:      string
  reply_to_id?: string | null
}): Promise<Post> {
  const { rows } = await db.query<Post>(
    `INSERT INTO posts (thread_id, author_id, content, reply_to_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.thread_id, data.author_id, data.content, data.reply_to_id ?? null]
  )
  return rows[0]
}

export async function update(id: string, authorId: string, content: string): Promise<Post | null> {
  const { rows } = await db.query<Post>(
    `UPDATE posts SET content = $1, is_edited = true
     WHERE id = $2 AND author_id = $3
     RETURNING *`,
    [content, id, authorId]
  )
  return rows[0] ?? null
}

export async function remove(id: string, authorId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM posts WHERE id = $1 AND author_id = $2`,
    [id, authorId]
  )
  return (rowCount ?? 0) > 0
}

// Mod-level: update without author restriction
export async function updateContent(id: string, content: string): Promise<Post | null> {
  const { rows } = await db.query<Post>(
    `UPDATE posts SET content = $1, is_edited = true, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [content, id]
  )
  return rows[0] ?? null
}

// Mod-level: delete without author restriction
// Apagar um post do meio de uma cena religa quem o continuava ao post que ELE
// continuava: o fio pula o buraco em vez de partir em dois (o ON DELETE SET
// NULL de trik_004 deixaria as continuações órfãs). Transação: religar sem
// apagar, ou o contrário, deixaria a cena num estado que ninguém pediu.
export async function removeById(id: string): Promise<boolean> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE posts SET reply_to_id = (SELECT reply_to_id FROM posts WHERE id = $1)
       WHERE reply_to_id = $1`,
      [id]
    )
    const { rowCount } = await client.query(`DELETE FROM posts WHERE id = $1`, [id])
    await client.query('COMMIT')
    return (rowCount ?? 0) > 0
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Get minimal post info (for auth checks)
// `content` vem junto porque a edição precisa do texto ANTES da alteração para
// saber quem já estava mencionado (senão cada salvamento re-notificaria todos os
// citados). Mesma linha, mesma consulta — nenhuma ida extra ao banco.
export async function getAuthorAndThread(id: string): Promise<{ author_id: string; thread_id: string; content: string } | null> {
  const { rows } = await db.query<{ author_id: string; thread_id: string; content: string }>(
    `SELECT author_id, thread_id, content FROM posts WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}
