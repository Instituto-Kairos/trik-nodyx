/**
 * Módulo RPG (trik) — Fase 3: motor de bônus de treino/aula (puro, sem banco).
 * Ver plans/fase-tres-bonus.md §2. Quem chama (processScenePost) junta os
 * efeitos dos 9 donos, o clima do dia e as unidades já usadas; aqui só a conta.
 *
 * Ordem (§2.5): filtra efeitos → alerta do dia → brutas = min(chars/500,
 * teto restante) → × multiplicadores (se o alerta permitir) → × penalidade.
 * Com `espelho`, o conjunto inteiro pode ser trocado pelo de um parceiro
 * jogador, se render mais (§2.3).
 */

import type { DayAlert, Climate } from '../weather'
import { DAILY_MASTERY_CAP_UNITS, MASTERY_UNIT_CHARS } from './calc'

export type Activity = 'treino' | 'aula'
export type Period = 'dia' | 'noite'

/** Subconjunto de TrikEffect (models/trikEffects) que o motor lê. */
export interface EngineEffect {
  id:                 string
  effect:             string
  activity:           string
  weapon_id:          string | null
  knowledge_id:       string | null
  weapon_category:    string | null
  knowledge_category: string | null
  alert_kind:         string | null
  condition_kind:     string
  condition_value:    string | null
  value:              string | number | null
}

export interface SceneContext {
  activity:     Activity
  /** Arma (treino) ou matéria (aula) da cena. */
  target:       { id: string; category: string | null }
  cenaLength:   number
  /** Unidades BRUTAS já creditadas no mesmo dia in-game, mesmo tipo. */
  usedRawToday: number
  /** null = tópico sem região, cena sem Data ou dia sem dado. */
  climate:      Climate | null
  period:       Period | null
  /** Algum nome no #com (NPC conta). */
  hasCompanion: boolean
  alerts:       DayAlert[]
}

export type AlertOutcome =
  | 'none'
  | 'penalized'   // ×0.5 treino / ×0.75 aula
  | 'forbidden'   // vermelho em treino → "passando mal"
  | 'zero'        // vermelho em aula → 0 unidades, sem aviso

export interface EngineResult {
  outcome:        AlertOutcome
  /** Unidades brutas (antes de bônus/penalidade) — é o que gasta teto. */
  rawUnits:       number
  /** Unidades finais creditadas. */
  units:          number
  multiplier:     number
  penalty:        number
  /** Alerta laranja/vermelho relevante → multiplicadores não valem. */
  bonusesBlocked: boolean
  capTotal:       number
  /** Soma de reduz_requisito (aplicar com effectiveRequirement). */
  reqReduction:   number
  /** Cena penalizada/proibida/zerada não gasta teto (§2.2). */
  consumesCap:    boolean
  /** Ids dos efeitos que valeram. */
  appliedEffects: string[]
  /** Índice do parceiro cujo conjunto foi usado (espelho); null = próprio. */
  mirroredFrom:   number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
const num = (v: string | number | null) => (v === null ? 0 : Number(v))

const PENALTY: Record<Activity, number> = { treino: 0.5, aula: 0.75 }

/** Requisito de nível depois das reduções — nunca abaixo de 1 (§2.1). */
export function effectiveRequirement(requirement: number, reduction: number): number {
  return Math.max(1, requirement - reduction)
}

/** Dia entre nascer e pôr do sol (inclusive o nascer), noite fora. Horários 'HH:MM'. */
export function periodOf(time: string | null, sunrise: string | null, sunset: string | null): Period | null {
  if (!time || !sunrise || !sunset) return null
  const t = time.slice(0, 5)
  return t >= sunrise.slice(0, 5) && t < sunset.slice(0, 5) ? 'dia' : 'noite'
}

/** O efeito vale nesta cena? (atividade, alvo e condição) */
function applies(e: EngineEffect, ctx: SceneContext): boolean {
  if (e.activity !== 'todas' && e.activity !== ctx.activity) return false

  if (e.weapon_id || e.weapon_category) {
    if (ctx.activity !== 'treino') return false
    if (e.weapon_id && e.weapon_id !== ctx.target.id) return false
    if (e.weapon_category && norm(e.weapon_category) !== norm(ctx.target.category)) return false
  }
  if (e.knowledge_id || e.knowledge_category) {
    if (ctx.activity !== 'aula') return false
    if (e.knowledge_id && e.knowledge_id !== ctx.target.id) return false
    if (e.knowledge_category && norm(e.knowledge_category) !== norm(ctx.target.category)) return false
  }

  switch (e.condition_kind) {
    case 'sempre':    return true
    case 'clima':     return ctx.climate !== null && ctx.climate === e.condition_value
    case 'periodo':   return ctx.period !== null && ctx.period === e.condition_value
    case 'companhia': return ctx.hasCompanion
    default:          return false
  }
}

/** Alerta do dia pra este conjunto de efeitos (§2.4). */
function evaluateAlerts(effects: EngineEffect[], ctx: SceneContext) {
  const has = (effect: string, kind: string) => effects.some(e => e.effect === effect && e.alert_kind === kind)
  let forbidden = false, penalized = false, bonusesBlocked = false

  for (const a of ctx.alerts) {
    if (a.kind === 'frio' && ctx.activity === 'aula') continue // frio não afeta aula
    const sensitive = has('sensibilidade', a.kind)
    if (a.level === 'vermelho') {
      forbidden = true
    } else if (a.level === 'laranja') {
      bonusesBlocked = true
      const neutralized = has('anula_alerta', a.kind) && !sensitive
      if (!neutralized) penalized = true
    } else if (sensitive) {
      penalized = true // atenção: só sensível; bônus continuam valendo
    }
  }

  const outcome: AlertOutcome =
    forbidden ? (ctx.activity === 'treino' ? 'forbidden' : 'zero')
    : penalized ? 'penalized'
    : 'none'
  return { outcome, bonusesBlocked: bonusesBlocked || forbidden }
}

/** Conta de um conjunto de efeitos (sem espelho). */
function computeSet(effects: EngineEffect[], ctx: SceneContext): Omit<EngineResult, 'mirroredFrom'> {
  const valid = effects.filter(e => e.effect !== 'espelho' && applies(e, ctx))
  const sum = (effect: string) => valid.filter(e => e.effect === effect).reduce((s, e) => s + num(e.value), 0)

  // Sensibilidade/anula valem pro alerta mesmo sem bater condição de cena.
  const alertEffects = effects.filter(e => e.effect === 'sensibilidade' || e.effect === 'anula_alerta')
  const { outcome, bonusesBlocked } = evaluateAlerts(alertEffects, ctx)

  // Laranja/vermelho: a disposição é menor — o aumento de teto não vale
  // (confirmado pelo usuário em 2026-10-14). Redução de requisito continua.
  const capTotal = DAILY_MASTERY_CAP_UNITS + (bonusesBlocked ? 0 : sum('limite_diario'))
  const reqReduction = sum('reduz_requisito')
  const remaining = Math.max(0, capTotal - ctx.usedRawToday)
  const rawUnits = round2(Math.max(0, Math.min(ctx.cenaLength / MASTERY_UNIT_CHARS, remaining)))

  const multipliers = bonusesBlocked ? [] : valid.filter(e => e.effect === 'multiplica')
  const multiplier = multipliers.reduce((p, e) => p * num(e.value), 1)
  const penalty = outcome === 'penalized' ? PENALTY[ctx.activity] : 1

  const blockedOut = outcome === 'forbidden' || outcome === 'zero'
  const units = blockedOut ? 0 : round2(rawUnits * multiplier * penalty)

  const appliedEffects = valid
    .filter(e => !bonusesBlocked || (e.effect !== 'multiplica' && e.effect !== 'limite_diario'))
    .map(e => e.id)
    .concat(alertEffects.filter(e => ctx.alerts.some(a => a.kind === e.alert_kind)).map(e => e.id))

  return {
    outcome,
    rawUnits: blockedOut ? 0 : rawUnits,
    units,
    multiplier: round2(multiplier),
    penalty,
    bonusesBlocked,
    capTotal,
    reqReduction,
    consumesCap: outcome === 'none',
    appliedEffects: [...new Set(appliedEffects)],
  }
}

/**
 * `own` = efeitos do personagem (todos os donos). `partners` = conjuntos
 * PRÓPRIOS de cada parceiro jogador do #com (nunca espelhados — sem loop).
 * Espelho só entra se o personagem tem o efeito; troca o conjunto inteiro
 * pelo do parceiro que render mais unidades (empate → maior redução).
 */
export function computeTraining(own: EngineEffect[], partners: EngineEffect[][], ctx: SceneContext): EngineResult {
  let best: EngineResult = { ...computeSet(own, ctx), mirroredFrom: null }
  if (!own.some(e => e.effect === 'espelho')) return best

  partners.forEach((set, i) => {
    const r = computeSet(set.filter(e => e.effect !== 'espelho'), ctx)
    if (r.units > best.units || (r.units === best.units && r.reqReduction > best.reqReduction)) {
      best = { ...r, mirroredFrom: i }
    }
  })
  return best
}
