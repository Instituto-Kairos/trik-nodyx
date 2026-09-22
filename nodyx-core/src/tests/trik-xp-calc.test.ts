// Módulo RPG (trik) — Fase 2: calculateSceneXp.
// Ver plans/fase-dois.md, "Fluxo 1", item 3.

import { describe, it, expect } from 'vitest'
import { calculateSceneXp } from '../services/trik/xp/calc'

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
