import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

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
}))

// O bot real puxa bcrypt/db só pra reagir/postar — aqui só importa que não falhe.
vi.mock('../services/trik/bot', () => ({
  postTrikMessage:     vi.fn().mockResolvedValue(undefined),
  postTrikThreadReply: vi.fn().mockResolvedValue(undefined),
  reactSceneCounted:   vi.fn().mockResolvedValue(undefined),
  unreactSceneCounted: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ───────────────────────────────────────────────────

import * as ThreadModel from '../models/thread'
import * as PostModel   from '../models/post'
import * as TrikModel   from '../models/trik'
import { redis, db }    from '../config/database'
import forumRoutes      from '../routes/forums'

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
// Ver plans/fase-dois-passo-a-passo.md, passo 4.4: mesmo guard de
// isAdmin() que já restringe pin/lock (só owner/admin, moderador não basta).
describe('PATCH /api/v1/forums/threads/:id — is_xp_enabled (trik)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('retorna 403 quando quem pede é moderador mas não owner/admin', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'moderator' }], rowCount: 1 } as any)

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
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'admin' }], rowCount: 1 } as any)
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
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'owner' }], rowCount: 1 } as any)
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
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'moderator' }], rowCount: 1 } as any)
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
