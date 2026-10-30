// Emblemas — rotas admin: só admin dá emblema, e só asset do tipo badge.
// Mesmo padrão de mocks de trik-admin.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

const { COMMUNITY_UUID } = vi.hoisted(() => ({
  COMMUNITY_UUID: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
}))

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
}))

// adminOnly: passa com header Bearer, 403 se conter "notadmin"
vi.mock('../middleware/adminOnly', () => ({
  getInstanceCommunityId: vi.fn().mockResolvedValue(COMMUNITY_UUID),
  adminOnly: vi.fn(async (req: any, reply: any) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    }
    if (header.includes('notadmin')) {
      return reply.code(403).send({ error: 'Admin access required', code: 'FORBIDDEN' })
    }
    req.user = { userId: 'admin-uuid', username: 'admin' }
  }),
}))

import { db } from '../config/database'
import emblemasRoutes from '../routes/emblemas'

const USER_UUID  = '33333333-3333-4333-8333-333333333333'
const BADGE_UUID = '44444444-4444-4444-8444-444444444444'

const query = db.query as unknown as ReturnType<typeof vi.fn>

// Responde por trecho do SQL: membro existe? emblema existe? o resto passa.
function mockDb({ member = true, badge = true } = {}) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM community_members WHERE')) return { rows: member ? [{}] : [] }
    if (sql.includes('FROM community_assets'))       return { rows: badge ? [{}] : [] }
    return { rows: [], rowCount: 1 }
  })
}

function give(body: unknown, auth = 'Bearer admin') {
  return app.inject({
    method: 'PUT', url: `/api/v1/admin/emblemas/${USER_UUID}`,
    headers: { Authorization: auth }, payload: body as object,
  })
}

let app: Awaited<ReturnType<typeof buildApp>>

describe('emblemasRoutes', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockDb()
    app = await buildApp(a => a.register(emblemasRoutes, { prefix: '/api/v1/admin/emblemas' }))
  })

  it('retorna 403 pra quem não é admin', async () => {
    const res = await give({ badge_asset_id: BADGE_UUID }, 'Bearer notadmin')
    expect(res.statusCode).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('dá o emblema ao membro', async () => {
    const res = await give({ badge_asset_id: BADGE_UUID })
    expect(res.statusCode).toBe(200)
    const upsert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO user_profiles'))
    expect(upsert?.[1]).toEqual([USER_UUID, BADGE_UUID])
  })

  it('tira o emblema com null, sem checar asset', async () => {
    const res = await give({ badge_asset_id: null })
    expect(res.statusCode).toBe(200)
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM community_assets'))).toBe(false)
    const upsert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO user_profiles'))
    expect(upsert?.[1]).toEqual([USER_UUID, null])
  })

  it('recusa asset que não é emblema (ou foi banido)', async () => {
    mockDb({ badge: false })
    const res = await give({ badge_asset_id: BADGE_UUID })
    expect(res.statusCode).toBe(400)
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO user_profiles'))).toBe(false)
  })

  it('retorna 404 pra quem não é membro da comunidade', async () => {
    mockDb({ member: false })
    const res = await give({ badge_asset_id: BADGE_UUID })
    expect(res.statusCode).toBe(404)
  })
})
