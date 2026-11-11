// Módulo RPG (trik) — models/trikSummary.ts: resumo dos personagens pro widget da home.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockTrik } = vi.hoisted(() => ({
  mockDb:   { query: vi.fn() },
  mockTrik: { getPlayer: vi.fn(), getCharactersByPlayer: vi.fn() },
}))
vi.mock('../config/database', () => ({ db: mockDb }))
vi.mock('../models/trik', () => mockTrik)

import { getPlayerSummary, AVG_SCENES } from '../models/trikSummary'

function setupDb(opts: { progress?: Record<string, unknown> | null; avg?: { n: number; avg: number | null }; level?: Record<string, unknown> | null }) {
  mockDb.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM trik_character_progress')) return { rows: opts.progress ? [opts.progress] : [] }
    if (sql.includes('FROM trik_scene_awards')) return { rows: [opts.avg ?? { n: 0, avg: null }] }
    if (sql.includes('trik_character_weapon_progress p'))    return { rows: [{ name: 'Espada', category: 'Espadas', level: 2, progress: 3.5, required: 8 }] }
    if (sql.includes('trik_character_knowledge_progress p')) return { rows: [] }
    if (sql.includes("pr.type = 'character'")) return { rows: opts.level ? [opts.level] : [] }
    return { rows: [] }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTrik.getPlayer.mockResolvedValue({ id: 'u1' })
  mockTrik.getCharactersByPlayer.mockResolvedValue([{ id: 'c1', name: 'Kaelen' }])
})

describe('getPlayerSummary', () => {
  it('jogador sem /registro: lista vazia', async () => {
    mockTrik.getPlayer.mockResolvedValue(null)
    expect(await getPlayerSummary('u1')).toEqual([])
    expect(mockDb.query).not.toHaveBeenCalled()
  })

  it('personagem novo (sem progresso nem cenas): nível 1, xp 0, média null', async () => {
    setupDb({ progress: null, level: { goal_xp: '500', req_weapon_level: 0, req_knowledge_level: 0, best_weapon: 0, knowledge_level: 0 } })
    const [c] = await getPlayerSummary('u1')
    expect(c).toMatchObject({ name: 'Kaelen', level: 1, progressXp: 0, goalXp: 500, avgSceneXp: null, sceneCount: 0, unspent: [], requirements: [] })
  })

  it('média das últimas cenas, maestria com requisito e pontos não gastos', async () => {
    setupDb({
      progress: { level: 3, progress_xp: '152', points_conduct: 2, spent_conduct: 1, points_principles: 1, spent_principles: 1 },
      avg: { n: 5, avg: 85.04 },
      level: { goal_xp: '1500', req_weapon_level: 0, req_knowledge_level: 0, best_weapon: 2, knowledge_level: 0 },
    })
    const [c] = await getPlayerSummary('u1')
    expect(c).toMatchObject({ level: 3, progressXp: 152, goalXp: 1500, avgSceneXp: 85, sceneCount: 5 })
    expect(c.weapons).toEqual([{ name: 'Espada', category: 'Espadas', level: 2, progress: 3.5, required: 8 }])
    expect(c.unspent).toEqual([{ label: 'Conduta', count: 1 }]) // princípios 1-1 = 0 some
    const avgSql = mockDb.query.mock.calls.map(c => c[0] as string).find(s => s.includes('FROM trik_scene_awards'))!
    expect(avgSql).toContain(`LIMIT ${AVG_SCENES}`)
    expect(avgSql).toContain('mastery_kind IS NULL') // só cenas normais, sem #treino/#aula
  })

  it('requisitos do nível: marca cumprido e não cumprido', async () => {
    setupDb({
      progress: { level: 2, progress_xp: '900' },
      level: { goal_xp: '1000', req_weapon_level: 3, req_knowledge_level: 2, knowledge_name: 'Alquimia', best_weapon: 3, knowledge_level: 1 },
    })
    const [c] = await getPlayerSummary('u1')
    expect(c.requirements).toEqual([
      { label: 'Maestria nível 3 em qualquer arma', met: true },
      { label: 'Alquimia nível 2', met: false },
    ])
  })
})
