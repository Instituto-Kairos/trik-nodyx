// Módulo RPG (trik) — Fase 3: motor de bônus (puro). Casos do plano §2.

import { describe, it, expect } from 'vitest'
import {
  computeTraining, effectiveRequirement, periodOf,
  type EngineEffect, type SceneContext,
} from '../services/trik/xp/bonusEngine'

let seq = 0
const fx = (p: Partial<EngineEffect>): EngineEffect => ({
  id: `e${++seq}`, effect: 'multiplica', activity: 'todas',
  weapon_id: null, knowledge_id: null, weapon_category: null, knowledge_category: null,
  alert_kind: null, condition_kind: 'sempre', condition_value: null, value: null, ...p,
})

const ctx = (p: Partial<SceneContext> = {}): SceneContext => ({
  activity: 'treino', target: { id: 'w1', category: 'Espadas' }, cenaLength: 1500,
  usedRawToday: 0, climate: null, period: null, hasCompanion: false, alerts: [], ...p,
})

const noite   = fx({ condition_kind: 'periodo', condition_value: 'noite', value: 1.5 })
const chuva   = fx({ condition_kind: 'clima', condition_value: 'chuva', value: 1.25 })
const comp    = fx({ condition_kind: 'companhia', value: 1.8 })
const limite3 = fx({ effect: 'limite_diario', value: 3 })

describe('computeTraining — sem alerta', () => {
  it('sem efeitos: chars/500 limitado a 3', () => {
    expect(computeTraining([], [], ctx({ cenaLength: 2000 }))).toMatchObject({ rawUnits: 3, units: 3, capTotal: 3 })
  })

  it('teto vale pras brutas; bônus vêm depois e multiplicam entre si', () => {
    const r = computeTraining([noite, chuva, comp, limite3], [], ctx({
      cenaLength: 5000, climate: 'chuva', period: 'noite', hasCompanion: true,
    }))
    expect(r).toMatchObject({ rawUnits: 6, multiplier: 3.38, units: 20.25, consumesCap: true })
  })

  it('teto restante considera o que já foi usado no dia', () => {
    expect(computeTraining([noite], [], ctx({ usedRawToday: 2.5, period: 'noite' })))
      .toMatchObject({ rawUnits: 0.5, units: 0.75 })
  })

  it('condição que não bate não vale', () => {
    expect(computeTraining([noite, chuva, comp], [], ctx({ period: 'dia', climate: 'sol' })).multiplier).toBe(1)
  })

  it('alvo: categoria (sem diferenciar maiúscula), item e atividade', () => {
    const cat = fx({ effect: 'reduz_requisito', activity: 'treino', weapon_category: 'espadas', value: 1 })
    const other = fx({ effect: 'reduz_requisito', activity: 'treino', weapon_id: 'w2', value: 5 })
    const aula = fx({ activity: 'aula', value: 2 })
    const r = computeTraining([cat, other, aula], [], ctx())
    expect(r.reqReduction).toBe(1)
    expect(r.multiplier).toBe(1)
  })
})

describe('computeTraining — alertas', () => {
  const sensCalor = fx({ effect: 'sensibilidade', alert_kind: 'calor' })
  const anulaCalor = fx({ effect: 'anula_alerta', alert_kind: 'calor' })

  it('exemplo do plano: sensível, 🟡 calor, noite, teto 6 → 4.5', () => {
    const r = computeTraining([sensCalor, noite, limite3], [], ctx({
      cenaLength: 3000, period: 'noite', alerts: [{ kind: 'calor', level: 'atencao' }],
    }))
    expect(r).toMatchObject({ outcome: 'penalized', units: 4.5, consumesCap: false })
  })

  it('🟡 sem sensibilidade não muda nada', () => {
    const r = computeTraining([noite], [], ctx({ period: 'noite', alerts: [{ kind: 'calor', level: 'atencao' }] }))
    expect(r).toMatchObject({ outcome: 'none', units: 4.5 })
  })

  it('🟠 corta bônus e penaliza; aula ×0.75', () => {
    const alerts = [{ kind: 'umidade' as const, level: 'laranja' as const }]
    expect(computeTraining([noite], [], ctx({ period: 'noite', alerts }))).toMatchObject({ units: 1.5, multiplier: 1, bonusesBlocked: true })
    expect(computeTraining([], [], ctx({ activity: 'aula', alerts })).units).toBe(2.25)
  })

  it('🟠 neutralizado: ×1, ainda sem bônus; sensível não neutraliza', () => {
    const alerts = [{ kind: 'calor' as const, level: 'laranja' as const }]
    expect(computeTraining([anulaCalor, noite], [], ctx({ period: 'noite', alerts })))
      .toMatchObject({ outcome: 'none', units: 3, consumesCap: true })
    expect(computeTraining([anulaCalor, sensCalor], [], ctx({ alerts })).outcome).toBe('penalized')
  })

  it('🟠 o aumento de teto não vale (disposição menor), mesmo neutralizado', async () => {
    const alerts = [{ kind: 'calor' as const, level: 'laranja' as const }]
    expect(computeTraining([limite3], [], ctx({ cenaLength: 3000, alerts }))).toMatchObject({ capTotal: 3, rawUnits: 3, units: 1.5 })
    expect(computeTraining([limite3, anulaCalor], [], ctx({ cenaLength: 3000, alerts }))).toMatchObject({ capTotal: 3, units: 3 })
    // 🟡 sem sensibilidade: bônus valem, teto aumentado também
    expect(computeTraining([limite3], [], ctx({ cenaLength: 3000, alerts: [{ kind: 'calor', level: 'atencao' }] })).capTotal).toBe(6)
  })

  it('precisa anular todos os laranjas do dia; penalidade aplica uma vez', () => {
    const alerts = [{ kind: 'calor' as const, level: 'laranja' as const }, { kind: 'umidade' as const, level: 'laranja' as const }]
    expect(computeTraining([anulaCalor], [], ctx({ alerts }))).toMatchObject({ outcome: 'penalized', units: 1.5 })
  })

  it('🔴 treino proibido, aula zerada', () => {
    const alerts = [{ kind: 'calor' as const, level: 'vermelho' as const }]
    expect(computeTraining([anulaCalor], [], ctx({ alerts }))).toMatchObject({ outcome: 'forbidden', units: 0, rawUnits: 0, consumesCap: false })
    expect(computeTraining([], [], ctx({ activity: 'aula', alerts }))).toMatchObject({ outcome: 'zero', units: 0 })
  })

  it('frio não afeta aula', () => {
    const alerts = [{ kind: 'frio' as const, level: 'vermelho' as const }]
    expect(computeTraining([], [], ctx({ activity: 'aula', alerts }))).toMatchObject({ outcome: 'none', units: 3 })
  })
})

describe('computeTraining — espelho', () => {
  const espelho = fx({ effect: 'espelho' })
  const parceiro = [fx({ value: 2 })]

  it('troca pelo conjunto do parceiro se render mais', () => {
    const r = computeTraining([espelho, noite], [[], parceiro], ctx({ period: 'dia' }))
    expect(r).toMatchObject({ mirroredFrom: 1, units: 6 })
  })

  it('mantém o próprio se for melhor, e sem espelho ignora parceiros', () => {
    expect(computeTraining([espelho, fx({ value: 3 })], [parceiro], ctx()).mirroredFrom).toBeNull()
    expect(computeTraining([noite], [parceiro], ctx()).mirroredFrom).toBeNull()
  })

  it('empate em unidades → maior redução de requisito', () => {
    const red = [fx({ effect: 'reduz_requisito', value: 2 })]
    expect(computeTraining([espelho], [red], ctx()).mirroredFrom).toBe(0)
  })
})

describe('helpers', () => {
  it('requisito tem piso 1', () => {
    expect(effectiveRequirement(5, 2)).toBe(3)
    expect(effectiveRequirement(2, 5)).toBe(1)
  })
  it('período pelo nascer/pôr do sol', () => {
    expect(periodOf('06:16', '06:16:00', '19:57:00')).toBe('dia')
    expect(periodOf('19:57', '06:16', '19:57')).toBe('noite')
    expect(periodOf('03:00', '06:16', '19:57')).toBe('noite')
    expect(periodOf(null, '06:16', '19:57')).toBeNull()
  })
})
