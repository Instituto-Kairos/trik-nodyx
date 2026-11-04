import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  redis: {
    exists: vi.fn().mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1)),
    setex:  vi.fn().mockResolvedValue('OK'),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../services/assetService', () => ({
  uploadAsset:    vi.fn(),
  getAssetMeta:   vi.fn(),
  listUserAssets: vi.fn(),
  searchAssets:   vi.fn(),
  deleteAsset:    vi.fn(),
  listOwnBulk:    vi.fn(),
  setAssetType:   vi.fn(),
}))

// Minimal mock for adminOnly — asset admin routes use it
vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: any, reply: any) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    }
    req.user = { userId: 'admin-uuid', username: 'admin' }
  }),
}))

// ── Imports ───────────────────────────────────────────────────

import * as AssetService from '../services/assetService'
import { db, redis }     from '../config/database'
import assetRoutes       from '../routes/assets'

// ── Helpers ───────────────────────────────────────────────────

const USER_UUID  = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const ASSET_UUID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'

function makeToken(userId = USER_UUID, username = 'testuser') {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

const FAKE_ASSET = {
  id:           ASSET_UUID,
  creator_id:   USER_UUID,
  name:         'Cool Frame',
  asset_type:   'ik',
  file_path:    'assets/cool-frame.webp',
  thumbnail_path: 'assets/cool-frame-thumb.webp',
  tags:         ['fantasy'],
  is_banned:    false,
  created_at:   new Date(),
}

// ── Tests — GET / (search) ────────────────────────────────────

describe('GET /api/v1/assets', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(AssetService.searchAssets).mockResolvedValue([FAKE_ASSET] as any)
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('returns 200 with array of assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.assets)).toBe(true)
    expect(body.assets[0].name).toBe('Cool Frame')
  })

  it('accepts type filter query param', async () => {
    vi.mocked(AssetService.searchAssets).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets?type=ik' })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(AssetService.searchAssets)).toHaveBeenCalledWith(
      expect.objectContaining({ assetType: 'ik' })
    )
  })

  it('rejects the removed categories (frame, banner, sticker, image)', async () => {
    for (const t of ['frame', 'banner', 'sticker', 'image']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/assets?type=${t}` })
      expect(res.statusCode).toBe(400)
    }
  })

  it('returns 400 for invalid type value', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets?type=invalid' })
    expect(res.statusCode).toBe(400)
  })

  it('passes search query to searchAssets', async () => {
    vi.mocked(AssetService.searchAssets).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets?q=frame' })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(AssetService.searchAssets)).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'frame' })
    )
  })
})

// ── Tests — GET /:id ──────────────────────────────────────────

describe('GET /api/v1/assets/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('returns 200 with asset metadata for existing asset', async () => {
    vi.mocked(AssetService.getAssetMeta).mockResolvedValue(FAKE_ASSET as any)
    const res = await app.inject({ method: 'GET', url: `/api/v1/assets/${ASSET_UUID}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.asset.id).toBe(ASSET_UUID)
  })

  it('returns 404 when asset not found', async () => {
    vi.mocked(AssetService.getAssetMeta).mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: `/api/v1/assets/${ASSET_UUID}` })
    expect(res.statusCode).toBe(404)
  })
})

// ── Tests — GET /user/:userId ─────────────────────────────────

describe('GET /api/v1/assets/user/:userId', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(AssetService.listUserAssets).mockResolvedValue([FAKE_ASSET] as any)
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('returns 200 with list of user assets', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/assets/user/${USER_UUID}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.assets)).toBe(true)
  })
})

// ── Tests — DELETE /:id ───────────────────────────────────────

describe('DELETE /api/v1/assets/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/assets/${ASSET_UUID}` })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when asset not found or not owner', async () => {
    vi.mocked(AssetService.deleteAsset).mockResolvedValue(false)
    const token = makeToken()
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/assets/${ASSET_UUID}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 200 when asset deleted successfully', async () => {
    vi.mocked(AssetService.deleteAsset).mockResolvedValue(true)
    const token = makeToken()
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/assets/${ASSET_UUID}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
  })
})

// ── Tests — GET /mine/bulk (trik_019) ─────────────────────────

describe('GET /api/v1/assets/mine/bulk', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets/mine/bulk' })
    expect(res.statusCode).toBe(401)
  })

  it("lists only the caller's own bulk", async () => {
    vi.mocked(AssetService.listOwnBulk).mockResolvedValue([{ ...FAKE_ASSET, asset_type: 'bulk' }] as any)
    const res = await app.inject({
      method: 'GET', url: '/api/v1/assets/mine/bulk',
      headers: { Authorization: `Bearer ${makeToken()}` },
    })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(AssetService.listOwnBulk)).toHaveBeenCalledWith(USER_UUID)
  })
})

// ── Tests — PATCH /:id/type (trik_019) ────────────────────────

const OTHER_UUID = '7ca7b810-9dad-11d1-80b4-00c04fd430c8'

/** db.query mock por SQL: o asset atual e o papel do usuário na comunidade. */
function mockDb(asset: { creator_id: string; asset_type: string; mime_type?: string } | null, role: string | null) {
  vi.mocked(db.query).mockImplementation((sql: any) => {
    const q = String(sql)
    if (q.includes('FROM community_assets')) {
      return Promise.resolve({ rows: asset ? [{ mime_type: 'image/webp', ...asset }] : [], rowCount: asset ? 1 : 0 }) as any
    }
    if (q.includes('FROM communities')) return Promise.resolve({ rows: [{ id: 'comm-1' }], rowCount: 1 }) as any
    if (q.includes('FROM community_members')) return Promise.resolve({ rows: role ? [{ role }] : [], rowCount: role ? 1 : 0 }) as any
    return Promise.resolve({ rows: [], rowCount: 0 }) as any
  })
}

describe('PATCH /api/v1/assets/:id/type', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  const patch = (asset_type: string, userId = USER_UUID) => app.inject({
    method:  'PATCH',
    url:     `/api/v1/assets/${ASSET_UUID}/type`,
    headers: { Authorization: `Bearer ${makeToken(userId)}` },
    payload: { asset_type },
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(AssetService.setAssetType).mockImplementation(async (_id, t) => ({ ...FAKE_ASSET, asset_type: t }) as any)
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('lets the creator move their own asset out of bulk', async () => {
    mockDb({ creator_id: USER_UUID, asset_type: 'bulk' }, 'member')
    const res = await patch('au')
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(AssetService.setAssetType)).toHaveBeenCalledWith(ASSET_UUID, 'au')
  })

  it("forbids a non-admin from changing someone else's asset", async () => {
    mockDb({ creator_id: OTHER_UUID, asset_type: 'ik' }, 'member')
    const res = await patch('au')
    expect(res.statusCode).toBe(403)
    expect(vi.mocked(AssetService.setAssetType)).not.toHaveBeenCalled()
  })

  it("lets an admin change anyone's asset", async () => {
    mockDb({ creator_id: OTHER_UUID, asset_type: 'bulk' }, 'admin')
    const res = await patch('ik')
    expect(res.statusCode).toBe(200)
  })

  it('keeps staff admin-only, both ways', async () => {
    mockDb({ creator_id: USER_UUID, asset_type: 'bulk' }, 'member')
    expect((await patch('staff')).statusCode).toBe(403)
    mockDb({ creator_id: USER_UUID, asset_type: 'staff' }, 'member')
    expect((await patch('ik')).statusCode).toBe(403)
  })

  it('refuses non-image internal types (sound)', async () => {
    mockDb({ creator_id: USER_UUID, asset_type: 'sound', mime_type: 'audio/mpeg' }, 'member')
    expect((await patch('ik')).statusCode).toBe(400)
  })

  it('rejects target types outside the image categories', async () => {
    mockDb({ creator_id: USER_UUID, asset_type: 'bulk' }, 'member')
    expect((await patch('sound')).statusCode).toBe(400)
    expect((await patch('frame')).statusCode).toBe(400)
  })

  it('returns 404 for a missing asset', async () => {
    mockDb(null, 'member')
    expect((await patch('ik')).statusCode).toBe(404)
  })
})
