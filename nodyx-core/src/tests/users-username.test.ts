// Troca de nome de usuário (trik_011): rotas de users.ts com o model mockado.
// A regra de banco (transação, intervalo, reserva) é coberta no model.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

vi.mock('../config/database', () => ({
  db: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  redis: {
    exists:   vi.fn(),
    set:      vi.fn().mockResolvedValue('OK'),
    del:      vi.fn().mockResolvedValue(1),
    incr:     vi.fn().mockResolvedValue(1),
    expire:   vi.fn().mockResolvedValue(1),
    ttl:      vi.fn().mockResolvedValue(60),
    setex:    vi.fn().mockResolvedValue('OK'),
    sadd:     vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue(['old-token']),
  },
}))

vi.mock('../models/usernameHistory', async () => {
  const actual = await vi.importActual<typeof import('../models/usernameHistory')>('../models/usernameHistory')
  return {
    ...actual,
    changeUsername:         vi.fn(),
    nextUsernameChangeAt:   vi.fn(),
    resolveRenamedUsername: vi.fn(),
  }
})

import { redis } from '../config/database'
import * as History from '../models/usernameHistory'
import userRoutes from '../routes/users'

const USER = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const token = jwt.sign({ userId: USER, username: 'antigo' }, process.env.JWT_SECRET!, { expiresIn: '7d' })
const auth = { Authorization: `Bearer ${token}` }

describe('troca de nome de usuário', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(userRoutes, { prefix: '/api/v1/users' }))
  })

  const patch = (username: unknown, headers: Record<string, string> = auth) =>
    app.inject({ method: 'PATCH', url: '/api/v1/users/me/username', headers, payload: { username } as any })

  it('troca, encerra as sessões antigas e devolve um token novo com o nome novo', async () => {
    vi.mocked(History.changeUsername).mockResolvedValue({ oldUsername: 'antigo', username: 'novo' })
    const res = await patch('  novo  ')
    expect(res.statusCode).toBe(200)
    expect(History.changeUsername).toHaveBeenCalledWith(USER, 'novo')
    const body = res.json()
    expect(jwt.decode(body.token)).toMatchObject({ userId: USER, username: 'novo' })
    expect(redis.del).toHaveBeenCalledWith('session:old-token', `user_sessions:${USER}`)
    expect(redis.set).toHaveBeenCalledWith(`session:${body.token}`, USER, 'EX', expect.any(Number))
  })

  it('traduz os erros do model em HTTP', async () => {
    const cases: [History.UsernameChangeError['code'], number][] = [['TAKEN', 409], ['TOO_SOON', 429], ['SAME', 400]]
    for (const [code, status] of cases) {
      vi.mocked(History.changeUsername).mockRejectedValueOnce(new History.UsernameChangeError(code, 'x'))
      expect((await patch('outro')).statusCode, code).toBe(status)
    }
  })

  it('valida o tamanho e exige login', async () => {
    expect((await patch('ab')).statusCode).toBe(400)
    expect((await patch('x'.repeat(51))).statusCode).toBe(400)
    expect((await patch('novo', {})).statusCode).toBe(401)
    expect(History.changeUsername).not.toHaveBeenCalled()
  })

  it('GET /me/username informa quando a próxima troca libera', async () => {
    vi.mocked(History.nextUsernameChangeAt).mockResolvedValue(new Date('2026-11-13T00:00:00Z'))
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me/username', headers: auth })
    expect(res.json()).toEqual({ nextChangeAt: '2026-11-13T00:00:00.000Z', intervalDays: 30 })
  })

  it('GET /resolve/:username devolve o nome atual de um nome antigo', async () => {
    vi.mocked(History.resolveRenamedUsername).mockResolvedValueOnce('novo').mockResolvedValueOnce(null)
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/resolve/antigo' })).json()).toEqual({ username: 'novo' })
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/resolve/ninguem' })).statusCode).toBe(404)
  })
})
