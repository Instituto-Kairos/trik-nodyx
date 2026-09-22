// Módulo RPG (trik) — rotas admin: auth/validação.
// Ver plans/fase-um.md, seção 5. Mesmo padrão de mocks de admin.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

// vi.mock() é hoisted pro topo do arquivo — as constantes usadas dentro das
// factories precisam vir de vi.hoisted() pra existir nesse momento.
const { COMMUNITY_UUID, CHANNEL_UUID } = vi.hoisted(() => ({
  COMMUNITY_UUID: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  CHANNEL_UUID:   '11111111-1111-4111-8111-111111111111',
}))

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [{ id: COMMUNITY_UUID }], rowCount: 1 }),
  },
}))

vi.mock('../models/channel', () => ({
  listByCommunity: vi.fn().mockResolvedValue([{ id: CHANNEL_UUID, name: 'fichas' }]),
}))

vi.mock('../models/trik', () => ({
  getChannelPurposes: vi.fn().mockResolvedValue([{ channel_id: CHANNEL_UUID, purpose: 'registro' }]),
  setChannelPurposes: vi.fn().mockResolvedValue(undefined),
  isXpThread:         vi.fn(),
  listRegistros:      vi.fn(),
  listXpLevels:       vi.fn(),
  setXpLevels:        vi.fn().mockResolvedValue(undefined),
}))

// MASTERY_KINDS e normalizeCatalogName ficam REAIS (o schema zod da rota
// /catalog usa os dois) — só as funções que tocam o banco são mockadas.
vi.mock('../models/trikMastery', async () => {
  const actual = await vi.importActual<typeof import('../models/trikMastery')>('../models/trikMastery')
  return {
    ...actual,
    listCatalog:        vi.fn(),
    findCatalogByName:  vi.fn(),
    createCatalogEntry: vi.fn(),
    deleteCatalogEntry: vi.fn(),
  }
})

// adminOnly: passa com header Bearer, 403 se conter "notadmin"
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

import * as TrikModel from '../models/trik'
import * as TrikMastery from '../models/trikMastery'
import { trikAdminPlugin } from '../routes/trik'

const WEAPON_UUID = '22222222-2222-4222-8222-222222222222'

describe('trikAdminPlugin', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(trikAdminPlugin, { prefix: '/api/v1/admin/trik' }))
  })

  describe('GET /channels', () => {
    it('retorna 401 sem token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/trik/channels' })
      expect(res.statusCode).toBe(401)
    })

    it('retorna 403 pra quem não é admin', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/channels',
        headers: { Authorization: 'Bearer notadmin' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('retorna canais com os purposes já configurados', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/channels',
        headers: { Authorization: 'Bearer admin' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.channels).toEqual([{ id: CHANNEL_UUID, name: 'fichas', purposes: ['registro'] }])
    })
  })

  describe('GET /registros', () => {
    it('retorna 401 sem token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/trik/registros' })
      expect(res.statusCode).toBe(401)
      expect(TrikModel.listRegistros).not.toHaveBeenCalled()
    })

    it('retorna 403 pra quem não é admin', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/registros',
        headers: { Authorization: 'Bearer notadmin' },
      })
      expect(res.statusCode).toBe(403)
      expect(TrikModel.listRegistros).not.toHaveBeenCalled()
    })

    it('retorna jogadores com seus personagens', async () => {
      const players = [{ id: 'p1', username: 'orfeus', name: 'Orfeu', characters: [{ id: 'c1', name: 'Jahzell', level: 1 }] }]
      vi.mocked(TrikModel.listRegistros).mockResolvedValue(players as any)

      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/registros',
        headers: { Authorization: 'Bearer admin' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ players })
    })
  })

  describe('PUT /channels', () => {
    it('retorna 400 com purpose inválido', async () => {
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/channels',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { entries: [{ channelId: CHANNEL_UUID, purpose: 'invalido' }] },
      })
      expect(res.statusCode).toBe(400)
      expect(TrikModel.setChannelPurposes).not.toHaveBeenCalled()
    })

    it('aceita e repassa os purposes válidos pro model', async () => {
      const entries = [{ channelId: CHANNEL_UUID, purpose: 'registro' }]
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/channels',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { entries },
      })
      expect(res.statusCode).toBe(200)
      expect(TrikModel.setChannelPurposes).toHaveBeenCalledWith(entries, 'admin-uuid')
    })
  })

  describe('GET /threads/:id', () => {
    const THREAD_UUID = '44444444-4444-4444-8444-444444444444'

    it('retorna 401 sem token', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/admin/trik/threads/${THREAD_UUID}` })
      expect(res.statusCode).toBe(401)
    })

    it('devolve o estado de elegibilidade de XP do tópico', async () => {
      vi.mocked(TrikModel.isXpThread).mockResolvedValue(true)
      const res = await app.inject({
        method: 'GET', url: `/api/v1/admin/trik/threads/${THREAD_UUID}`,
        headers: { Authorization: 'Bearer admin' },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ enabled: true })
      expect(TrikModel.isXpThread).toHaveBeenCalledWith(THREAD_UUID)
    })
  })

  describe('GET /xp-levels', () => {
    it('retorna 401 sem token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/trik/xp-levels' })
      expect(res.statusCode).toBe(401)
    })

    it('usa type=character como default e devolve a curva', async () => {
      const levels = [{ type: 'character', level: 1, goal_xp: '500', reward_conduct: 0, reward_principles: 0, reward_preferences: 0, reward_goal: false }]
      vi.mocked(TrikModel.listXpLevels).mockResolvedValue(levels as any)
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/xp-levels',
        headers: { Authorization: 'Bearer admin' },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ levels })
      expect(TrikModel.listXpLevels).toHaveBeenCalledWith('character')
    })

    it('rejeita type desconhecido', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/xp-levels?type=foo',
        headers: { Authorization: 'Bearer admin' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('aceita type=knowledge e type=weapon (curvas da Fase 3, sem lógica de aplicação ainda)', async () => {
      vi.mocked(TrikModel.listXpLevels).mockResolvedValue([])
      for (const type of ['knowledge', 'weapon']) {
        const res = await app.inject({
          method: 'GET', url: `/api/v1/admin/trik/xp-levels?type=${type}`,
          headers: { Authorization: 'Bearer admin' },
        })
        expect(res.statusCode).toBe(200)
        expect(TrikModel.listXpLevels).toHaveBeenCalledWith(type)
      }
    })
  })

  describe('PUT /xp-levels', () => {
    const validLevels = [
      { level: 1, goalXp: 500, rewardConduct: 1, rewardPrinciples: 0, rewardPreferences: 0, rewardGoal: false },
      { level: 2, goalXp: 800, rewardConduct: 0, rewardPrinciples: 1, rewardPreferences: 1, rewardGoal: true },
    ]

    it('retorna 400 com goalXp inválido (zero ou negativo)', async () => {
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/xp-levels',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { type: 'character', levels: [{ level: 1, goalXp: 0 }] },
      })
      expect(res.statusCode).toBe(400)
      expect(TrikModel.setXpLevels).not.toHaveBeenCalled()
    })

    it('retorna 400 com nível repetido na curva', async () => {
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/xp-levels',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { type: 'character', levels: [{ level: 1, goalXp: 500 }, { level: 1, goalXp: 900 }] },
      })
      expect(res.statusCode).toBe(400)
      expect(TrikModel.setXpLevels).not.toHaveBeenCalled()
    })

    it('aceita e repassa a curva válida pro model', async () => {
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/xp-levels',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { type: 'character', levels: validLevels },
      })
      expect(res.statusCode).toBe(200)
      expect(TrikModel.setXpLevels).toHaveBeenCalledWith('character', validLevels)
    })

    it('aplica default 0/false nos campos de reward omitidos', async () => {
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/xp-levels',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { type: 'character', levels: [{ level: 1, goalXp: 500 }] },
      })
      expect(res.statusCode).toBe(200)
      expect(TrikModel.setXpLevels).toHaveBeenCalledWith('character', [
        { level: 1, goalXp: 500, rewardConduct: 0, rewardPrinciples: 0, rewardPreferences: 0, rewardGoal: false },
      ])
    })

    it('retorna 400 pra type fora de character/knowledge/weapon', async () => {
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/xp-levels',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { type: 'foo', levels: [{ level: 1, goalXp: 500 }] },
      })
      expect(res.statusCode).toBe(400)
      expect(TrikModel.setXpLevels).not.toHaveBeenCalled()
    })

    it('aceita curva de knowledge (aulas) e weapon (maestria)', async () => {
      for (const type of ['knowledge', 'weapon']) {
        const res = await app.inject({
          method: 'PUT', url: '/api/v1/admin/trik/xp-levels',
          headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
          payload: { type, levels: [{ level: 1, goalXp: 300 }] },
        })
        expect(res.statusCode).toBe(200)
        expect(TrikModel.setXpLevels).toHaveBeenCalledWith(type, [
          { level: 1, goalXp: 300, rewardConduct: 0, rewardPrinciples: 0, rewardPreferences: 0, rewardGoal: false },
        ])
      }
    })

    it('repassa reqMastery (weapon) e reqEducation (knowledge) pro model', async () => {
      const weapon = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/xp-levels',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { type: 'weapon', levels: [{ level: 1, goalXp: 1, reqMastery: 5 }, { level: 2, goalXp: 1, reqMastery: 8 }] },
      })
      expect(weapon.statusCode).toBe(200)
      expect(TrikModel.setXpLevels).toHaveBeenLastCalledWith('weapon', [
        { level: 1, goalXp: 1, rewardConduct: 0, rewardPrinciples: 0, rewardPreferences: 0, rewardGoal: false, reqMastery: 5 },
        { level: 2, goalXp: 1, rewardConduct: 0, rewardPrinciples: 0, rewardPreferences: 0, rewardGoal: false, reqMastery: 8 },
      ])

      const knowledge = await app.inject({
        method: 'PUT', url: '/api/v1/admin/trik/xp-levels',
        headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
        payload: { type: 'knowledge', levels: [{ level: 1, goalXp: 1, reqEducation: 6 }] },
      })
      expect(knowledge.statusCode).toBe(200)
      expect(TrikModel.setXpLevels).toHaveBeenLastCalledWith('knowledge', [
        { level: 1, goalXp: 1, rewardConduct: 0, rewardPrinciples: 0, rewardPreferences: 0, rewardGoal: false, reqEducation: 6 },
      ])
    })

    it('retorna 400 com reqMastery negativo ou acima do SMALLINT', async () => {
      for (const reqMastery of [-1, 32768]) {
        const res = await app.inject({
          method: 'PUT', url: '/api/v1/admin/trik/xp-levels',
          headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
          payload: { type: 'weapon', levels: [{ level: 1, goalXp: 1, reqMastery }] },
        })
        expect(res.statusCode).toBe(400)
      }
      expect(TrikModel.setXpLevels).not.toHaveBeenCalled()
    })
  })

  // ── Catálogo de armas (#treino) / matérias (#aula) ────────────────────────
  // Os dois tipos passam pelas mesmas rotas (`type=weapon|knowledge`).

  const KINDS = ['weapon', 'knowledge'] as const

  describe('GET /catalog', () => {
    it('retorna 401 sem token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/trik/catalog?type=weapon' })
      expect(res.statusCode).toBe(401)
    })

    it('retorna 403 pra não-admin', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/trik/catalog?type=weapon',
        headers: { Authorization: 'Bearer notadmin' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('retorna 400 sem type ou com type inválido', async () => {
      for (const url of ['/api/v1/admin/trik/catalog', '/api/v1/admin/trik/catalog?type=foo']) {
        const res = await app.inject({ method: 'GET', url, headers: { Authorization: 'Bearer admin' } })
        expect(res.statusCode).toBe(400)
      }
    })

    it.each(KINDS)('lista o catálogo de type=%s', async (kind) => {
      vi.mocked(TrikMastery.listCatalog).mockResolvedValue([{ id: WEAPON_UUID, name: 'Item' }])

      const res = await app.inject({
        method: 'GET', url: `/api/v1/admin/trik/catalog?type=${kind}`, headers: { Authorization: 'Bearer admin' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ entries: [{ id: WEAPON_UUID, name: 'Item' }] })
      expect(TrikMastery.listCatalog).toHaveBeenCalledWith(kind)
    })
  })

  describe('POST /catalog', () => {
    const post = (payload: unknown, auth = 'Bearer admin') => app.inject({
      method: 'POST', url: '/api/v1/admin/trik/catalog',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      payload: payload as any,
    })

    it('retorna 403 pra não-admin', async () => {
      expect((await post({ type: 'weapon', name: 'Espada', category: 'Espadas' }, 'Bearer notadmin')).statusCode).toBe(403)
      expect(TrikMastery.createCatalogEntry).not.toHaveBeenCalled()
    })

    it('retorna 400 com type inválido, nome vazio/longo demais ou só de símbolos', async () => {
      for (const payload of [
        { type: 'foo', name: 'Espada', category: 'Espadas' },
        { type: 'weapon', name: '', category: 'Espadas' },
        { type: 'weapon', name: '   ', category: 'Espadas' },
        { type: 'weapon', name: 'x'.repeat(61), category: 'Espadas' },
        { type: 'weapon', name: '!!!', category: 'Espadas' }, // normaliza pra vazio: nunca casaria com hashtag
      ]) {
        expect((await post(payload)).statusCode).toBe(400)
      }
      expect(TrikMastery.createCatalogEntry).not.toHaveBeenCalled()
    })

    it('arma sem categoria (ausente, vazia, só símbolos ou longa demais) → 400', async () => {
      for (const category of [undefined, '', '   ', '!!!', 'x'.repeat(61)]) {
        const res = await post({ type: 'weapon', name: 'Espada Longa', category })
        expect(res.statusCode).toBe(400)
      }
      expect(TrikMastery.createCatalogEntry).not.toHaveBeenCalled()
    })

    it('cria arma nova → 201 com a categoria (trim aplicado)', async () => {
      vi.mocked(TrikMastery.findCatalogByName).mockResolvedValue(null)
      vi.mocked(TrikMastery.createCatalogEntry).mockResolvedValue({ id: WEAPON_UUID, name: 'Espada Longa', category: 'Espadas' })

      const res = await post({ type: 'weapon', name: '  Espada Longa ', category: ' Espadas ' })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toEqual({ entry: { id: WEAPON_UUID, name: 'Espada Longa', category: 'Espadas' } })
      expect(TrikMastery.findCatalogByName).toHaveBeenCalledWith('weapon', 'Espada Longa')
      expect(TrikMastery.createCatalogEntry).toHaveBeenCalledWith('weapon', 'Espada Longa', 'Espadas')
    })

    it('cria matéria nova → 201, sem categoria (mesmo que venha no corpo)', async () => {
      vi.mocked(TrikMastery.findCatalogByName).mockResolvedValue(null)
      vi.mocked(TrikMastery.createCatalogEntry).mockResolvedValue({ id: WEAPON_UUID, name: 'História' })

      const res = await post({ type: 'knowledge', name: '  História ', category: 'ignorada' })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toEqual({ entry: { id: WEAPON_UUID, name: 'História' } })
      expect(TrikMastery.findCatalogByName).toHaveBeenCalledWith('knowledge', 'História')
      expect(TrikMastery.createCatalogEntry).toHaveBeenCalledWith('knowledge', 'História')
    })

    it('retorna 409 DUPLICATE_NAME quando já existe (mesmo padrão do /registro)', async () => {
      vi.mocked(TrikMastery.findCatalogByName).mockResolvedValue({ id: WEAPON_UUID, name: 'Espada Longa' })

      const res = await post({ type: 'weapon', name: 'espada longa', category: 'Espadas' })

      expect(res.statusCode).toBe(409)
      expect(res.json().code).toBe('DUPLICATE_NAME')
      expect(res.json().error).toContain('Espada Longa')
      expect(TrikMastery.createCatalogEntry).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /catalog/:id', () => {
    const del = (id: string, query: string, auth = 'Bearer admin') => app.inject({
      method: 'DELETE', url: `/api/v1/admin/trik/catalog/${id}${query}`,
      headers: { Authorization: auth },
    })

    it('retorna 403 pra não-admin', async () => {
      expect((await del(WEAPON_UUID, '?type=weapon', 'Bearer notadmin')).statusCode).toBe(403)
      expect(TrikMastery.deleteCatalogEntry).not.toHaveBeenCalled()
    })

    it('retorna 400 com id que não é UUID ou type ausente/inválido', async () => {
      expect((await del('nao-e-uuid', '?type=weapon')).statusCode).toBe(400)
      expect((await del(WEAPON_UUID, '')).statusCode).toBe(400)
      expect((await del(WEAPON_UUID, '?type=foo')).statusCode).toBe(400)
      expect(TrikMastery.deleteCatalogEntry).not.toHaveBeenCalled()
    })

    it.each(KINDS)('remove item de type=%s → 204', async (kind) => {
      vi.mocked(TrikMastery.deleteCatalogEntry).mockResolvedValue(true)

      const res = await del(WEAPON_UUID, `?type=${kind}`)

      expect(res.statusCode).toBe(204)
      expect(TrikMastery.deleteCatalogEntry).toHaveBeenCalledWith(kind, WEAPON_UUID)
    })

    it('retorna 404 quando o id não existe', async () => {
      vi.mocked(TrikMastery.deleteCatalogEntry).mockResolvedValue(false)
      const res = await del(WEAPON_UUID, '?type=weapon')
      expect(res.statusCode).toBe(404)
      expect(res.json().code).toBe('NOT_FOUND')
    })
  })
})
