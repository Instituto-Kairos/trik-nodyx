// Módulo RPG (trik) — Fase 2: calculateSceneXp.
// Ver plans/fase-dois.md, "Fluxo 1", item 3.

import { describe, it, expect } from 'vitest'
import { calculateSceneXp, permitMultiplier, applyPermit } from '../services/trik/xp/calc'

describe('calculateSceneXp', () => {
  it('não dá xp abaixo de 500 caracteres', () => {
    expect(calculateSceneXp(0)).toBe(0)
    expect(calculateSceneXp(100)).toBe(0)
    expect(calculateSceneXp(499)).toBe(0)
  })

  it('taxa normal entre 500 e 800 (inclusive)', () => {
    expect(calculateSceneXp(500)).toBe(10)
    expect(calculateSceneXp(650)).toBe(13)
    expect(calculateSceneXp(800)).toBe(16)
  })

  it('taxa 1.8x pra conta inteira acima de 800 (não progressivo)', () => {
    expect(calculateSceneXp(801)).toBe(29)
    expect(calculateSceneXp(842)).toBe(30)
    expect(calculateSceneXp(900)).toBe(32)
    expect(calculateSceneXp(1000)).toBe(36)
  })
})

describe('passes (permitMultiplier / applyPermit)', () => {
  const m = (permit_type: string | null, permit_multiparo = false) => permitMultiplier({ permit_type, permit_multiparo })

  it('sem passe = 1x', () => expect(m(null)).toBe(1))
  it('Estudantil 1.5x, Trabalhista 1 1.6x, Trabalhista 2 1.75x', () => {
    expect(m('estudantil')).toBe(1.5)
    expect(m('trabalhista_1')).toBe(1.6)
    expect(m('trabalhista_2')).toBe(1.75)
  })
  it('Multíparo sozinho 1.4x, e multiplica em cima dos outros', () => {
    expect(m(null, true)).toBe(1.4)
    expect(m('estudantil', true)).toBeCloseTo(2.1)
    expect(m('trabalhista_2', true)).toBeCloseTo(2.45)
  })
  it('arredonda o xp final', () => {
    expect(applyPermit(12, 1.5)).toBe(18)
    expect(applyPermit(12, 1.75)).toBe(21)
    expect(applyPermit(12, 1)).toBe(12)
  })
})
