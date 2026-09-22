// Módulo RPG (trik) — trikPlayerPlugin: rotas /api/v1/trik (requireAuth).
// Segunda parte dos testes da Fase 1 — complementa trik-registro.test.ts
// (validação pura) e trik-plaquinha.test.ts (ownership, nível de serviço)
// com a camada HTTP: gate de canal, códigos de erro, e o aviso postado
// pelo bot Trik após um registro/plaquinha bem-sucedido.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

const { USER_ID, CHANNEL_UUID, CHARACTER_UUID } = vi.hoisted(() => ({
  USER_ID:        'user-uuid',
  CHANNEL_UUID:   '11111111-1111-4111-8111-111111111111',
  CHARACTER_UUID: '22222222-2222-4222-8222-222222222222',
}))

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
}))

// requireAuth: mesmo padrão de mock usado pro adminOnly em trik-admin.test.ts
// — passa com header Bearer, 401 sem token.
vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn(async (req: any, reply: any) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    }
    req.user = { userId: USER_ID, username: 'ada' }
  }),
}))

// adminOnly (usado só no /teste): mesmo mock de trik-admin.test.ts — passa com Bearer,
// 403 se o token contiver "notadmin".
vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: any, reply: any) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    }
    if (header.includes('notadmin')) {
      return reply.code(403).send({ error: 'Admin access required', code: 'FORBIDDEN' })
    }
    req.user = { userId: USER_ID, username: 'ada' }
  }),
}))

vi.mock('../models/trik', () => ({
  isChannelPurpose:    vi.fn(),
  getOrCreateProgress: vi.fn(),
  getCharacterBonuses: vi.fn(),
  listPreferences:     vi.fn().mockResolvedValue([]),
  listGoals:           vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/trik/registro', () => ({
  getPlayerAndCharacters: vi.fn(),
  submitRegistro: vi.fn(),
}))

vi.mock('../services/trik/registro/plaquinha', () => ({
  submitPlaquinha: vi.fn(),
}))

vi.mock('../services/trik/xp/levelup', () => ({
  submitLevelup: vi.fn(),
}))

vi.mock('../services/trik/bot', () => ({
  postTrikMessage:    vi.fn().mockResolvedValue(undefined),
  getTrikBotProfile:  vi.fn(),
  updateTrikBotProfile: vi.fn(),
}))

import * as TrikModel from '../models/trik'
import { getPlayerAndCharacters, submitRegistro } from '../services/trik/registro'
import { submitPlaquinha } from '../services/trik/registro/plaquinha'
import { submitLevelup } from '../services/trik/xp/levelup'
import { postTrikMessage, getTrikBotProfile } from '../services/trik/bot'
import { trikPlayerPlugin } from '../routes/trik'

function character(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Personagem Teste',
    fichaLink: 'https://example.com/ficha',
    principlesPicked: ['mente', 'corpo'],
    conductPicked: ['presenca'],
    ...overrides,
  }
}

describe('trikPlayerPlugin', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(trikPlayerPlugin, { prefix: '/api/v1/trik' }))
  })

  describe('GET /bot', () => {
    it('retorna 401 sem token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/trik/bot' })
      expect(res.statusCode).toBe(401)
    })

    it('retorna o perfil do bot pra qualquer membro logado', async () => {
      vi.mocked(getTrikBotProfile).mockResolvedValue({ username: 'Trik', avatarUrl: null, bio: 'oi' })
      const res = await app.inject({
        method: 'GET', url: '/api/v1/trik/bot',
        headers: { Authorization: 'Bearer ada' },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ bot: { username: 'Trik', avatarUrl: null, bio: 'oi' } })
    })

    it('retorna 503 se o bot não existir', async () => {
      vi.mocked(getTrikBotProfile).mockResolvedValue(null)
      const res = await app.inject({
        method: 'GET', url: '/api/v1/trik/bot',
        headers: { Authorization: 'Bearer ada' },
      })
      expect(res.statusCode).toBe(503)
    })
  })

  describe('POST /teste', () => {
    it('retorna 403 pra quem não é admin — o bot não posta em canal nenhum', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/teste',
        headers: { Authorization: 'Bearer notadmin', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID },
      })
      expect(res.statusCode).toBe(403)
      expect(postTrikMessage).not.toHaveBeenCalled()
    })

    it('retorna 400 com channelId inválido', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/teste',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: 'não-é-uuid' },
      })
      expect(res.statusCode).toBe(400)
      expect(postTrikMessage).not.toHaveBeenCalled()
    })

    it('posta a menção via bot Trik', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/teste',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID },
      })
      expect(res.statusCode).toBe(200)
      expect(postTrikMessage).toHaveBeenCalledWith(CHANNEL_UUID, expect.stringContaining('@ada'))
    })
  })

  describe('GET /players/me e GET /characters/mine', () => {
    it('devolve player e characters do service', async () => {
      vi.mocked(getPlayerAndCharacters).mockResolvedValue({ player: null, characters: [] })
      const res = await app.inject({
        method: 'GET', url: '/api/v1/trik/players/me',
        headers: { Authorization: 'Bearer ada' },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ player: null, characters: [] })
      expect(getPlayerAndCharacters).toHaveBeenCalledWith(USER_ID)
    })

    it('characters/mine devolve só a lista', async () => {
      const chars = [{ id: CHARACTER_UUID, name: 'Foo' }]
      vi.mocked(getPlayerAndCharacters).mockResolvedValue({ player: { id: 'p1' } as any, characters: chars as any })
      const res = await app.inject({
        method: 'GET', url: '/api/v1/trik/characters/mine',
        headers: { Authorization: 'Bearer ada' },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ characters: chars })
    })
  })

  describe('POST /registro', () => {
    it('retorna 403 se o canal não estiver configurado pra registro', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(false)
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/registro',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID, character: character() },
      })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.body).code).toBe('FORBIDDEN_CHANNEL')
      expect(submitRegistro).not.toHaveBeenCalled()
    })

    it('retorna 400 quando o service rejeita por validação', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      vi.mocked(submitRegistro).mockResolvedValue({ ok: false, code: 'VALIDATION', message: 'escolha 2 principles' })
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/registro',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID, character: character() },
      })
      expect(res.statusCode).toBe(400)
      expect(postTrikMessage).not.toHaveBeenCalled()
    })

    it('retorna 409 em nome duplicado', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      vi.mocked(submitRegistro).mockResolvedValue({ ok: false, code: 'DUPLICATE_NAME', message: 'já existe' })
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/registro',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID, character: character() },
      })
      expect(res.statusCode).toBe(409)
    })

    // z.string().url() aceita qualquer esquema (javascript:, data:…); o link vira <a href>
    // na tela admin de registros, então só http(s) passa.
    it.each([
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://exemplo.test/ficha',
    ])('retorna 400 quando o link da ficha não é http(s): %s', async (fichaLink) => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/registro',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID, character: character({ fichaLink }) },
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).error).toContain('http')
      expect(submitRegistro).not.toHaveBeenCalled()
    })

    it.each(['https://docs.google.com/document/d/abc/edit', 'http://exemplo.test/ficha', 'HTTPS://EXEMPLO.TEST/FICHA'])(
      'aceita o link da ficha http(s): %s',
      async (fichaLink) => {
        vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
        vi.mocked(submitRegistro).mockResolvedValue({ ok: true, player: { id: 'p1' } as any, character: { id: CHARACTER_UUID, name: 'X' } as any })
        const res = await app.inject({
          method: 'POST', url: '/api/v1/trik/registro',
          headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
          payload: { channelId: CHANNEL_UUID, character: character({ fichaLink }) },
        })
        expect(res.statusCode).toBe(201)
      }
    )

    it('escapa o nome do personagem na confirmação (sem HTML nem @menção em massa) e mantém a menção ao autor', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      vi.mocked(submitRegistro).mockResolvedValue({
        ok: true, player: { id: 'p1' } as any,
        character: { id: CHARACTER_UUID, name: '<a href="https://phish.test">@admin @alice</a>' } as any,
      })

      await app.inject({
        method: 'POST', url: '/api/v1/trik/registro',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID, character: character() },
      })

      const message = vi.mocked(postTrikMessage).mock.calls[0][1]
      expect(message).not.toContain('<a href')
      expect(message).toContain('&lt;a href=')
      expect(message).not.toMatch(/@admin|@alice/)
      expect(message).toContain('@​admin')
      expect(message).toContain('por @ada.') // a menção intencional ao autor continua valendo
    })

    it('retorna 201 e posta a confirmação no canal', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      const player = { id: 'p1' } as any
      const created = { id: CHARACTER_UUID, name: 'Personagem Teste' } as any
      vi.mocked(submitRegistro).mockResolvedValue({ ok: true, player, character: created })

      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/registro',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID, character: character() },
      })
      expect(res.statusCode).toBe(201)
      expect(JSON.parse(res.body)).toEqual({ player, character: created })
      expect(postTrikMessage).toHaveBeenCalledWith(
        CHANNEL_UUID,
        expect.stringContaining('Personagem Teste')
      )
    })
  })

  describe('POST /plaquinha', () => {
    const payload = {
      channelId: CHANNEL_UUID,
      characterId: CHARACTER_UUID,
      templateName: 'Nome',
      templateSignature: 'Assinatura',
    }

    it('retorna 403 se o canal não estiver configurado pra plaquinha', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(false)
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/plaquinha',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload,
      })
      expect(res.statusCode).toBe(403)
      expect(submitPlaquinha).not.toHaveBeenCalled()
    })

    it('retorna 404 quando o personagem não existe', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      vi.mocked(submitPlaquinha).mockResolvedValue({ ok: false, code: 'NOT_FOUND', message: 'não encontrado' })
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/plaquinha',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload,
      })
      expect(res.statusCode).toBe(404)
    })

    it('retorna 403 quando o personagem não pertence ao jogador', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      vi.mocked(submitPlaquinha).mockResolvedValue({ ok: false, code: 'FORBIDDEN', message: 'não é seu' })
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/plaquinha',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload,
      })
      expect(res.statusCode).toBe(403)
    })

    it('escapa nome do personagem e da plaquinha na confirmação, e usa <strong> (não **markdown**)', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      vi.mocked(submitPlaquinha).mockResolvedValue({
        ok: true,
        character: { id: CHARACTER_UUID, name: '@todos', template_name: '<img src=x onerror=alert(1)>' } as any,
      })

      await app.inject({
        method: 'POST', url: '/api/v1/trik/plaquinha',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload,
      })

      const message = vi.mocked(postTrikMessage).mock.calls[0][1]
      expect(message).toContain('<strong>@​todos</strong>')
      expect(message).not.toContain('**')
      expect(message).not.toContain('<img')
      expect(message).toContain('&lt;img src=x onerror=alert(1)&gt;')
    })

    it('retorna 200 e posta a confirmação no canal', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      const updated = { id: CHARACTER_UUID, name: 'Personagem Teste', template_name: 'Nome' } as any
      vi.mocked(submitPlaquinha).mockResolvedValue({ ok: true, character: updated })

      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/plaquinha',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload,
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ character: updated })
      expect(postTrikMessage).toHaveBeenCalledWith(CHANNEL_UUID, expect.stringContaining('Nome'))
    })
  })

  describe('GET /levelup/state', () => {
    function progress(overrides: Record<string, unknown> = {}) {
      return {
        character_id: CHARACTER_UUID, level: 1, progress_xp: 0,
        points_conduct: 0, points_principles: 0, points_preferences: 0,
        spent_conduct: 0, spent_principles: 0, spent_preferences: 0,
        has_goal: false, updated_at: '',
        ...overrides,
      }
    }

    it('filtra personagens sem pontos disponíveis e sem objetivo pendente', async () => {
      vi.mocked(getPlayerAndCharacters).mockResolvedValue({
        player: { id: 'p1' } as any,
        characters: [{ id: CHARACTER_UUID, name: 'Foo' }] as any,
      })
      vi.mocked(TrikModel.getOrCreateProgress).mockResolvedValue(progress() as any)
      vi.mocked(TrikModel.getCharacterBonuses).mockResolvedValue(null)

      const res = await app.inject({
        method: 'GET', url: '/api/v1/trik/levelup/state',
        headers: { Authorization: 'Bearer ada' },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).characters).toEqual([])
    })

    it('inclui personagem com pontos de conduct disponíveis', async () => {
      vi.mocked(getPlayerAndCharacters).mockResolvedValue({
        player: { id: 'p1' } as any,
        characters: [{ id: CHARACTER_UUID, name: 'Foo' }] as any,
      })
      vi.mocked(TrikModel.getOrCreateProgress).mockResolvedValue(progress({ points_conduct: 1 }) as any)
      vi.mocked(TrikModel.getCharacterBonuses).mockResolvedValue(null)

      const res = await app.inject({
        method: 'GET', url: '/api/v1/trik/levelup/state',
        headers: { Authorization: 'Bearer ada' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.characters).toHaveLength(1)
      expect(body.characters[0].available).toEqual({ conduct: 1, principles: 0, preferences: 0 })
    })

    it('inclui personagem com objetivo desbloqueado e ainda não escolhido', async () => {
      vi.mocked(getPlayerAndCharacters).mockResolvedValue({
        player: { id: 'p1' } as any,
        characters: [{ id: CHARACTER_UUID, name: 'Foo' }] as any,
      })
      vi.mocked(TrikModel.getOrCreateProgress).mockResolvedValue(progress({ has_goal: true }) as any)
      vi.mocked(TrikModel.getCharacterBonuses).mockResolvedValue(null)

      const res = await app.inject({
        method: 'GET', url: '/api/v1/trik/levelup/state',
        headers: { Authorization: 'Bearer ada' },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).characters).toHaveLength(1)
    })
  })

  describe('POST /levelup', () => {
    const deltas = {
      conductPresenca: 1, conductProposito: 0, conductSangue: 0,
      principlesMente: 0, principlesCoracao: 0, principlesCorpo: 0,
    }

    it('retorna 403 se o canal não estiver configurado pra levelup', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(false)
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/levelup',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID, characterId: CHARACTER_UUID, deltas },
      })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.body).code).toBe('FORBIDDEN_CHANNEL')
      expect(submitLevelup).not.toHaveBeenCalled()
    })

    it('retorna 404 quando o service não encontra o personagem', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      vi.mocked(submitLevelup).mockResolvedValue({ ok: false, code: 'NOT_FOUND', message: 'não encontrado' })
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/levelup',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID, characterId: CHARACTER_UUID, deltas },
      })
      expect(res.statusCode).toBe(404)
    })

    it('retorna 400 quando o service rejeita por validação (pontos insuficientes)', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      vi.mocked(submitLevelup).mockResolvedValue({ ok: false, code: 'VALIDATION', message: 'Pontos insuficientes' })
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/levelup',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: { channelId: CHANNEL_UUID, characterId: CHARACTER_UUID, deltas },
      })
      expect(res.statusCode).toBe(400)
    })

    it('retorna 200 e repassa o resultado do service', async () => {
      vi.mocked(TrikModel.isChannelPurpose).mockResolvedValue(true)
      const updated = { id: CHARACTER_UUID, conduct_presenca: 1 }
      vi.mocked(submitLevelup).mockResolvedValue({ ok: true, character: updated as any })
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trik/levelup',
        headers: { Authorization: 'Bearer ada', 'Content-Type': 'application/json' },
        payload: {
          channelId: CHANNEL_UUID, characterId: CHARACTER_UUID, deltas,
          preferenceId: '33333333-3333-4333-8333-333333333333',
        },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ character: updated })
      expect(submitLevelup).toHaveBeenCalledWith(USER_ID, {
        channelId: CHANNEL_UUID, characterId: CHARACTER_UUID, deltas,
        preferenceId: '33333333-3333-4333-8333-333333333333',
      })
    })
  })
})
