import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// Conteúdo privado por cargo (trik_025): a regra mora no banco (funções SQL,
// testadas à parte); aqui tudo é visível, como antes, salvo onde um teste muda.
vi.mock('../services/privateContent', async (orig) => ({
  ...(await orig<typeof import('../services/privateContent')>()),
  canViewThread:         vi.fn().mockResolvedValue(true),
  canViewCategory:       vi.fn().mockResolvedValue(true),
  usersWhoCanViewThread: vi.fn(async (_t: string, ids: string[]) => ids),
  getThreadGrades:       vi.fn().mockResolvedValue([]),
  setThreadGrades:       vi.fn().mockResolvedValue(undefined),
}))

// ── Mocks ─────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  redis: {
    exists: vi.fn().mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1)),
    setex:  vi.fn().mockResolvedValue('OK'),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../models/thread', () => ({
  list:            vi.fn(),
  findById:        vi.fn(),
  create:          vi.fn(),
  update:          vi.fn(),
  remove:          vi.fn(),
  incrementViews:  vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../models/post', () => ({
  list:              vi.fn(),
  listByThread:      vi.fn().mockResolvedValue([]),
  create:            vi.fn(),
  update:            vi.fn(),
  remove:            vi.fn(),
  removeById:        vi.fn(),
  updateContent:     vi.fn(),
  getAuthorAndThread: vi.fn(),
  getReplyTarget:    vi.fn().mockResolvedValue(null),
}))

vi.mock('../models/community', () => ({
  findBySlug:    vi.fn(),
  findById:      vi.fn(),
  getCategories: vi.fn().mockResolvedValue([]),
  getMember:     vi.fn(),
  createCategory: vi.fn(),
}))

vi.mock('../models/reaction',     () => ({ list: vi.fn(), toggle: vi.fn() }))
vi.mock('../models/thanks',       () => ({ hasGiven: vi.fn(), give: vi.fn() }))
vi.mock('../models/notification', () => ({
  create:         vi.fn(),
  getUnreadCount: vi.fn().mockResolvedValue(0),
}))
vi.mock('../utils/mentions',      () => ({ resolveMentions: vi.fn().mockResolvedValue([]) }))
vi.mock('../socket/io',           () => ({ io: null }))

vi.mock('../models/tag', () => ({
  listByCommunity:    vi.fn().mockResolvedValue([]),
  attach:             vi.fn(),
  detach:             vi.fn(),
  getTagsForThread:   vi.fn().mockResolvedValue([]),
  getTagsForThreads:  vi.fn().mockResolvedValue(new Map()),
  setThreadTags:      vi.fn().mockResolvedValue(undefined),
  tagsNotAllowedIn:   vi.fn().mockResolvedValue([]),
}))

// Módulo RPG (trik, Fase 2) — só o que routes/forums.ts usa diretamente de
// TrikModel (isXpThread/setXpThread, no toggle de PATCH /threads/:id).
// isXpThread resolve falsy por padrão: os testes de POST /threads e
// POST /posts já existentes não precisam saber do trik — o fire-and-forget
// processScenePost() cai no caminho "not_xp_thread" e não faz mais nada.
vi.mock('../models/trik', () => ({
  isXpThread:                 vi.fn().mockResolvedValue(false),
  setXpThread:                vi.fn().mockResolvedValue(undefined),
  // Ciclo de vida das cenas (revert ao editar/apagar): ver os describes no fim do arquivo.
  revertSceneAward:           vi.fn().mockResolvedValue(undefined),
  listAwardedPostIdsByThread: vi.fn().mockResolvedValue([]),
  applySceneAward:            vi.fn(),
  setSceneRejection:          vi.fn().mockResolvedValue(undefined),
  clearSceneRejection:        vi.fn().mockResolvedValue(undefined),
}))

// O bot real puxa bcrypt/db só pra reagir/postar — aqui só importa que não falhe.
vi.mock('../services/trik/bot', () => ({
  postTrikMessage:     vi.fn().mockResolvedValue(undefined),
  reactSceneRejected:  vi.fn().mockResolvedValue(undefined),
  reactSceneCounted:   vi.fn().mockResolvedValue(undefined),
  clearSceneMarks:     vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ───────────────────────────────────────────────────

import * as ThreadModel from '../models/thread'
import * as PostModel   from '../models/post'
import * as NotificationModel from '../models/notification'
import * as TrikModel   from '../models/trik'
import { redis, db }    from '../config/database'
import forumRoutes      from '../routes/forums'
import * as Private     from '../services/privateContent'

// ── Helpers ───────────────────────────────────────────────────

// Valid RFC 4122 UUIDs (Zod v4 requires proper version nibble)
const CATEGORY_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const THREAD_UUID   = '550e8400-e29b-41d4-a716-446655440000'
const USER_UUID     = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function makeToken(userId = USER_UUID, username = 'testuser') {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

const FAKE_THREAD = {
  id:          THREAD_UUID,
  category_id: CATEGORY_UUID,
  author_id:   USER_UUID,
  title:       'Test thread',
  is_pinned:   false,
  is_locked:   false,
  views:       0,
  created_at:  new Date(),
  updated_at:  new Date(),
}

const FAKE_POST = {
  id:         '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  thread_id:  THREAD_UUID,
  author_id:  USER_UUID,
  content:    '<p>Reply</p>',
  created_at: new Date(),
  updated_at: new Date(),
}

// ── Tests ─────────────────────────────────────────────────────

describe('GET /api/v1/forums/threads', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('returns 200 with empty thread list for a valid category_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/forums/threads?category_id=${CATEGORY_UUID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.threads)).toBe(true)
  })

  it('returns 400 when category_id is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/forums/threads',
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when category_id is an unknown slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/forums/threads?category_id=not-a-known-slug',
    })

    expect(res.statusCode).toBe(404)
  })

  // Filtrer par tag : fait par la base, sur tous les sujets de la catégorie
  const listCall = () => vi.mocked(db.query).mock.calls.find(([sql]) => String(sql).includes('FROM threads t') && String(sql).includes('LIMIT $2'))
  it('?tag=slug : seuls les sujets qui portent ce tag, filtre posé dans la requête', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/forums/threads?category_id=${CATEGORY_UUID}&tag=tutoriels-video` })
    expect(res.statusCode).toBe(200)
    const [sql, params] = listCall()!
    expect(String(sql).replace(/\s+/g, ' ')).toContain('AND ($4::text IS NULL OR EXISTS ( SELECT 1 FROM thread_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.thread_id = t.id AND g.slug = $4))')
    expect(params).toEqual([CATEGORY_UUID, 50, 0, 'tutoriels-video', null])
  })
  it('sans tag : aucun filtre (null)', async () => {
    await app.inject({ method: 'GET', url: `/api/v1/forums/threads?category_id=${CATEGORY_UUID}` })
    expect(listCall()![1]).toEqual([CATEGORY_UUID, 50, 0, null, null])
  })
  it('un tag malformé est refusé avant la base', async () => {
    for (const tag of ['Majuscules', "x' OR 1=1", 'a b', 'x'.repeat(61)]) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/forums/threads?category_id=${CATEGORY_UUID}&tag=${encodeURIComponent(tag)}` })
      expect(res.statusCode).toBe(400)
    }
    expect(listCall()).toBeUndefined()
  })
  it('la réponse donne les tags de la catégorie, avec leur nombre de sujets', async () => {
    const TAGS = [{ id: 't1', name: 'Tutoriel', slug: 'tutoriel', color: '#8b5cf6', thread_count: 3 }]
    vi.mocked(db.query).mockImplementation((async (sql: string) =>
      String(sql).includes('GROUP BY g.id') ? { rows: TAGS, rowCount: 1 } : { rows: [], rowCount: 0 }) as never)
    const res = await app.inject({ method: 'GET', url: `/api/v1/forums/threads?category_id=${CATEGORY_UUID}` })
    expect(res.json().tags).toEqual(TAGS)
    const tagSql = vi.mocked(db.query).mock.calls.find(([s]) => String(s).includes('GROUP BY g.id'))!
    expect(String(tagSql[0])).toContain('WHERE t.category_id = $1')
    expect(tagSql[1]).toEqual([CATEGORY_UUID, null])
  })
})

describe('POST /api/v1/forums/threads', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      payload: { category_id: CATEGORY_UUID, title: 'Hello world', content: '<p>Test</p>' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when token is invalid', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: 'Bearer bad.token' },
      payload: { category_id: CATEGORY_UUID, title: 'Hello world', content: '<p>Test</p>' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('creates a thread when authenticated with valid body', async () => {
    vi.mocked(ThreadModel.create).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Hello world', content: '<p>Test content</p>' },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toHaveProperty('thread')
  })

  it('strips HTML from the title before storing it (injection audit 17/09)', async () => {
    vi.mocked(ThreadModel.create).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        category_id: CATEGORY_UUID,
        title:       'Free stuff</script><script>alert(1)</script>',
        content:     '<p>Test content</p>',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(ThreadModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.not.stringMatching(/[<>]/) })
    )
  })

  it('rejects a title made entirely of markup', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: '<script></script>', content: '<p>Test</p>' },
    })

    expect(res.statusCode).toBe(400)
    expect(ThreadModel.create).not.toHaveBeenCalled()
  })

  it('returns 400 when title is missing', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, content: '<p>Test</p>' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/v1/forums/posts', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/posts',
      payload: { thread_id: THREAD_UUID, content: '<p>Reply</p>' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when thread does not exist', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(null as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/posts',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { thread_id: THREAD_UUID, content: '<p>Reply</p>' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 403 when thread is locked', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, is_locked: true } as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/posts',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { thread_id: THREAD_UUID, content: '<p>Reply</p>' },
    })

    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('THREAD_LOCKED')
  })

  it('creates a post in an open thread', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/posts',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { thread_id: THREAD_UUID, content: '<p>Reply</p>' },
    })

    expect(res.statusCode).toBe(201)
  })
})

// ── Fio de cena (trik_004) ─────────────────────────────────────
//
// Dois jogadores cenando no mesmo tópico sem estarem juntos: cada resposta
// aponta o post que continua. O alvo tem de ser DESTE tópico.

describe('POST /api/v1/forums/posts — reply_to_id (fio de cena)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  const OTHER_USER    = '9b2f5e3a-1c4d-4e8f-9a0b-1c2d3e4f5a6b'
  const PARENT_UUID   = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
  const OTHER_THREAD  = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  const send = (reply_to_id: string) => app.inject({
    method:  'POST',
    url:     '/api/v1/forums/posts',
    headers: { authorization: `Bearer ${makeToken()}` },
    payload: { thread_id: THREAD_UUID, content: '<p>Reply</p>', reply_to_id },
  })

  it('recusa com 422 um alvo de OUTRO tópico', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.getReplyTarget).mockResolvedValueOnce({ id: PARENT_UUID, thread_id: OTHER_THREAD, author_id: OTHER_USER })

    const res = await send(PARENT_UUID)

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).code).toBe('REPLY_TARGET_INVALID')
    expect(PostModel.create).not.toHaveBeenCalled()
  })

  it('recusa com 422 um alvo que não existe', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.getReplyTarget).mockResolvedValueOnce(null)

    const res = await send(PARENT_UUID)

    expect(res.statusCode).toBe(422)
    expect(PostModel.create).not.toHaveBeenCalled()
  })

  it('grava o vínculo e avisa o autor continuado com post_reply', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.getReplyTarget).mockResolvedValueOnce({ id: PARENT_UUID, thread_id: THREAD_UUID, author_id: OTHER_USER })
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await send(PARENT_UUID)

    expect(res.statusCode).toBe(201)
    expect(PostModel.create).toHaveBeenCalledWith(expect.objectContaining({ reply_to_id: PARENT_UUID }))
    await vi.waitFor(() => expect(NotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: OTHER_USER, type: 'post_reply', post_id: FAKE_POST.id }),
    ))
  })

  it('em tópico de RPG (XP ativo) o aviso é scene_reply', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.getReplyTarget).mockResolvedValueOnce({ id: PARENT_UUID, thread_id: THREAD_UUID, author_id: OTHER_USER })
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)
    vi.mocked(TrikModel.isXpThread).mockResolvedValue(true)

    try {
      await send(PARENT_UUID)
      await vi.waitFor(() => expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: OTHER_USER, type: 'scene_reply' }),
      ))
    } finally {
      vi.mocked(TrikModel.isXpThread).mockResolvedValue(false)
    }
  })

  it('autor do tópico que é também o continuado recebe só post_reply', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, author_id: OTHER_USER } as any)
    vi.mocked(PostModel.getReplyTarget).mockResolvedValueOnce({ id: PARENT_UUID, thread_id: THREAD_UUID, author_id: OTHER_USER })
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    await send(PARENT_UUID)

    await vi.waitFor(() => expect(NotificationModel.create).toHaveBeenCalled())
    const tipos = vi.mocked(NotificationModel.create).mock.calls
      .filter(([n]) => n.user_id === OTHER_USER)
      .map(([n]) => n.type)
    expect(tipos).toEqual(['post_reply'])
  })

  it('continuar o próprio post não gera notificação para si mesmo', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.getReplyTarget).mockResolvedValueOnce({ id: PARENT_UUID, thread_id: THREAD_UUID, author_id: USER_UUID })
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await send(PARENT_UUID)

    expect(res.statusCode).toBe(201)
    await new Promise(r => setTimeout(r, 20))
    expect(NotificationModel.create).not.toHaveBeenCalled()
  })
})

// ── Durcissement vitrine (incident nerti 2026-09-01) ──────────
//
// 1. POST /threads : une catégorie post_min_role != 'member' refuse un membre.
// 2. PATCH /threads/:id : is_featured est réservé aux admins/owners.

describe('POST /api/v1/forums/threads — catégorie restreinte', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const COMMUNITY_UUID = '7ba7b810-9dad-11d1-80b4-00c04fd430c8'

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  function routeQueries(opts: { postMinRole: string; memberRole: string | null }) {
    vi.mocked(db.query).mockImplementation((sql: any) => {
      const q = String(sql)
      if (q.includes('post_min_role FROM categories')) {
        return Promise.resolve({ rows: [{ community_id: COMMUNITY_UUID, post_min_role: opts.postMinRole }], rowCount: 1 } as any)
      }
      if (q.includes('FROM community_bans')) {
        return Promise.resolve({ rows: [], rowCount: 0 } as any)
      }
      if (q.includes('role FROM community_members')) {
        return Promise.resolve({ rows: opts.memberRole ? [{ role: opts.memberRole }] : [], rowCount: opts.memberRole ? 1 : 0 } as any)
      }
      return Promise.resolve({ rows: [], rowCount: 0 } as any)
    })
  }

  it('renvoie 403 CATEGORY_RESTRICTED pour un membre dans une catégorie admin-only', async () => {
    routeQueries({ postMinRole: 'admin', memberRole: 'member' })

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Alsouq Alshabi', content: '<p>spam</p>' },
    })

    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('CATEGORY_RESTRICTED')
    expect(ThreadModel.create).not.toHaveBeenCalled()
  })

  it('laisse un admin poster dans la même catégorie', async () => {
    routeQueries({ postMinRole: 'admin', memberRole: 'admin' })
    vi.mocked(ThreadModel.create).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Release v3', content: '<p>notes</p>' },
    })

    expect(res.statusCode).toBe(201)
  })

  it('non-régression : catégorie ouverte (member) accepte un membre', async () => {
    routeQueries({ postMinRole: 'member', memberRole: 'member' })
    vi.mocked(ThreadModel.create).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Coucou', content: '<p>hello</p>' },
    })

    expect(res.statusCode).toBe(201)
  })
})

describe('PATCH /api/v1/forums/threads/:id — is_featured réservé aux admins', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const OTHER_AUTHOR = '8ba7b810-9dad-11d1-80b4-00c04fd430c8'

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('renvoie 403 pour un modérateur (pas admin)', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, author_id: OTHER_AUTHOR } as any)
    // isInstanceAdmin() résout d'abord communityId via getInstanceCommunityId() (FROM communities),
    // puis interroge community_members : router par contenu SQL, pas par ordre d'appel.
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const s = String(sql)
      if (s.includes('FROM communities')) return { rows: [{ id: 'community-1' }], rowCount: 1 } as any
      return { rows: [{ role: 'moderator' }], rowCount: 1 } as any
    })

    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { is_featured: true },
    })

    expect(res.statusCode).toBe(403)
    expect(ThreadModel.update).not.toHaveBeenCalled()
  })

  it('laisse un admin mettre en avant', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, author_id: OTHER_AUTHOR } as any)
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const s = String(sql)
      if (s.includes('FROM communities')) return { rows: [{ id: 'community-1' }], rowCount: 1 } as any
      // Communauté du fil (droits du forum, services/permissions.communityOfThread)
      if (s.includes('FROM threads t JOIN categories')) return { rows: [{ community_id: 'community-1' }], rowCount: 1 } as any
      return { rows: [{ role: 'admin' }], rowCount: 1 } as any
    })
    vi.mocked(ThreadModel.update).mockResolvedValueOnce({ ...FAKE_THREAD, is_featured: true } as any)

    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { is_featured: true },
    })

    expect(res.statusCode).toBe(200)
    expect(ThreadModel.update).toHaveBeenCalledWith(THREAD_UUID, expect.objectContaining({ is_featured: true }))
  })
})

describe('PATCH /api/v1/forums/threads/:id : nettoyage du titre (injection audit 17/09)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    // isMod : aucune ligne -> l'auteur n'a pas de droit de modération, passe
    // par la branche "Authors without mod rights can only edit the title".
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('un auteur sans droit de mod ne peut pas injecter de balises via le titre', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD } as any)
    vi.mocked(ThreadModel.update).mockResolvedValueOnce({ ...FAKE_THREAD, title: 'alert(1)' } as any)

    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { title: '<script>alert(1)</script>' },
    })

    expect(res.statusCode).toBe(200)
    expect(ThreadModel.update).toHaveBeenCalledWith(THREAD_UUID, { title: 'alert(1)' })
  })

  it('refuse un titre qui ne devient que du vide une fois les balises retirées', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD } as any)

    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { title: '<script></script>' },
    })

    expect(res.statusCode).toBe(403)
    expect(ThreadModel.update).not.toHaveBeenCalled()
  })
})

// Módulo RPG (trik, Fase 2) — toggle de trik_threads via is_xp_enabled.
// Ver plans/fase-dois-passo-a-passo.md, passo 4.4: XP continua só para
// owner/admin da comunidade do fio (moderador não basta), pelo rank do getAccess.
describe('PATCH /api/v1/forums/threads/:id — is_xp_enabled (trik)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('retorna 403 quando quem pede é moderador mas não owner/admin', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'moderator', community_id: 'community-1' }], rowCount: 1 } as any)

    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { is_xp_enabled: true },
    })

    expect(res.statusCode).toBe(403)
    expect(TrikModel.setXpThread).not.toHaveBeenCalled()
  })

  it('owner/admin marca o tópico como elegível pra XP', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'admin', community_id: 'community-1' }], rowCount: 1 } as any)
    vi.mocked(ThreadModel.update).mockResolvedValueOnce({ ...FAKE_THREAD } as any)

    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { is_xp_enabled: true },
    })

    expect(res.statusCode).toBe(200)
    expect(TrikModel.setXpThread).toHaveBeenCalledWith(THREAD_UUID, true, USER_UUID)
  })

  it('owner/admin desmarca o tópico', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'owner', community_id: 'community-1' }], rowCount: 1 } as any)
    vi.mocked(ThreadModel.update).mockResolvedValueOnce({ ...FAKE_THREAD } as any)

    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { is_xp_enabled: false },
    })

    expect(res.statusCode).toBe(200)
    expect(TrikModel.setXpThread).toHaveBeenCalledWith(THREAD_UUID, false, USER_UUID)
  })
})

// ── Módulo RPG (trik): selo de XP e ciclo de vida das cenas ────────────────────
// Achados da revisão de código de 2026-09-20: apagar/editar um post precisa
// desfazer o xp ANTES de mexer no post (o CASCADE de trik_scene_awards leva o
// prêmio junto com o post), e o revert de uma edição tem que terminar antes do
// reprocesso começar (senão os dois disputam a mesma linha).

describe('GET /api/v1/forums/threads/:id — xp_enabled (trik)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it.each([true, false])('devolve xp_enabled=%s junto com o tópico (sem rota admin)', async (enabled) => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(TrikModel.isXpThread).mockResolvedValueOnce(enabled)

    const res = await app.inject({ method: 'GET', url: `/api/v1/forums/threads/${THREAD_UUID}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().xp_enabled).toBe(enabled)
    expect(TrikModel.isXpThread).toHaveBeenCalledWith(THREAD_UUID)
  })

  it('falha do módulo RPG não derruba a página do tópico', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(TrikModel.isXpThread).mockRejectedValueOnce(new Error('tabela trik_threads não existe'))

    const res = await app.inject({ method: 'GET', url: `/api/v1/forums/threads/${THREAD_UUID}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().xp_enabled).toBe(false)
  })
})

describe('DELETE /api/v1/forums/posts/:id — desfaz o xp antes de apagar (trik)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('reverte o prêmio ANTES do DELETE (com o post já apagado o CASCADE levou a linha)', async () => {
    vi.mocked(PostModel.getAuthorAndThread).mockResolvedValueOnce({ author_id: USER_UUID, thread_id: THREAD_UUID } as any)
    vi.mocked(PostModel.removeById).mockResolvedValueOnce(true)

    const res = await app.inject({
      method: 'DELETE', url: `/api/v1/forums/posts/${FAKE_POST.id}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    })

    expect(res.statusCode).toBe(204)
    expect(TrikModel.revertSceneAward).toHaveBeenCalledWith(FAKE_POST.id)
    const revertOrder = vi.mocked(TrikModel.revertSceneAward).mock.invocationCallOrder[0]
    const removeOrder = vi.mocked(PostModel.removeById).mock.invocationCallOrder[0]
    expect(revertOrder).toBeLessThan(removeOrder)
  })
})

describe('PATCH /api/v1/forums/threads/:id — apagar o tópico desfaz o xp das cenas (trik)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('reverte cada post premiado do tópico antes do ThreadModel.remove', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'moderator', community_id: 'community-1' }], rowCount: 1 } as any)
    vi.mocked(TrikModel.listAwardedPostIdsByThread).mockResolvedValueOnce(['post-a', 'post-b'])

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { delete: true },
    })

    expect(res.statusCode).toBe(204)
    expect(TrikModel.listAwardedPostIdsByThread).toHaveBeenCalledWith(THREAD_UUID)
    expect(TrikModel.revertSceneAward).toHaveBeenCalledWith('post-a')
    expect(TrikModel.revertSceneAward).toHaveBeenCalledWith('post-b')
    const lastRevert = Math.max(...vi.mocked(TrikModel.revertSceneAward).mock.invocationCallOrder)
    expect(lastRevert).toBeLessThan(vi.mocked(ThreadModel.remove).mock.invocationCallOrder[0])
  })
})

describe('PUT /api/v1/forums/posts/:id — revert e reprocesso em sequência (trik)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('só reprocessa a cena depois que o revert terminou', async () => {
    vi.mocked(PostModel.getAuthorAndThread).mockResolvedValueOnce({ author_id: USER_UUID, thread_id: THREAD_UUID } as any)
    vi.mocked(PostModel.updateContent).mockResolvedValueOnce(FAKE_POST as any)
    let releaseRevert!: () => void
    vi.mocked(TrikModel.revertSceneAward).mockReturnValueOnce(new Promise<void>(resolve => { releaseRevert = resolve }))

    const res = await app.inject({
      method: 'PUT', url: `/api/v1/forums/posts/${FAKE_POST.id}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { content: '<p>editado</p>' },
    })

    // A resposta não espera o RPG...
    expect(res.statusCode).toBe(200)
    // ...mas o reprocesso (que começa por isXpThread) não pode iniciar com o revert em aberto.
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(TrikModel.revertSceneAward).toHaveBeenCalledWith(FAKE_POST.id)
    expect(TrikModel.isXpThread).not.toHaveBeenCalled()

    releaseRevert()
    await vi.waitFor(() => expect(TrikModel.isXpThread).toHaveBeenCalledWith(THREAD_UUID))
  })
})

describe('PATCH /api/v1/forums/threads/:id : l’équipe change les tags d’un sujet', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const OTHER_AUTHOR = '8ba7b810-9dad-11d1-80b4-00c04fd430c8'
  const T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222'
  let known: string[]
  let role: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    known = [T1, T2]; role = 'admin'
    vi.mocked(db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      const s = String(sql)
      if (s.includes('FROM communities')) return { rows: [{ id: 'community-1' }], rowCount: 1 } as any
      if (s.includes('FROM threads t JOIN categories')) return { rows: [{ community_id: 'community-1' }], rowCount: 1 } as any
      if (s.includes('FROM tags WHERE id = ANY')) return { rows: [{ n: (params![0] as string[]).filter((i) => known.includes(i)).length }], rowCount: 1 } as any
      return { rows: [{ role }], rowCount: 1 } as any
    })
    vi.mocked(ThreadModel.update).mockResolvedValue({ ...FAKE_THREAD } as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })
  const patch = (tag_ids: unknown, author = OTHER_AUTHOR) => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, author_id: author } as any)
    return app.inject({ method: 'PATCH', url: `/api/v1/forums/threads/${THREAD_UUID}`, headers: { authorization: `Bearer ${makeToken()}` }, payload: { tag_ids } })
  }
  const TagModel = () => import('../models/tag')

  it('un membre de l’équipe change les tags : doublons retirés', async () => {
    const res = await patch([T1, T2, T1.toUpperCase()])
    expect(res.statusCode).toBe(200)
    expect((await TagModel()).setThreadTags).toHaveBeenCalledWith(THREAD_UUID, [T1, T2])
  })
  it('retirer tous les tags : liste vide acceptée', async () => {
    expect((await patch([])).statusCode).toBe(200)
    expect((await TagModel()).setThreadTags).toHaveBeenCalledWith(THREAD_UUID, [])
  })
  it('plus de 5 tags : 400, rien n’est touché', async () => {
    known = Array.from({ length: 6 }, (_, i) => `${i}1111111-1111-4111-8111-111111111111`)
    const res = await patch(known)
    expect(res.json().code).toBe('THREAD_TAGS_TOO_MANY')
    expect((await TagModel()).setThreadTags).not.toHaveBeenCalled()
    expect(ThreadModel.update).not.toHaveBeenCalled()
  })
  it('un tag inconnu : 400 AVANT d’effacer les tags existants', async () => {
    const res = await patch([T1, '33333333-3333-4333-8333-333333333333'])
    expect(res.json().code).toBe('THREAD_TAGS_UNKNOWN')
    expect((await TagModel()).setThreadTags).not.toHaveBeenCalled()
  })
  it('pas une liste d’identifiants : 400 au lieu d’une erreur 500', async () => {
    for (const bad of ['tuto', [42], ['pas-un-uuid'], { a: 1 }]) {
      expect((await patch(bad)).json().code).toBe('THREAD_TAGS_INVALID')
    }
    expect((await TagModel()).setThreadTags).not.toHaveBeenCalled()
  })
  it('uma tag restrita a outra categoria : 400, nada é gravado', async () => {
    vi.mocked((await TagModel()).tagsNotAllowedIn).mockResolvedValueOnce([T2])
    const res = await patch([T1, T2])
    expect(res.json().code).toBe('THREAD_TAG_NOT_IN_CATEGORY')
    expect((await TagModel()).setThreadTags).not.toHaveBeenCalled()
  })
  it('l’auteur sans droit de modération ne change pas les tags', async () => {
    role = 'member'
    const res = await patch([T1], USER_UUID)
    expect(res.statusCode).toBe(403)
    expect((await TagModel()).setThreadTags).not.toHaveBeenCalled()
  })
})

// ── Conteúdo privado por cargo (trik_025) ─────────────────────────────────────
// A regra em si (quem vê o quê) mora nas funções SQL nx_can_view_*; aqui se
// verifica que CADA rota do fórum a consulta e se comporta como "não existe"
// para quem não pode ver — 404, nunca 403, para não confirmar que o tópico existe.

describe('Conteúdo privado (trik_025) — rotas do fórum', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const OTHER = '8ba7b810-9dad-11d1-80b4-00c04fd430c8'
  const GRADE = '11111111-1111-4111-8111-111111111111'

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    vi.mocked(Private.canViewThread).mockResolvedValue(true)
    vi.mocked(Private.canViewCategory).mockResolvedValue(true)
    vi.mocked(Private.usersWhoCanViewThread).mockImplementation(async (_t: string, ids: string[]) => ids)
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('página do tópico: sem acesso = 404, e os posts nem são lidos', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(Private.canViewThread).mockResolvedValueOnce(false)

    const res = await app.inject({ method: 'GET', url: `/api/v1/forums/threads/${THREAD_UUID}` })

    expect(res.statusCode).toBe(404)
    expect(PostModel.listByThread).not.toHaveBeenCalled()
    expect(Private.canViewThread).toHaveBeenCalledWith(THREAD_UUID, undefined)
  })

  it('página do tópico: quem pode ver recebe os cargos do tópico', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(Private.getThreadGrades).mockResolvedValueOnce([{ id: GRADE, name: 'VIP', color: '#ff0000' }])

    const res = await app.inject({
      method: 'GET', url: `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().thread.grades).toEqual([{ id: GRADE, name: 'VIP', color: '#ff0000' }])
    expect(Private.canViewThread).toHaveBeenCalledWith(THREAD_UUID, USER_UUID)
  })

  it('lista de uma categoria fechada: 404', async () => {
    vi.mocked(Private.canViewCategory).mockResolvedValueOnce(false)

    const res = await app.inject({ method: 'GET', url: `/api/v1/forums/threads?category_id=${CATEGORY_UUID}` })

    expect(res.statusCode).toBe(404)
  })

  it('lista de uma categoria aberta: o filtro por tópico vai NA consulta, com quem pede', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/forums/threads?category_id=${CATEGORY_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    })

    expect(res.statusCode).toBe(200)
    const list = vi.mocked(db.query).mock.calls.find(([sql]) => String(sql).includes('FROM threads t') && String(sql).includes('LIMIT $2'))!
    expect(String(list[0])).toContain('nx_can_view_thread(t.id, $5::uuid)')
    expect(list[1]).toEqual([CATEGORY_UUID, 50, 0, null, USER_UUID])
    // a contagem de tags também não pode revelar tópico escondido
    const tags = vi.mocked(db.query).mock.calls.find(([sql]) => String(sql).includes('FROM thread_tags tt'))!
    expect(String(tags[0])).toContain('nx_can_view_thread')
  })

  it('responder num tópico que não se vê: 404, nada é gravado', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(Private.canViewThread).mockResolvedValueOnce(false)

    const res = await app.inject({
      method: 'POST', url: '/api/v1/forums/posts',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { thread_id: THREAD_UUID, content: '<p>Oi</p>' },
    })

    expect(res.statusCode).toBe(404)
    expect(PostModel.create).not.toHaveBeenCalled()
  })

  it('aviso de resposta: só quem pode ver o tópico é notificado', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, author_id: OTHER } as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)
    // o autor do tópico perdeu o acesso (ex.: mudou de cargo)
    vi.mocked(Private.usersWhoCanViewThread).mockResolvedValueOnce([])

    const res = await app.inject({
      method: 'POST', url: '/api/v1/forums/posts',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { thread_id: THREAD_UUID, content: '<p>Oi</p>' },
    })

    expect(res.statusCode).toBe(201)
    await vi.waitFor(() => expect(Private.usersWhoCanViewThread).toHaveBeenCalledWith(THREAD_UUID, [OTHER]))
    expect(NotificationModel.create).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'thread_reply' }))
  })

  it('editar post de tópico que não se vê: 404', async () => {
    vi.mocked(PostModel.getAuthorAndThread).mockResolvedValueOnce({ author_id: USER_UUID, thread_id: THREAD_UUID } as any)
    vi.mocked(Private.canViewThread).mockResolvedValueOnce(false)

    const res = await app.inject({
      method: 'PUT', url: `/api/v1/forums/posts/${FAKE_POST.id}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { content: '<p>editado</p>' },
    })

    expect(res.statusCode).toBe(404)
    expect(PostModel.updateContent).not.toHaveBeenCalled()
  })

  it('PATCH do tópico: sem acesso = 404 (nem a equipe de outra área "adivinha" o id)', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(Private.canViewThread).mockResolvedValueOnce(false)

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { title: 'novo' },
    })

    expect(res.statusCode).toBe(404)
    expect(ThreadModel.update).not.toHaveBeenCalled()
  })

  it('PATCH grade_ids inválido: 400 antes de qualquer escrita', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, author_id: OTHER } as any)
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const s = String(sql)
      if (s.includes('FROM threads t JOIN categories')) return { rows: [{ community_id: 'community-1' }], rowCount: 1 } as any
      if (s.includes('FROM community_grades')) return { rows: [{ n: 0 }], rowCount: 1 } as any
      return { rows: [{ role: 'admin', community_id: 'community-1' }], rowCount: 1 } as any
    })

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { grade_ids: [GRADE] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('THREAD_GRADES_INVALID')
    expect(Private.setThreadGrades).not.toHaveBeenCalled()
  })

  it('criar tópico numa categoria que não se vê: 404', async () => {
    vi.mocked(Private.canViewCategory).mockResolvedValueOnce(false)

    const res = await app.inject({
      method: 'POST', url: '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Segredo', content: '<p>x</p>' },
    })

    expect(res.statusCode).toBe(404)
    expect(ThreadModel.create).not.toHaveBeenCalled()
  })

  it('membro só restringe o tópico ao PRÓPRIO cargo', async () => {
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const s = String(sql)
      if (s.includes('SELECT community_id, post_min_role FROM categories')) return { rows: [{ community_id: 'community-1', post_min_role: 'member' }], rowCount: 1 } as any
      if (s.includes('COUNT(*)::int AS n FROM community_grades')) return { rows: [{ n: 1 }], rowCount: 1 } as any
      if (s.includes('SELECT grade_id FROM community_members')) return { rows: [{ grade_id: null }], rowCount: 1 } as any
      return { rows: [{ role: 'member' }], rowCount: 1 } as any
    })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Segredo', content: '<p>x</p>', grade_ids: [GRADE] },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('THREAD_GRADES_FORBIDDEN')
    expect(ThreadModel.create).not.toHaveBeenCalled()
  })
})
