// Módulo RPG (trik) — trikAdminPlugin: rotas /api/v1/admin/trik/bot.
// Segunda parte dos testes da Fase 1 — complementa trik-admin.test.ts
// (que só cobre GET/PUT /channels) com o perfil do bot Trik e o upload
// de avatar (mime declarado + scanBuffer).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fastifyMultipart from '@fastify/multipart'
import { buildApp } from './helpers/buildApp'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
}))

vi.mock('../models/channel', () => ({
  listByCommunity: vi.fn(),
}))

vi.mock('../models/trik', () => ({
  getChannelPurposes: vi.fn(),
  setChannelPurposes: vi.fn(),
}))

// adminOnly: mesmo mock de trik-admin.test.ts — passa com header Bearer,
// 403 se contiver "notadmin".
vi.mock('../middleware/adminOnly', () => ({
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

vi.mock('../services/trik/bot', () => ({
  getTrikBotProfile:    vi.fn(),
  updateTrikBotProfile: vi.fn(),
  postTrikMessage:      vi.fn(),
}))

vi.mock('../services/fileScanner', () => ({
  scanBuffer: vi.fn(),
}))

// mkdirSync/writeFile: evita gravar arquivo de verdade em uploads/trik-bot/
// durante o teste — mantém o resto de 'fs'/'fs/promises' intacto.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, mkdirSync: vi.fn() }
})
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return { ...actual, writeFile: vi.fn().mockResolvedValue(undefined) }
})

import { getTrikBotProfile, updateTrikBotProfile } from '../services/trik/bot'
import { scanBuffer } from '../services/fileScanner'
import { trikAdminPlugin } from '../routes/trik'

function multipartBody(boundary: string, filename: string, contentType: string, content: Buffer) {
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return Buffer.concat([head, content, tail])
}

describe('trikAdminPlugin — bot', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(async a => {
      await a.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024 } })
      await a.register(trikAdminPlugin, { prefix: '/api/v1/admin/trik' })
    })
  })

  describe('GET /bot', () => {
    it('retorna 401 sem token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/trik/bot' })
      expect(res.statusCode).toBe(401)
    })

    it('retorna 403 pra quem não é admin', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/bot',
        headers: { Authorization: 'Bearer notadmin' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('retorna o perfil do bot', async () => {
      vi.mocked(getTrikBotProfile).mockResolvedValue({ username: 'Trik', avatarUrl: null, bio: null })
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/bot',
        headers: { Authorization: 'Bearer admin' },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ bot: { username: 'Trik', avatarUrl: null, bio: null } })
    })

    it('retorna 503 se o bot não existir', async () => {
      vi.mocked(getTrikBotProfile).mockResolvedValue(null)
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/bot',
        headers: { Authorization: 'Bearer admin' },
      })
      expect(res.statusCode).toBe(503)
    })
  })

  describe('PUT /bot', () => {
    it('repassa bio/avatarUrl pro service e devolve o perfil atualizado', async () => {
      vi.mocked(updateTrikBotProfile).mockResolvedValue({ username: 'Trik', avatarUrl: '/uploads/trik-bot/x.png', bio: 'nova bio' })
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/bot',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { bio: 'nova bio', avatarUrl: '/uploads/trik-bot/x.png' },
      })
      expect(res.statusCode).toBe(200)
      expect(updateTrikBotProfile).toHaveBeenCalledWith({ bio: 'nova bio', avatarUrl: '/uploads/trik-bot/x.png' })
      expect(JSON.parse(res.body).bot.bio).toBe('nova bio')
    })

    it('retorna 503 se o bot não existir', async () => {
      vi.mocked(updateTrikBotProfile).mockResolvedValue(null)
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/bot',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { bio: 'x' },
      })
      expect(res.statusCode).toBe(503)
    })
  })

  describe('POST /bot/avatar', () => {
    const boundary = 'testboundary123'

    it('retorna 400 sem arquivo', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/trik/bot/avatar',
        headers: { Authorization: 'Bearer admin', 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.from(`--${boundary}--\r\n`),
      })
      expect(res.statusCode).toBe(400)
    })

    it('retorna 400 pra mimetype não suportado', async () => {
      const body = multipartBody(boundary, 'evil.svg', 'image/svg+xml', Buffer.from('<svg/>'))
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/trik/bot/avatar',
        headers: { Authorization: 'Bearer admin', 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
      expect(res.statusCode).toBe(400)
      expect(scanBuffer).not.toHaveBeenCalled()
    })

    it('retorna 400 quando o scanBuffer rejeita', async () => {
      vi.mocked(scanBuffer).mockReturnValue({ ok: false, reason: 'Fichier dangereux détecté' })
      const body = multipartBody(boundary, 'avatar.png', 'image/png', Buffer.from('fake-png-bytes'))
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/trik/bot/avatar',
        headers: { Authorization: 'Bearer admin', 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).error).toContain('Fichier dangereux détecté')
    })

    it('aceita um PNG válido e devolve a URL', async () => {
      vi.mocked(scanBuffer).mockReturnValue({ ok: true })
      const body = multipartBody(boundary, 'avatar.png', 'image/png', Buffer.from('fake-png-bytes'))
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/trik/bot/avatar',
        headers: { Authorization: 'Bearer admin', 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).url).toMatch(/^\/uploads\/trik-bot\/.+\.png$/)
    })
  })
})
