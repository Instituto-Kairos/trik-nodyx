import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { rehostExternalImages } from '../services/inlineImageRehost'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { getInstanceCommunityId } from '../middleware/adminOnly'
import * as CommunityModel from '../models/community'
import * as ThreadModel from '../models/thread'
import * as PostModel from '../models/post'
import * as ReactionModel from '../models/reaction'
import * as ThanksModel from '../models/thanks'
import * as TagModel from '../models/tag'
import * as NotificationModel from '../models/notification'
import { awardPoints, REPUTATION } from '../models/reputation'
import { sanitize, stripScramble } from '../utils/sanitize'
import { getNarratorUserId } from '../models/trikNarrador'
import { resolveMentions } from '../utils/mentions'
import { notifyMentions } from '../services/mentionNotify'
import { recordGhost } from '../services/mentionGhosts'
import { db, redis } from '../config/database'
import { checkHtmlContent } from '../services/contentFilter'
import { io } from '../socket/io'
import { can, getAccess, communityOfThread, outranks, rankOf } from '../services/permissions'
import { isUserMuted } from '../services/octoguard'
import { moderateText, textForModeration, blockedBody, heldBody } from '../services/octoguard/moderate'
import { holdContent, holdRefusal } from '../services/octoguard/held'
import { fileAutoReport } from '../services/octoguard/autoReport'
import { announceThread } from '../services/webhooks/announce'
import * as TrikModel from '../models/trik'
import { processScenePost, revertScenePost, revertThreadScenes } from '../services/trik/xp'

// Un titre de fil est du texte brut, jamais du HTML : checkHtmlContent() ne fait
// que SCANNER (mots interdits) sans jamais retirer de balises. Sans ce nettoyage,
// un titre contenant </script><script>... ressortait tel quel dans le JSON-LD de
// la page du fil et dans l'extrait ts_headline() de la recherche, deux points
// d'injection non authentifiés (trouvé en audit le 17/09).
function stripTitleTags(title: string): string {
  return title.replace(/<[^>]*>/g, '').trim()
}

// Menções em texto de fórum (trik): o aviso em si é o notifyMentions do
// upstream (pessoas, grupos, preferências). O fork acrescenta duas coisas:
//   · edição de post avisa só quem entrou AGORA no texto (skip = citados antes);
//   · o aviso de categoria do RPG não duplica quem já recebeu menção.

// Quem um texto de fórum menciona, resolvido na comunidade DO TÓPICO.
//
// Escopado a partir do tópico, e não da categoria, porque a edição de post só
// tem o thread_id em mãos — um único caminho serve aos três chamadores.
// O escopo por comunidade não é cosmético: resolveMentions() o exige para que
// um usuário excluído/banido não seja notificável por menção.
async function mencionadosEm(html: string, threadId: string): Promise<string[]> {
  const { rows } = await db.query<{ community_id: string }>(
    `SELECT cat.community_id
     FROM threads t
     JOIN categories cat ON cat.id = t.category_id
     WHERE t.id = $1`,
    [threadId]
  )
  if (!rows[0]) return []
  return resolveMentions(html, rows[0].community_id)
}

// Módulo RPG (trik): categoria marcada em /admin/trik/notificacoes avisa todos
// os membros a cada post. O INSERT em massa fica no model; aqui só se emite o
// novo contador, com UM COUNT agrupado em vez de um por destinatário.
async function notificarCategoria(opts: {
  threadId: string
  postId:   string
  actorId:  string
  exclude:  string[]
}): Promise<void> {
  const novos = await TrikModel.notifyCategoryPost(opts)
  if (!io || novos.length === 0) return
  const { rows } = await db.query<{ user_id: string; count: number }>(
    `SELECT user_id, COUNT(*)::int AS count
     FROM notifications
     WHERE user_id = ANY($1::uuid[]) AND is_read = false
     GROUP BY user_id`,
    [novos]
  )
  for (const r of rows) {
    io.to(`user:${r.user_id}`).emit('notification:new', { unreadCount: r.count })
  }
}

// Texto ofuscado só sobrevive em post cujo AUTOR é o Narrador.
async function scrambleGate(html: string, authorId: string): Promise<string> {
  if (!html.includes('scramble')) return html
  return (await getNarratorUserId()) === authorId ? html : stripScramble(html)
}

// Droit de modérer le contenu d'un fil (permission moderate_content dans la
// communauté du fil, socle du rôle + grade), avec le garde-fou de rang : un
// membre de l'équipe ne modère pas le contenu de quelqu'un de rang égal ou
// supérieur, sauf s'il est admin ou propriétaire.
async function canModerateThreadContent(userId: string, threadId: string, authorId: string | null): Promise<boolean> {
  const communityId = await communityOfThread(threadId)
  if (!communityId) return false
  const actor = await getAccess(communityId, userId)
  if (!actor.permissions.includes('moderate_content')) return false
  if (actor.rank >= rankOf('admin') || !authorId) return true
  const author = await getAccess(communityId, authorId)
  return outranks(actor, author.role)
}

// `is_featured` pilote la vitrine PUBLIQUE de l'instance (GET
// /instance/threads/featured, sans filtre de communauté) et l'annonce à
// l'annuaire fédéré : une portée strictement plus large que "admin de la
// communauté de ce fil". Sur une architecture "one instance = one community"
// les deux devraient toujours coïncider, mais POST /communities permettait
// jusqu'ici à n'importe qui de se créer sa propre communauté et d'y être
// owner : isAdmin() ci-dessus l'aurait alors laissé passer (trouvé en audit
// le 16/09). Vérification indépendante, scopée à LA communauté de l'instance.
async function isInstanceAdmin(userId: string): Promise<boolean> {
  const communityId = await getInstanceCommunityId()
  if (!communityId) return false
  const { rows } = await db.query<{ role: string }>(
    `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2`,
    [communityId, userId]
  )
  const role = rows[0]?.role
  return role === 'owner' || role === 'admin'
}

// Sourdine globale active ? Renvoie le corps de la réponse 403, sinon null.
async function globalMute(userId: string): Promise<{ error: string; code: string; expires_at: string | null } | null> {
  const state = await isUserMuted(userId)
  if (!state.muted || state.channel_id) return null
  return { error: 'You are muted', code: 'MUTED', expires_at: state.expires_at ?? null }
}

// Ordre des rôles communautaires. Un rôle inconnu (non membre) vaut -1, donc
// strictement inférieur à 'member' : il ne passe aucune catégorie restreinte.
const ROLE_RANK: Record<string, number> = { member: 0, moderator: 1, admin: 2, owner: 3 }
function roleRank(role: string | undefined | null): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role] : -1
}

// Get author_id of a post (used for thanks)
async function getPostAuthor(postId: string): Promise<{ author_id: string; thread_id: string } | null> {
  return PostModel.getAuthorAndThread(postId)
}

// Invalide les caches de listes de threads (showcase homepage, etc.) en
// incrémentant la version incluse dans leurs clés. Fire-and-forget : un
// échec Redis ne doit jamais bloquer la mutation (le TTL 30s rattrape).
// Consommé par instance.ts (threads/showcase).
function bumpThreadsCache(): void {
  redis.incr('threads:cache:ver').catch(() => {})
}

const CreateCategoryBody = z.object({
  community_id: z.string().uuid(),
  name:         z.string().min(1).max(100),
  description:  z.string().max(500).optional(),
  position:     z.number().int().min(0).optional(),
  parent_id:    z.string().uuid().optional(),
})

const ThreadsQuery = z.object({
  category_id: z.string().min(1), // accepts UUID or slug — resolved server-side
  limit:       z.coerce.number().int().min(1).max(100).optional(),
  offset:      z.coerce.number().int().min(0).optional(),
  // Filtrer par tag (son slug) : seuls les sujets qui le portent
  tag:         z.string().max(60).regex(/^[a-z0-9-]+$/).optional(),
})

const CreateThreadBody = z.object({
  category_id: z.string().min(1), // accepts UUID or slug — resolved server-side
  title:       z.string().min(3).max(300),
  content:     z.string().min(1).max(500_000), // ~500 KB max
  tag_ids:     z.array(z.string().uuid()).max(5).optional(),
})

const CreatePostBody = z.object({
  thread_id:   z.string().min(1), // accepts UUID or slug — resolved server-side
  content:     z.string().min(1).max(500_000),
  // Módulo RPG (trik): post que esta resposta continua na cena (trik_004).
  reply_to_id: z.string().uuid().optional(),
})

const ReactionBody = z.object({
  emoji: z.string().min(1).max(10),
})

export default async function forumRoutes(app: FastifyInstance) {
  // GET /api/v1/forums/:community
  app.get('/:community', {
    preHandler: [rateLimit],
  }, async (request, reply) => {
    const { community } = request.params as { community: string }

    const found = await CommunityModel.findBySlug(community)
    if (!found) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const categories = await CommunityModel.getCategories(found.id)
    return reply.send({ categories })
  })

  // POST /api/v1/forums/categories
  app.post('/categories', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreateCategoryBody })],
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof CreateCategoryBody>

    const community = await CommunityModel.findById(data.community_id)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    if (!(await can(community.id, request.user!.userId, 'manage_categories'))) {
      return reply.code(403).send({ error: 'Missing permission: manage_categories', code: 'FORBIDDEN' })
    }

    const category = await CommunityModel.createCategory(data)
    return reply.code(201).send({ category })
  })

// GET /api/v1/forums/threads
app.get('/threads', {
  preHandler: [rateLimit, validate({ query: ThreadsQuery })],
}, async (request, reply) => {
  const { category_id: rawCatId, limit, offset, tag } = request.query as z.infer<typeof ThreadsQuery>

  // Resolve slug → UUID if needed
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCatId)
  let category_id = rawCatId
  if (!isUuid) {
    const { rows: catRows } = await db.query(
      `SELECT id FROM categories WHERE slug = $1 LIMIT 1`, [rawCatId]
    )
    if (!catRows[0]) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })
    category_id = catRows[0].id
  }

  const { rows } = await db.query(`
    SELECT
      t.*,
      c.name as category_name,
      c.slug as category_slug,
      c.description as category_description,
      u.username as author_username,
      u.avatar as author_avatar,
      (SELECT COUNT(*)::int FROM posts p WHERE p.thread_id = t.id) as post_count
    FROM threads t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN users u ON t.author_id = u.id
    WHERE t.category_id = $1
      AND ($4::text IS NULL OR EXISTS (
        SELECT 1 FROM thread_tags tt JOIN tags g ON g.id = tt.tag_id
         WHERE tt.thread_id = t.id AND g.slug = $4))
    ORDER BY
      t.is_pinned DESC,
      COALESCE(
        (SELECT MAX(p.created_at) FROM posts p WHERE p.thread_id = t.id),
        t.created_at
      ) DESC
    LIMIT $2 OFFSET $3
  `, [category_id, limit || 50, offset || 0, tag ?? null])

  // Les tags portés par les sujets de CETTE catégorie, avec leur nombre :
  // la barre « Filtrer par tag » ne propose que ce qui donne un résultat.
  const { rows: categoryTags } = await db.query(`
    SELECT g.id, g.name, g.slug, g.color, COUNT(*)::int AS thread_count
      FROM thread_tags tt
      JOIN tags g ON g.id = tt.tag_id
      JOIN threads t ON t.id = tt.thread_id
     WHERE t.category_id = $1
     GROUP BY g.id, g.name, g.slug, g.color
     ORDER BY thread_count DESC, g.name ASC
  `, [category_id])

  const threadIds = rows.map(t => t.id)
  const tagsMap = await TagModel.getTagsForThreads(threadIds)
  const enriched = rows.map(t => ({
    ...t,
    tags: tagsMap.get(t.id) ?? []
  }))

  const catSlug = rows[0]?.category_slug ?? null
  const categoryInfo = {
    id:          category_id,
    name:        rows[0]?.category_name || 'Discussions',
    slug:        catSlug,
    description: rows[0]?.category_description || null
  }

  return reply.send({
    threads: enriched,
    category: categoryInfo,
    tags: categoryTags,
  })
})

  // POST /api/v1/forums/threads
  app.post('/threads', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreateThreadBody })],
  }, async (request, reply) => {
    const { category_id: rawCatId, title: rawTitle, content, tag_ids } = request.body as z.infer<typeof CreateThreadBody>
    const title = stripTitleTags(rawTitle)
    if (!title) {
      return reply.code(400).send({ error: 'Title cannot be empty once markup is removed', code: 'INVALID_TITLE' })
    }

    // Resolve slug → UUID if needed
    const isCatUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCatId)
    let category_id = rawCatId
    if (!isCatUuid) {
      const { rows: slugRows } = await db.query(
        `SELECT id FROM categories WHERE slug = $1 LIMIT 1`, [rawCatId]
      )
      if (!slugRows[0]) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })
      category_id = slugRows[0].id
    }

    // Check if user is banned from this community
    const { rows: catRows } = await db.query<{ community_id: string; post_min_role: string }>(
      `SELECT community_id, post_min_role FROM categories WHERE id = $1 LIMIT 1`, [category_id]
    )
    if (catRows[0]) {
      const { rows: banRows } = await db.query(
        `SELECT 1 FROM community_bans WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
        [catRows[0].community_id, request.user!.userId]
      )
      if (banRows.length > 0) {
        return reply.code(403).send({ error: 'You are banned from this community', code: 'BANNED' })
      }

      // Sourdine globale (posée par l'équipe, sans salon précis) : vaut aussi
      // pour le forum. Une sourdine limitée à un salon du chat ne bloque pas ici.
      const muteThread = await globalMute(request.user!.userId)
      if (muteThread) return reply.code(403).send(muteThread)

      // Catégorie restreinte : vérifier que le rôle de l'auteur est suffisant.
      // 'member' (défaut) laisse tout le monde poster — aucun coût si la
      // catégorie n'est pas restreinte.
      if (catRows[0].post_min_role !== 'member') {
        const { rows: roleRows } = await db.query<{ role: string }>(
          `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
          [catRows[0].community_id, request.user!.userId]
        )
        if (roleRank(roleRows[0]?.role) < roleRank(catRows[0].post_min_role)) {
          return reply.code(403).send({
            error: 'Cette catégorie est réservée à l’équipe.',
            code:  'CATEGORY_RESTRICTED',
          })
        }
      }
    }

    // OctoGuard (forum) : examiné AVANT de créer quoi que ce soit
    const ogThread = await moderateText(request.user!.userId, 'forum', [title, textForModeration(content)], { mentionTexts: [title, content] })
    if (ogThread.blocked) return reply.code(422).send(blockedBody(ogThread))

    // Cran « retenir » : le fil n'est PAS créé. Le contenu, nettoyé comme pour
    // une publication, attend la relecture de l'équipe (CDC E4h, lot 2).
    if (ogThread.hold) {
      const rehostHeld = await rehostExternalImages(content)
      const heldContent = sanitize(rehostHeld.html)
      const heldCheck = checkHtmlContent(heldContent)
      if (!heldCheck.ok) return reply.code(422).send({ error: heldCheck.reason, code: 'CONTENT_BLOCKED' })
      const titleHeldCheck = checkHtmlContent(title)
      if (!titleHeldCheck.ok) return reply.code(422).send({ error: titleHeldCheck.reason, code: 'CONTENT_BLOCKED' })
      const held = await holdContent({
        kind: 'thread', authorId: request.user!.userId, categoryId: category_id,
        payload: { content: heldContent, title, tag_ids: tag_ids ?? [] }, rule: ogThread.hold,
      })
      return held.ok ? reply.code(202).send(heldBody(held.row)) : reply.code(422).send(holdRefusal(held.code))
    }

    const thread = await ThreadModel.create({
      category_id,
      author_id: request.user!.userId,
      title,
    })

    // Rehost les <img> externes (Imgur, CDN tiers...) AVANT sanitize, sinon
    // le sanitizer les strip silencieusement et l'auteur perd ses images.
    const rehost = await rehostExternalImages(content)

    // Create the opening post (sanitize HTML from WYSIWYG editor)
    const sanitizedContent = await scrambleGate(sanitize(rehost.html), request.user!.userId)
    const threadContentCheck = checkHtmlContent(sanitizedContent)
    if (!threadContentCheck.ok) {
      return reply.code(422).send({ error: threadContentCheck.reason, code: 'CONTENT_BLOCKED' })
    }
    // Also check the title (plain text)
    const titleCheck = checkHtmlContent(title)
    if (!titleCheck.ok) {
      return reply.code(422).send({ error: titleCheck.reason, code: 'CONTENT_BLOCKED' })
    }

    const post = await PostModel.create({
      thread_id: thread.id,
      author_id: request.user!.userId,
      content: sanitizedContent,
    })
    bumpThreadsCache()
    // Réputation : créer un thread/article = +10 (le premier post ne donne pas le +2 réponse)
    await awardPoints(request.user!.userId, REPUTATION.THREAD)
    // Module RPG (trik, Fase 2) : primeiro post de um tópico pode gerar XP
    // se o tópico estiver marcado como elegível — nunca derruba a resposta.
    processScenePost({
      threadId: thread.id, postId: post.id,
      authorUserId: request.user!.userId, content: sanitizedContent,
    }).catch(err => request.log.warn({ err }, '[trik:xp] processScenePost failed'))

    // Menções na ABERTURA do tópico. Fire-and-forget, igual à resposta: uma
    // falha de notificação não derruba a criação do tópico.
    ;(async () => {
      try {
        const mencionados: string[] = []
        if (catRows[0]) {
          await notifyMentions({
            html: sanitizedContent, communityId: catRows[0].community_id, actorId: request.user!.userId, actorName: '',
            where: { kind: 'forum', threadId: thread.id, postId: post.id },
            notified: mencionados,
          })
        }
        await notificarCategoria({
          threadId: thread.id,
          postId:   post.id,
          actorId:  request.user!.userId,
          exclude:  mencionados,
        })
      } catch {
        // Never block the response for notification failures
      }
    })()

    // Attach tags if provided
    if (tag_ids && tag_ids.length > 0) {
      await TagModel.setThreadTags(thread.id, tag_ids)
    }

    if (ogThread.report) void fileAutoReport({ targetType: 'thread', targetId: thread.id, ruleName: ogThread.report.rule_name, excerpt: ogThread.report.excerpt })

    const tags = await TagModel.getTagsForThread(thread.id)
    // Webhooks : l'article est publié (pas retenu) ; il s'annonce aux destinations qui l'ont demandé
    announceThread(thread.id)
    return reply.code(201).send({
      thread: { ...thread, tags },
      post,
      meta:   { images_rehosted: rehost.rehosted, images_failed: rehost.failed.length },
    })
  })

  // GET /api/v1/forums/threads/:id
  app.get('/threads/:id', {
    preHandler: [rateLimit, optionalAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query  = request.query as { limit?: string; offset?: string }
    const viewerId = request.user?.userId

    const thread = await ThreadModel.findById(id)
    if (!thread) {
      return reply.code(404).send({ error: 'Thread not found', code: 'NOT_FOUND' })
    }

    // Always use the resolved UUID — id may be a slug
    const threadId = thread.id

    const [posts, tags, xpEnabled] = await Promise.all([
      PostModel.listByThread(threadId, {
        // Pas de plafond de messages par sujet : seule la TAILLE DE PAGE est bornée
        // (100 max) et les valeurs invalides retombent sur les défauts du model.
        limit:    Number.isInteger(Number(query.limit))  && Number(query.limit)  > 0 ? Math.min(Number(query.limit), 100) : undefined,
        offset:   Number.isInteger(Number(query.offset)) && Number(query.offset) > 0 ? Number(query.offset) : undefined,
        viewerId,
      }),
      TagModel.getTagsForThread(threadId),
      // Módulo RPG (trik): o selo "XP ativo" é público — vai junto com o tópico em
      // vez de o frontend chamar uma rota admin (que devolvia 403 pra todo jogador).
      Promise.resolve().then(() => TrikModel.isXpThread(threadId)).catch(() => false),
      ThreadModel.incrementViews(threadId),
    ])

    return reply.send({ thread: { ...thread, tags }, posts, xp_enabled: xpEnabled })
  })

  // POST /api/v1/forums/posts
  app.post('/posts', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreatePostBody })],
  }, async (request, reply) => {
    const { thread_id, content, reply_to_id } = request.body as z.infer<typeof CreatePostBody>
    const userId = request.user!.userId

    const thread = await ThreadModel.findById(thread_id)
    if (!thread) {
      return reply.code(404).send({ error: 'Thread not found', code: 'NOT_FOUND' })
    }
    if (thread.is_locked) {
      return reply.code(403).send({ error: 'Thread is locked', code: 'THREAD_LOCKED' })
    }

    // Always use resolved UUID — thread_id may be a slug
    const resolvedThreadId = thread.id

    // Check if user is banned from this community
    const { rows: banRows } = await db.query(
      `SELECT 1 FROM community_bans cb
       JOIN categories cat ON cat.community_id = cb.community_id
       JOIN threads t ON t.category_id = cat.id
       WHERE cb.user_id = $1 AND t.id = $2 LIMIT 1`,
      [userId, resolvedThreadId]
    )
    if (banRows.length > 0) {
      return reply.code(403).send({ error: 'You are banned from this community', code: 'BANNED' })
    }

    // Fio de cena (trik): o post continuado tem de existir e ser DESTE tópico —
    // senão o breadcrumb levaria para outro tópico (ou para lugar nenhum).
    const replyTarget = reply_to_id ? await PostModel.getReplyTarget(reply_to_id) : null
    if (reply_to_id && replyTarget?.thread_id !== resolvedThreadId) {
      return reply.code(422).send({ error: 'Reply target not found in this thread', code: 'REPLY_TARGET_INVALID' })
    }
    const mutePost = await globalMute(userId)
    if (mutePost) return reply.code(403).send(mutePost)

    // Rehost les <img> externes avant sanitize (cf POST /threads).
    const rehostReply = await rehostExternalImages(content)
    const sanitized = await scrambleGate(sanitize(rehostReply.html), userId)
    const replyContentCheck = checkHtmlContent(sanitized)
    if (!replyContentCheck.ok) {
      return reply.code(422).send({ error: replyContentCheck.reason, code: 'CONTENT_BLOCKED' })
    }

    const ogPost = await moderateText(userId, 'forum', [textForModeration(sanitized)], { mentionTexts: [sanitized] })
    if (ogPost.blocked) return reply.code(422).send(blockedBody(ogPost))
    if (ogPost.hold) {
      const held = await holdContent({ kind: 'post', authorId: userId, threadId: resolvedThreadId, payload: { content: sanitized }, rule: ogPost.hold })
      return held.ok ? reply.code(202).send(heldBody(held.row)) : reply.code(422).send(holdRefusal(held.code))
    }

    const post = await PostModel.create({
      thread_id:   resolvedThreadId,
      author_id:   userId,
      content:     sanitized,
      reply_to_id: replyTarget?.id ?? null,
    })
    if (ogPost.report) void fileAutoReport({ targetType: 'post', targetId: post.id, ruleName: ogPost.report.rule_name, excerpt: ogPost.report.excerpt })
    bumpThreadsCache()
    // Réputation : répondre = +2
    await awardPoints(userId, REPUTATION.REPLY)
    // Module RPG (trik, Fase 2) : resposta a um tópico elegível pode gerar
    // XP — nunca derruba a resposta.
    processScenePost({
      threadId: resolvedThreadId, postId: post.id,
      authorUserId: userId, content: sanitized,
    }).catch(err => request.log.warn({ err }, '[trik:xp] processScenePost failed'))

    // Notifications (fire-and-forget)
    ;(async () => {
      try {
        // Fio de cena (trik): quem teve a mensagem continuada é avisado com
        // post_reply (tópico comum) ou scene_reply (tópico de RPG) — mais
        // específico que thread_reply, então se for também o autor do tópico
        // recebe só este, não os dois.
        const continuado = replyTarget && replyTarget.author_id !== userId ? replyTarget.author_id : null
        const avisar: Array<{ user: string; type: string }> = []
        if (continuado) {
          const cena = await Promise.resolve().then(() => TrikModel.isXpThread(thread.id)).catch(() => false)
          avisar.push({ user: continuado, type: cena ? 'scene_reply' : 'post_reply' })
        }
        // Notify thread author of a reply (if different user)
        if (thread.author_id !== userId && thread.author_id !== continuado) {
          avisar.push({ user: thread.author_id, type: 'thread_reply' })
        }
        for (const a of avisar) {
          await NotificationModel.create({
            user_id:   a.user,
            type:      a.type,
            actor_id:  userId,
            thread_id: thread.id,
            post_id:   post.id,
          })
          if (io) {
            const count = await NotificationModel.getUnreadCount(a.user)
            io.to(`user:${a.user}`).emit('notification:new', { unreadCount: count })
          }
        }
        // Menções (pessoas e grupos), pelo serviço do upstream. Quem já foi
        // avisado acima (thread_reply/post_reply) não recebe menção duplicada.
        const mencionados: string[] = []
        const { rows: catRows2 } = await db.query<{ community_id: string }>(
          `SELECT community_id FROM categories WHERE id = $1`, [thread.category_id]
        )
        if (catRows2[0]) {
          await notifyMentions({
            html: sanitized, communityId: catRows2[0].community_id, actorId: userId, actorName: '',
            where: { kind: 'forum', threadId: thread.id, postId: post.id },
            skip: avisar.map(a => a.user),
            notified: mencionados,
          })
        }
        // Categoria marcada no módulo RPG: todos os membros. O autor do tópico
        // já recebeu thread_reply, o continuado post_reply e os citados,
        // mention — não duplica.
        await notificarCategoria({
          threadId: thread.id,
          postId:   post.id,
          actorId:  userId,
          exclude:  [thread.author_id, ...avisar.map(a => a.user), ...mencionados],
        })
      } catch {
        // Never block the response for notification failures
      }
    })()

    return reply.code(201).send({
      post,
      meta: { images_rehosted: rehostReply.rehosted, images_failed: rehostReply.failed.length },
    })
  })

  // PUT /api/v1/forums/posts/:id — edit a post (author or mod)
  app.put('/posts/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { content } = request.body as { content?: string }
    if (!content?.trim()) {
      return reply.code(400).send({ error: 'Content required', code: 'BAD_REQUEST' })
    }

    const existing = await PostModel.getAuthorAndThread(id)
    if (!existing) {
      return reply.code(404).send({ error: 'Post not found', code: 'NOT_FOUND' })
    }

    const userId = request.user!.userId
    const isAuthor = existing.author_id === userId
    const modAccess = !isAuthor && await canModerateThreadContent(userId, existing.thread_id, existing.author_id)

    if (!isAuthor && !modAccess) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    // Rehost les <img> externes avant sanitize (cf POST /threads).
    const rehostEdit = await rehostExternalImages(content)
    // Autor do POST, não quem edita: moderador editando cena do Narrador mantém o efeito.
    const editSanitized = await scrambleGate(sanitize(rehostEdit.html), existing.author_id)
    const editCheck = checkHtmlContent(editSanitized)
    if (!editCheck.ok) {
      return reply.code(422).send({ error: editCheck.reason, code: 'CONTENT_BLOCKED' })
    }

    // La modification passe par OctoGuard comme la publication (sinon : publier
    // propre, puis modifier pour contourner)
    const ogEdit = await moderateText(userId, 'forum', [textForModeration(editSanitized)], { mentionTexts: [editSanitized] })
    if (ogEdit.blocked) return reply.code(422).send(blockedBody(ogEdit))
    // Modification retenue : l'ancien texte reste en ligne jusqu'à la décision
    if (ogEdit.hold) {
      const held = await holdContent({ kind: 'post_edit', authorId: userId, threadId: existing.thread_id, postId: id, payload: { content: editSanitized }, rule: ogEdit.hold })
      return held.ok ? reply.code(202).send(heldBody(held.row)) : reply.code(422).send(holdRefusal(held.code))
    }

    const post = await PostModel.updateContent(id, editSanitized, userId)
    if (ogEdit.report) void fileAutoReport({ targetType: 'post', targetId: id, ruleName: ogEdit.report.rule_name, excerpt: ogEdit.report.excerpt })
    bumpThreadsCache()
    // Módulo RPG (trik, Fase 2) : desfaz o xp bruto do post antigo e
    // reprocessa contra o conteúdo editado — nunca desfaz level já aplicado.
    // Em SEQUÊNCIA (revert termina antes do reprocesso começar): rodando os dois
    // ao mesmo tempo eles disputavam a linha de trik_scene_awards e a reação do
    // bot. Continua fora do caminho da resposta (não faz o autor esperar).
    revertScenePost(id)
      .then(() => processScenePost({
        threadId: existing.thread_id, postId: id,
        authorUserId: existing.author_id, content: editSanitized,
      }))
      .catch(err => request.log.warn({ err }, '[trik:xp] revert/reprocess failed'))

    // Menções ACRESCENTADAS nesta edição. `jaNotificados` é lido do conteúdo
    // ANTERIOR: quem já estava citado não recebe de novo a cada salvamento.
    // O ator é quem EDITA (pode ser um moderador), não o autor do post.
    ;(async () => {
      try {
        const communityId = await communityOfThread(existing.thread_id)
        if (!communityId) return
        await notifyMentions({
          html: editSanitized, communityId, actorId: userId, actorName: '',
          where: { kind: 'forum', threadId: existing.thread_id, postId: id },
          skip: await mencionadosEm(existing.content, existing.thread_id),
        })
      } catch {
        // Never block the response for notification failures
      }
    })()

    return reply.send({
      post,
      meta: { images_rehosted: rehostEdit.rehosted, images_failed: rehostEdit.failed.length },
    })
  })

  // DELETE /api/v1/forums/posts/:id — delete a post (author or mod)
  app.delete('/posts/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const existing = await PostModel.getAuthorAndThread(id)
    if (!existing) {
      return reply.code(404).send({ error: 'Post not found', code: 'NOT_FOUND' })
    }

    const userId = request.user!.userId
    const isAuthor = existing.author_id === userId
    const modAccess = !isAuthor && await canModerateThreadContent(userId, existing.thread_id, existing.author_id)

    if (!isAuthor && !modAccess) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    // Fantôme (D53) : l'auteur efface lui-même, dans les 10 minutes, une réponse qui
    // mentionnait quelqu'un. AVANT l'effacement : ses notifications partiraient avec elle.
    if (isAuthor) {
      const { rows: g } = await db.query<{ content: string; created_at: string; community_id: string }>(
        `SELECT p.content, p.created_at, c.community_id FROM posts p
         JOIN threads t ON t.id = p.thread_id JOIN categories c ON c.id = t.category_id WHERE p.id = $1`, [id])
      if (g[0]) {
        await recordGhost({ source: 'forum', messageId: id, authorId: userId, communityId: g[0].community_id,
          html: g[0].content, createdAt: g[0].created_at, threadId: existing.thread_id }).catch(() => false)
      }
    }
    // Módulo RPG (trik, Fase 2) : desfaz o xp bruto que esse post tinha gerado —
    // ANTES de apagar: trik_scene_awards tem ON DELETE CASCADE em posts(id), então
    // com o post já removido o prêmio some junto e não há mais o que reverter
    // (postar → apagar → postar de novo rendia xp sem limite).
    await revertScenePost(id)
    await PostModel.removeById(id)
    // Réputation : suppression d'une réponse = -2 pour son auteur (anti-farming)
    await awardPoints(existing.author_id, -REPUTATION.REPLY)
    return reply.code(204).send()
  })

  // PATCH /api/v1/forums/threads/:id — author (title) + mod (pin/lock/delete/tags)
  app.patch('/threads/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      title?:          string
      is_pinned?:      boolean
      is_locked?:      boolean
      is_featured?:    boolean
      tag_ids?:        string[]
      delete?:         boolean
      is_xp_enabled?:  boolean  // Módulo RPG (trik, Fase 2) — marca o tópico pra contagem de XP por cena
    }

    const thread = await ThreadModel.findById(id)
    if (!thread) {
      return reply.code(404).send({ error: 'Thread not found', code: 'NOT_FOUND' })
    }

    // Always use resolved UUID — id may be a slug
    const threadId = thread.id

    const userId    = request.user!.userId
    const isAuthor  = thread.author_id === userId
    const modAccess = await canModerateThreadContent(userId, threadId, isAuthor ? null : thread.author_id)

    if (!isAuthor && !modAccess) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    // Authors without mod rights can only edit the title
    if (isAuthor && !modAccess) {
      const cleanTitle = body.title ? stripTitleTags(body.title) : ''
      if (!cleanTitle) {
        return reply.code(403).send({ error: 'Authors can only edit the title', code: 'FORBIDDEN' })
      }
      const updated = await ThreadModel.update(threadId, { title: cleanTitle })
      bumpThreadsCache()
      return reply.send({ thread: updated })
    }

    // Les tags d'un sujet, changés par l'équipe : vérifiés AVANT toute écriture.
    // Un tag inconnu est refusé avec un code clair au lieu d'être ignoré en
    // silence (setThreadTags, atomique, ne poserait que les tags existants).
    let tagIds: string[] | undefined
    if (body.tag_ids !== undefined) {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!Array.isArray(body.tag_ids) || !body.tag_ids.every((t) => typeof t === 'string' && uuid.test(t))) {
        return reply.code(400).send({ error: 'tag_ids must be a list of tag ids', code: 'THREAD_TAGS_INVALID' })
      }
      tagIds = [...new Set(body.tag_ids.map((t) => t.toLowerCase()))]
      if (tagIds.length > 5) {
        return reply.code(400).send({ error: 'A thread has at most 5 tags', code: 'THREAD_TAGS_TOO_MANY' })
      }
      if (tagIds.length) {
        const { rows } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM tags WHERE id = ANY($1::uuid[])`, [tagIds])
        if ((rows[0]?.n ?? 0) !== tagIds.length) {
          return reply.code(400).send({ error: 'Unknown tag', code: 'THREAD_TAGS_UNKNOWN' })
        }
      }
    }

    // XP por cena (trik): mexe na economia do RPG, então continua restrito a
    // admin/owner DA COMUNIDADE DO FIO (pin/lock passaram a moderate_content).
    if (body.is_xp_enabled !== undefined) {
      const communityId = await communityOfThread(threadId)
      const access = communityId ? await getAccess(communityId, userId) : null
      if (!access || access.rank < rankOf('admin')) {
        return reply.code(403).send({ error: 'Only admins and owners can mark this thread for XP', code: 'FORBIDDEN' })
      }
    }

    // Pin / lock : relèvent de moderate_content (modAccess ci-dessus), comme
    // supprimer ou modifier. Avant le 02/11/2026 c'était réservé aux admins.

    // Feature : restreint à owner/admin DE L'INSTANCE, jamais "de n'importe
    // quelle communauté", cf isInstanceAdmin ci-dessus.
    if (body.is_featured !== undefined) {
      const instanceAdmin = await isInstanceAdmin(userId)
      if (!instanceAdmin) {
        return reply.code(403).send({ error: 'Only the instance admin can feature threads', code: 'FORBIDDEN' })
      }
    }

    // Módulo RPG (trik, Fase 2) : marca/desmarca o tópico pra contagem de
    // XP por cena — tabela própria (trik_threads), fora de ThreadModel.
    if (body.is_xp_enabled !== undefined) {
      await TrikModel.setXpThread(threadId, body.is_xp_enabled, userId)
    }

    // Mod/owner actions
    if (body.delete) {
      // Módulo RPG (trik): desfaz o xp de todas as cenas do tópico antes do CASCADE levá-las.
      await revertThreadScenes(threadId)
      await ThreadModel.remove(threadId)
      bumpThreadsCache()
      // Réputation : suppression d'un thread = -10 pour son créateur (anti-farming)
      await awardPoints(thread.author_id, -REPUTATION.THREAD)
      return reply.code(204).send()
    }

    if (tagIds !== undefined) {
      await TagModel.setThreadTags(threadId, tagIds)
    }

    const wasPinned = !!(thread as { is_pinned?: boolean }).is_pinned
    const updated = await ThreadModel.update(threadId, {
      title:       body.title ? (stripTitleTags(body.title) || undefined) : undefined,
      is_pinned:   body.is_pinned,
      is_locked:   body.is_locked,
      is_featured: body.is_featured,
    })
    bumpThreadsCache()
    // Webhooks : un article qui vient d'être mis en avant (pas à chaque enregistrement)
    if (body.is_pinned === true && !wasPinned) announceThread(threadId, 'forum_pinned')
    return reply.send({ thread: updated })
  })

  // POST /api/v1/forums/posts/:id/reactions
  app.post('/posts/:id/reactions', {
    preHandler: [rateLimit, requireAuth, validate({ body: ReactionBody })],
  }, async (request, reply) => {
    const { id }   = request.params as { id: string }
    const { emoji } = request.body as z.infer<typeof ReactionBody>
    const userId   = request.user!.userId

    const post = await PostModel.getAuthorAndThread(id)
    if (!post) {
      return reply.code(404).send({ error: 'Post not found', code: 'NOT_FOUND' })
    }

    const result = await ReactionModel.toggleReaction(id, userId, emoji)

    // Layer 2 — floating reactions : si la réaction vient d'être AJOUTÉE
    // (pas retirée), on diffuse un event socket pour que les utilisateurs
    // connectés voient l'emoji monter en temps réel sur leur écran. On
    // récupère le username pour étiqueter le float ; pas besoin de cacher.
    if (result.added && io) {
      try {
        const { rows: [u] } = await db.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1`,
          [userId],
        )
        if (u?.username) {
          // x ∈ [0.2, 0.8] : on évite les bords pour ne pas couper les emoji
          const x = 0.2 + Math.random() * 0.6
          io.emit('forum:float_reaction', { emoji, username: u.username, x })
        }
      } catch { /* best-effort, ne bloque pas la réaction */ }
    }

    return reply.send(result)
  })

  // POST /api/v1/forums/posts/:id/thanks
  app.post('/posts/:id/thanks', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = request.user!.userId

    const post = await PostModel.getAuthorAndThread(id)
    if (!post) {
      return reply.code(404).send({ error: 'Post not found', code: 'NOT_FOUND' })
    }

    if (post.author_id === userId) {
      return reply.code(400).send({ error: 'Cannot thank your own post', code: 'BAD_REQUEST' })
    }

    const result = await ThanksModel.toggleThanks(id, userId, post.author_id)

    // Notify if thanks was added (not removed)
    if (result.added) {
      NotificationModel.create({
        user_id:   post.author_id,
        type:      'post_thanks',
        actor_id:  userId,
        thread_id: post.thread_id,
        post_id:   id,
      }).then(async () => {
        if (io) {
          const count = await NotificationModel.getUnreadCount(post.author_id)
          io.to(`user:${post.author_id}`).emit('notification:new', { unreadCount: count })
        }
      }).catch(() => {})
    }

    // Emit points update to author in real time (add or remove)
    if (io) {
      io.to(`user:${post.author_id}`).emit('user:points_updated', { points: result.new_points })
    }

    return reply.send(result)
  })
}
