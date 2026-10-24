// Módulo RPG (trik) — interesses (trik_012, plano §6.5): efeito sintético no
// motor e as regras de setCharacterInterest. Só o `db` é mockado.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({ mockDb: { query: vi.fn() } }))
vi.mock('../config/database', () => ({ db: mockDb }))

import { interestEffects, setCharacterInterest, type CharacterInterest } from '../models/trikInterests'
import { computeTraining, type SceneContext } from '../services/trik/xp/bonusEngine'

const ctx = (p: Partial<SceneContext> = {}): SceneContext => ({
  activity: 'treino', target: { id: 'w1', category: 'Espadas' }, cenaLength: 1500,
  usedRawToday: 0, climate: null, period: null, hasCompanion: false, alerts: [], ...p,
})

const interest = (p: Partial<CharacterInterest>): CharacterInterest => ({
  slot: 'primario', kind: 'weapon', category: 'Espadas', chosen_at: '', locked: false, ...p,
})

describe('interestEffects no motor', () => {
  it('primário −2 e secundário −1, somando com outras reduções', () => {
    const own = interestEffects([
      interest({}),
      interest({ slot: 'secundario', kind: 'knowledge', category: 'Idiomas' }),
    ])
    expect(computeTraining(own, [], ctx()).reqReduction).toBe(2)
    expect(computeTraining(own, [], ctx({ activity: 'aula', target: { id: 'k1', category: 'idiomas' } })).reqReduction).toBe(1)
  })

  it('categoria diferente não vale; id identifica slot e categoria', () => {
    const own = interestEffects([interest({ category: 'Lanças' })])
    const r = computeTraining(own, [], ctx())
    expect(r.reqReduction).toBe(0)
    expect(own[0].id).toBe('interesse:primario:Lanças')
  })
})

describe('setCharacterInterest', () => {
  /** Respostas em ordem: progresso, categorias, slot atual, upsert. */
  function setup(opts: { points?: number; current?: any; upsert?: any[] | Error }) {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('trik_character_progress')) return { rows: [{ points: opts.points ?? 1 }] }
      if (sql.includes('DISTINCT category')) return { rows: [{ category: 'Espadas' }, { category: 'Lanças' }] }
      if (sql.startsWith('SELECT kind')) return { rows: opts.current ? [opts.current] : [] }
      if (sql.includes('INSERT')) {
        if (opts.upsert instanceof Error) throw opts.upsert
        return { rows: opts.upsert ?? [{ chosen_at: 'agora' }] }
      }
      return { rows: [] }
    })
  }

  beforeEach(() => { mockDb.query.mockReset() })

  it('slot não liberado', async () => {
    setup({ points: 0 })
    expect(await setCharacterInterest('c', 'primario', 'weapon', 'Espadas')).toEqual({ ok: false, code: 'LOCKED_SLOT' })
  })

  it('categoria fora do catálogo', async () => {
    setup({})
    expect(await setCharacterInterest('c', 'primario', 'weapon', 'Arcos')).toEqual({ ok: false, code: 'UNKNOWN_CATEGORY' })
  })

  it('grava com a grafia do catálogo', async () => {
    setup({})
    const r = await setCharacterInterest('c', 'primario', 'weapon', 'espadas')
    expect(r).toMatchObject({ ok: true, interest: { category: 'Espadas' } })
  })

  it('mesma escolha atual', async () => {
    setup({ current: { kind: 'weapon', category: 'Espadas' } })
    expect(await setCharacterInterest('c', 'primario', 'weapon', 'ESPADAS')).toEqual({ ok: false, code: 'UNCHANGED' })
  })

  it('já trocou nesta semana (upsert não devolve linha)', async () => {
    setup({ current: { kind: 'weapon', category: 'Lanças' }, upsert: [] })
    expect(await setCharacterInterest('c', 'primario', 'weapon', 'Espadas')).toEqual({ ok: false, code: 'WEEKLY_LIMIT' })
  })

  it('categoria já usada no outro slot', async () => {
    setup({ upsert: Object.assign(new Error('dup'), { code: '23505' }) })
    expect(await setCharacterInterest('c', 'secundario', 'weapon', 'Espadas')).toEqual({ ok: false, code: 'DUPLICATE' })
  })
})
