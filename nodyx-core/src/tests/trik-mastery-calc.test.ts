// Módulo RPG (trik) — fórmulas de cena de treino/estudo (#treino / #aula).
// Ver TRIK-PROJECT.md, seção 4: 500 chars = 1 unidade ("treino leve"), teto
// de 1500 chars = 3.0 ("treino pesado"); xp de personagem da cena vale
// 0.2x até 1000 chars e 0.5x de 1001 a 1500; acima de 1500 vale o xp cheio.

import { describe, it, expect } from 'vitest'
import {
  calculateMasteryUnits, calculateTrainingSceneXp, calculateSceneXp, remainingDailyMastery,
} from '../services/trik/xp/calc'

describe('remainingDailyMastery — teto de 3.0 unidades (1500 chars) por dia', () => {
  it('dia sem treino: sobra o teto inteiro', () => {
    expect(remainingDailyMastery(0)).toBe(3)
  })

  it('desconta o que já foi creditado no dia', () => {
    expect(remainingDailyMastery(1.68)).toBe(1.32)
    expect(remainingDailyMastery(2.5)).toBe(0.5)
  })

  it('teto atingido (ou passado) → 0, nunca negativo', () => {
    expect(remainingDailyMastery(3)).toBe(0)
    expect(remainingDailyMastery(4)).toBe(0)
  })
})

describe('calculateMasteryUnits', () => {
  it('500 chars = 1 unidade ("treino leve")', () => {
    expect(calculateMasteryUnits(500)).toBe(1)
  })

  it('842 chars = 1.68 (exemplo do TRIK-PROJECT.md)', () => {
    expect(calculateMasteryUnits(842)).toBe(1.68)
  })

  it('arredonda em 2 casas', () => {
    expect(calculateMasteryUnits(501)).toBe(1) // 1.002
    expect(calculateMasteryUnits(777)).toBe(1.55) // 1.554
  })

  it('1500 chars = 3.0 ("treino pesado"), o teto', () => {
    expect(calculateMasteryUnits(1500)).toBe(3)
  })

  it('acima de 1500 chars fica travado no teto de 3.0', () => {
    expect(calculateMasteryUnits(1501)).toBe(3)
    expect(calculateMasteryUnits(9000)).toBe(3)
  })

  it('limita ao que ainda resta do dia', () => {
    expect(calculateMasteryUnits(842, 1)).toBe(1)      // 1.68 pedidos, só 1.0 cabe
    expect(calculateMasteryUnits(842, 1.32)).toBe(1.32)
    expect(calculateMasteryUnits(600, 2)).toBe(1.2)    // cabe inteira
  })

  it('nada sobrando → 0', () => {
    expect(calculateMasteryUnits(1500, 0)).toBe(0)
  })
})

describe('calculateTrainingSceneXp', () => {
  it('até 1000 chars: 0.2x do xp normal', () => {
    expect(calculateTrainingSceneXp(500)).toBe(2)   // base 10
    expect(calculateTrainingSceneXp(800)).toBe(3)   // base 16 (não passa de 800, sem 1.8x)
    expect(calculateTrainingSceneXp(1000)).toBe(7)  // base 36
  })

  it('1000 chars exatos ainda estão na faixa de 0.2x ("até 1000")', () => {
    expect(calculateTrainingSceneXp(1000)).toBe(Math.round(calculateSceneXp(1000) * 0.2))
  })

  it('de 1001 a 1500 chars: 0.5x do xp normal', () => {
    expect(calculateTrainingSceneXp(1001)).toBe(18) // base 36
    expect(calculateTrainingSceneXp(1500)).toBe(27) // base 54
  })

  it('acima de 1500 chars: a cena deixa de ser treino, xp cheio', () => {
    expect(calculateTrainingSceneXp(1501)).toBe(calculateSceneXp(1501))
    expect(calculateTrainingSceneXp(3000)).toBe(calculateSceneXp(3000))
  })

  it('abaixo de 500 chars não gera xp nenhum (o gate mínimo continua o mesmo)', () => {
    expect(calculateTrainingSceneXp(499)).toBe(0)
  })

  it('cena maior do que ainda cabe no teto do dia: deixa de ser treino, xp cheio', () => {
    // 600 chars com só 1.0 unidade (500 chars) sobrando
    expect(calculateTrainingSceneXp(600, 1)).toBe(calculateSceneXp(600))
    // a mesma cena cabendo (2.0 = 1000 chars sobrando) continua reduzida
    expect(calculateTrainingSceneXp(600, 2)).toBe(2)
  })

  it('cena que cabe EXATAMENTE no que sobra ainda é treino', () => {
    expect(calculateTrainingSceneXp(500, 1)).toBe(2)
  })
})
