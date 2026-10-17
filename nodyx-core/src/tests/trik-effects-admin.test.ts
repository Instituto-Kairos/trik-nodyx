// Módulo RPG (trik) — Fase 3: rotas admin de efeitos, catálogos com efeito,
// listas desbloqueáveis, regiões e semana de jogo (trik_010). Mesmo padrão de
// mocks de trik-admin.test.ts; o foco aqui é a validação do corpo (o zod
// espelha os CHECKs do banco) e a tradução de erro do Postgres em HTTP.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

vi.mock('../config/database', () => ({
  db: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
}))

vi.mock('../models/trik', () => ({
  listPantheons:  vi.fn(),
  createPantheon: vi.fn(),
  createDeity:    vi.fn(),
}))

// Constantes ficam REAIS (os schemas zod usam) — só o que toca o banco é mock.
vi.mock('../models/trikEffects', async () => {
  const actual = await vi.importActual<typeof import('../models/trikEffects')>('../models/trikEffects')
  return {
    ...actual,
    listBonusCatalog:       vi.fn(),
    createBonusCatalogItem: vi.fn(),
    deleteBonusCatalogItem: vi.fn(),
    setBonusCatalogCategory: vi.fn(),
    createEffect:           vi.fn(),
    deleteEffect:           vi.fn(),
    listPantheonEffects:    vi.fn(),
    unlockTrait:            vi.fn(),
    setThreadLocation:      vi.fn(),
    setGameWeek:            vi.fn(),
  }
})

vi.mock('../models/trikSheet', () => ({ getCharacterSheet: vi.fn() }))

vi.mock('../services/trik/weather', () => ({
  syncGameWeek: vi.fn().mockResolvedValue({ weather: [], failed: [], noticeSent: true }),
}))

vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: any, reply: any) => {
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    }
    req.user = { userId: 'admin-uuid', username: 'admin' }
  }),
}))

import * as TrikModel from '../models/trik'
import * as TrikEffects from '../models/trikEffects'
import { trikAdminPlugin } from '../routes/trik'
import { getCharacterSheet } from '../models/trikSheet'

const OWNER = '44444444-4444-4444-8444-444444444444'
const WEAPON = '55555555-5555-4555-8555-555555555555'
const BASE = '/api/v1/admin/trik'

describe('trikAdminPlugin — Fase 3', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(trikAdminPlugin, { prefix: BASE }))
  })

  const send = (method: 'POST' | 'PUT', url: string, payload: unknown) =>
    app.inject({ method, url: BASE + url, headers: { Authorization: 'Bearer admin' }, payload: payload as any })

  describe('POST /effects', () => {
    const post = (payload: object) => send('POST', '/effects', { ownerKind: 'aptitude', ownerId: OWNER, ...payload })

    it('aceita os exemplos do plano e repassa sem ownerKind/ownerId', async () => {
      vi.mocked(TrikEffects.createEffect).mockResolvedValue({ id: 'e1' } as any)
      const valid = [
        { effect: 'reduz_requisito', activity: 'treino', weaponCategory: 'Espadas', value: 1 },
        { effect: 'reduz_requisito', activity: 'treino', weaponId: WEAPON, value: 3 },
        { effect: 'multiplica', conditionKind: 'periodo', conditionValue: 'noite', value: 1.5 },
        { effect: 'multiplica', conditionKind: 'clima', conditionValue: 'chuva', value: 1.25 },
        { effect: 'multiplica', conditionKind: 'companhia', value: 1.8 },
        { effect: 'limite_diario', activity: 'aula', value: 1 },
        { effect: 'anula_alerta', alertKind: 'calor' },
        { effect: 'sensibilidade', alertKind: 'umidade' },
        { effect: 'espelho' },
      ]
      for (const payload of valid) {
        const res = await post(payload)
        expect(res.statusCode, JSON.stringify(payload)).toBe(201)
      }
      expect(TrikEffects.createEffect).toHaveBeenCalledWith('aptitude', OWNER, expect.objectContaining({
        effect: 'reduz_requisito', activity: 'treino', weaponCategory: 'Espadas', value: 1,
      }))
    })

    it('recusa combinações que o banco também recusaria', async () => {
      const invalid = [
        { effect: 'reduz_requisito', activity: 'aula', weaponCategory: 'Espadas', value: 1 }, // arma em aula
        { effect: 'reduz_requisito', activity: 'treino', knowledgeCategory: 'Idiomas', value: 1 }, // matéria em treino
        { effect: 'reduz_requisito', activity: 'treino', weaponId: WEAPON, weaponCategory: 'Espadas', value: 1 }, // 2 alvos
        { effect: 'multiplica' },                                                     // sem valor
        { effect: 'multiplica', value: 0 },                                           // valor não positivo
        { effect: 'anula_alerta' },                                                   // sem tipo de alerta
        { effect: 'anula_alerta', alertKind: 'calor', value: 1 },                     // valor onde não cabe
        { effect: 'multiplica', alertKind: 'calor', value: 2 },                       // alerta fora de efeito de alerta
        { effect: 'multiplica', conditionKind: 'clima', conditionValue: 'garoa', value: 2 }, // garoa não gera bônus
        { effect: 'multiplica', conditionKind: 'periodo', conditionValue: 'tarde', value: 2 },
        { effect: 'multiplica', conditionKind: 'sempre', conditionValue: 'noite', value: 2 },
        { effect: 'voar', value: 2 },
      ]
      for (const payload of invalid) {
        const res = await post(payload)
        expect(res.statusCode, JSON.stringify(payload)).toBe(400)
      }
      expect(TrikEffects.createEffect).not.toHaveBeenCalled()
    })

    it('aceita panteão/divindade e as listas desbloqueáveis como dono', async () => {
      vi.mocked(TrikEffects.createEffect).mockResolvedValue({ id: 'e1' } as any)
      for (const ownerKind of ['pantheon', 'deity', 'peculiarity', 'disorder']) {
        const res = await send('POST', '/effects', { ownerKind, ownerId: OWNER, effect: 'espelho' })
        expect(res.statusCode, ownerKind).toBe(201)
      }
    })

    it('dono inexistente → 404; alvo inexistente ou CHECK do banco → 400', async () => {
      vi.mocked(TrikEffects.createEffect).mockResolvedValueOnce(null)
      expect((await post({ effect: 'espelho' })).statusCode).toBe(404)

      vi.mocked(TrikEffects.createEffect).mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }))
      expect((await post({ effect: 'reduz_requisito', activity: 'treino', weaponId: WEAPON, value: 1 })).statusCode).toBe(400)

      vi.mocked(TrikEffects.createEffect).mockRejectedValueOnce(Object.assign(new Error('check'), { code: '23514' }))
      expect((await post({ effect: 'espelho' })).statusCode).toBe(400)
    })
  })

  describe('/bonus-catalog', () => {
    it('cria item com categoria e devolve 409 quando já existe', async () => {
      vi.mocked(TrikEffects.createBonusCatalogItem)
        .mockResolvedValueOnce({ id: OWNER, name: 'Pele de Cobre', category: 'Físico', effects: [] })
        .mockResolvedValueOnce(null)

      const ok = await send('POST', '/bonus-catalog', { kind: 'peculiarity', name: 'Pele de Cobre', category: 'Físico' })
      expect(ok.statusCode).toBe(201)
      expect(TrikEffects.createBonusCatalogItem).toHaveBeenCalledWith('peculiarity', 'Pele de Cobre', 'Físico')

      const dup = await send('POST', '/bonus-catalog', { kind: 'peculiarity', name: 'Pele de Cobre', category: 'Físico' })
      expect(dup.statusCode).toBe(409)
    })

    it('categoria é obrigatória', async () => {
      for (const category of [undefined, null, '', '   ']) {
        const res = await send('POST', '/bonus-catalog', { kind: 'aptitude', name: 'X', category })
        expect(res.statusCode, String(category)).toBe(400)
      }
      expect(TrikEffects.createBonusCatalogItem).not.toHaveBeenCalled()
    })

    it('PATCH troca a categoria; item inexistente → 404', async () => {
      vi.mocked(TrikEffects.setBonusCatalogCategory).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      const patch = () => app.inject({
        method: 'PATCH', url: `${BASE}/bonus-catalog/${OWNER}`, headers: { Authorization: 'Bearer admin' },
        payload: { kind: 'aptitude', category: 'Mental' },
      })
      expect((await patch()).statusCode).toBe(204)
      expect(TrikEffects.setBonusCatalogCategory).toHaveBeenCalledWith('aptitude', OWNER, 'Mental')
      expect((await patch()).statusCode).toBe(404)
    })

    it('item escolhido por personagem (FK) → 409, não 500', async () => {
      vi.mocked(TrikEffects.deleteBonusCatalogItem).mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }))
      const res = await app.inject({
        method: 'DELETE', url: `${BASE}/bonus-catalog/${OWNER}?kind=aptitude`, headers: { Authorization: 'Bearer admin' },
      })
      expect(res.statusCode).toBe(409)
    })

    it('recusa tipo de lista desconhecido', async () => {
      const res = await send('POST', '/bonus-catalog', { kind: 'bonus', name: 'X' })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('GET /pantheons', () => {
    it('junta os efeitos em cada panteão e divindade', async () => {
      vi.mocked(TrikModel.listPantheons).mockResolvedValue([
        { id: 'p1', name: 'Grego', deities: [{ id: 'd1', name: 'Hefesto' }, { id: 'd2', name: 'Atena' }] },
      ])
      vi.mocked(TrikEffects.listPantheonEffects).mockResolvedValue({
        d1: [{ id: 'e1', effect: 'anula_alerta', alert_kind: 'calor' } as any],
      })

      const res = await app.inject({ method: 'GET', url: `${BASE}/pantheons`, headers: { Authorization: 'Bearer admin' } })

      expect(res.json().pantheons[0]).toMatchObject({
        effects: [],
        deities: [{ id: 'd1', effects: [{ id: 'e1' }] }, { id: 'd2', effects: [] }],
      })
    })
  })

  describe('POST /characters/:id/traits', () => {
    it('desbloqueia (201), repete sem erro (200) e traduz FK em 404', async () => {
      vi.mocked(TrikEffects.unlockTrait)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }))
      const body = { kind: 'peculiarity', itemId: WEAPON }

      expect((await send('POST', `/characters/${OWNER}/traits`, body)).statusCode).toBe(201)
      expect((await send('POST', `/characters/${OWNER}/traits`, body)).statusCode).toBe(200)
      expect((await send('POST', `/characters/${OWNER}/traits`, body)).statusCode).toBe(404)
      expect(TrikEffects.unlockTrait).toHaveBeenCalledWith(OWNER, 'peculiarity', WEAPON, 'admin-uuid')
    })

    it('aptidão não é desbloqueável pelo narrador (vem do /levelup)', async () => {
      const res = await send('POST', `/characters/${OWNER}/traits`, { kind: 'aptitude', itemId: WEAPON })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('PUT /threads/:id/location', () => {
    it('tópico fora de trik_threads → 404', async () => {
      vi.mocked(TrikEffects.setThreadLocation).mockResolvedValue(false)
      const res = await send('PUT', `/threads/${OWNER}/location`, { locationId: null })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('PUT /game-week', () => {
    it('aceita domingo', async () => {
      const res = await send('PUT', '/game-week', { weekStart: '2020-07-26' })
      expect(res.statusCode).toBe(200)
      expect(TrikEffects.setGameWeek).toHaveBeenCalledWith('2020-07-26', 'admin-uuid')
      expect(res.json()).toMatchObject({ weekStart: '2020-07-26', failed: [], noticeSent: true })
    })

    it('recusa dia que não é domingo e formato errado', async () => {
      for (const weekStart of ['2020-07-27', '26/07/2020', '2020-7-26']) {
        const res = await send('PUT', '/game-week', { weekStart })
        expect(res.statusCode, weekStart).toBe(400)
      }
      expect(TrikEffects.setGameWeek).not.toHaveBeenCalled()
    })
  })

  describe('GET /characters/:id/sheet', () => {
    const get = (id: string) => app.inject({ method: 'GET', url: `${BASE}/characters/${id}/sheet`, headers: { Authorization: 'Bearer admin' } })

    it('devolve a ficha; inexistente → 404; id inválido → 400', async () => {
      vi.mocked(getCharacterSheet).mockResolvedValueOnce({ character: { id: OWNER, name: 'Jahzell' } } as any).mockResolvedValueOnce(null)
      expect((await get(OWNER)).json()).toEqual({ sheet: { character: { id: OWNER, name: 'Jahzell' } } })
      expect((await get(OWNER)).statusCode).toBe(404)
      expect((await get('nao-e-uuid')).statusCode).toBe(400)
    })
  })
})
