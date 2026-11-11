// Módulo RPG (trik) — vínculos divinos secundário/terciário (trik_024):
// escala dos efeitos de panteão/divindade por peso do vínculo.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({ mockDb: { query: vi.fn() } }))
vi.mock('../config/database', () => ({ db: mockDb }))
vi.mock('../models/trikInterests', () => ({
  listCharacterInterests: vi.fn().mockResolvedValue({}),
  interestEffects: vi.fn(() => []),
}))

import { scaleBondEffect, listCharacterEffects, type TrikEffect } from '../models/trikEffects'

const fx = (effect: string, value: string | null, id = effect): TrikEffect => ({
  id, effect: effect as TrikEffect['effect'], activity: 'todas', weapon_id: null, knowledge_id: null,
  weapon_category: null, knowledge_category: null, alert_kind: null, condition_kind: 'sempre',
  condition_value: null, value,
})

describe('scaleBondEffect', () => {
  it('vínculo principal: efeito intacto', () => {
    const e = fx('multiplica', '1.50')
    expect(scaleBondEffect(e, 1)).toBe(e)
  })

  it('reduz_requisito e limite_diario escalam o valor', () => {
    expect(scaleBondEffect(fx('reduz_requisito', '2.00'), 0.5)?.value).toBe('1')
    expect(scaleBondEffect(fx('limite_diario', '1.00'), 0.25)?.value).toBe('0.25')
  })

  it('multiplica escala só o ganho: ×1.5 → ×1.25 (secundário) e ×1.125 (terciário)', () => {
    expect(scaleBondEffect(fx('multiplica', '1.50'), 0.5)?.value).toBe('1.25')
    expect(scaleBondEffect(fx('multiplica', '1.50'), 0.25)?.value).toBe('1.125')
  })

  it('multiplica abaixo de 1 (malus) também atenua: ×0.8 → ×0.9', () => {
    expect(scaleBondEffect(fx('multiplica', '0.80'), 0.5)?.value).toBe('0.9')
  })

  it.each(['anula_alerta', 'sensibilidade', 'espelho'])('%s (liga/desliga) não vale fora do principal', effect => {
    expect(scaleBondEffect(fx(effect, null), 0.5)).toBeNull()
    expect(scaleBondEffect(fx(effect, null), 0.25)).toBeNull()
  })
})

describe('listCharacterEffects — vínculos', () => {
  beforeEach(() => vi.clearAllMocks())

  it('aplica o peso devolvido pela query de vínculos e descarta liga/desliga dos menores', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(bd.weight)')) {
        return { rows: [
          { character_id: 'c1', weight: '1',    ...fx('multiplica', '1.50', 'p1') },
          { character_id: 'c1', weight: '0.5',  ...fx('reduz_requisito', '2.00', 's1') },
          { character_id: 'c1', weight: '0.25', ...fx('anula_alerta', null, 't1') },
        ] }
      }
      return { rows: [] }
    })

    const out = await listCharacterEffects(['c1'])

    expect(out.c1.map(e => [e.id, e.value])).toEqual([['p1', '1.50'], ['s1', '1']])
    const bondSql = mockDb.query.mock.calls.map(c => c[0] as string).find(s => s.includes('MAX(bd.weight)'))!
    expect(bondSql).toContain('secondary_pantheon_id')
    expect(bondSql).toContain('tertiary_divine_bond_id')
    expect(bondSql).toContain('GROUP BY bd.character_id, e.id') // mesmo dono em dois vínculos = uma vez
  })
})
