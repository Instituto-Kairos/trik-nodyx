/**
 * Módulo RPG (trik) — Fase 2, Fluxo 2: /levelup.
 * Ver plans/fase-dois.md, seção "Fluxo 2", e
 * plans/fase-dois-passo-a-passo.md, passo 6.2.
 *
 * Mesma convenção dos services da Fase 1 (registro/plaquinha): nunca lança
 * — devolve resultado tipado, a rota decide o código HTTP. Sem Aptidões
 * nesta fase (ver passo 0 do passo-a-passo) — só Conduct/Principles
 * (pontos), Preferência (1 slot por submit) e Objetivo (desbloqueio por
 * has_goal, sem custo de pontos).
 */

import {
  getPlayer, getCharacterById, getOrCreateProgress, getCharacterBonuses,
  applyLevelupAllocation, LevelupRejectedError,
  type TrikCharacter, type LevelupDeltas, type LevelupBonusFill, type BonusSlot,
} from '../../../models/trik'

export interface LevelupInput {
  characterId:   string
  deltas:        LevelupDeltas
  preferenceId?: string
  goalId?:       string
}

export type LevelupResult =
  | { ok: true; character: TrikCharacter }
  | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION'; message: string }

export async function submitLevelup(userId: string, input: LevelupInput): Promise<LevelupResult> {
  const character = await getCharacterById(input.characterId)
  if (!character) {
    return { ok: false, code: 'NOT_FOUND', message: 'Personagem não encontrado' }
  }

  const player = await getPlayer(userId)
  if (!player || character.player_id !== player.id) {
    return { ok: false, code: 'FORBIDDEN', message: 'Esse personagem não pertence a você' }
  }

  const progress = await getOrCreateProgress(character.id)
  const availableConduct     = progress.points_conduct     - progress.spent_conduct
  const availablePrinciples  = progress.points_principles  - progress.spent_principles
  const availablePreferences = progress.points_preferences - progress.spent_preferences

  const { deltas } = input
  const requestedConduct    = deltas.conductPresenca  + deltas.conductProposito  + deltas.conductSangue
  const requestedPrinciples = deltas.principlesMente   + deltas.principlesCoracao + deltas.principlesCorpo

  if (requestedConduct > availableConduct) {
    return { ok: false, code: 'VALIDATION', message: 'Pontos de Conduta insuficientes' }
  }
  if (requestedPrinciples > availablePrinciples) {
    return { ok: false, code: 'VALIDATION', message: 'Pontos de Princípios insuficientes' }
  }

  const bonusFills: LevelupBonusFill[] = []
  const bonuses = (input.preferenceId || input.goalId) ? await getCharacterBonuses(character.id) : null

  if (input.preferenceId) {
    if (availablePreferences <= 0) {
      return { ok: false, code: 'VALIDATION', message: 'Sem pontos de Preferência disponíveis' }
    }
    const slot: BonusSlot | null =
      !bonuses?.first_preference_id  ? 'first_preference_id' :
      !bonuses?.second_preference_id ? 'second_preference_id' : null
    if (!slot) {
      return { ok: false, code: 'VALIDATION', message: 'Já escolheu as duas preferências' }
    }
    bonusFills.push({ slot, valueId: input.preferenceId })
  }

  if (input.goalId) {
    if (!progress.has_goal) {
      return { ok: false, code: 'VALIDATION', message: 'Objetivo ainda não desbloqueado' }
    }
    if (bonuses?.goal_id) {
      return { ok: false, code: 'VALIDATION', message: 'Objetivo já escolhido' }
    }
    bonusFills.push({ slot: 'goal_id', valueId: input.goalId })
  }

  if (requestedConduct === 0 && requestedPrinciples === 0 && bonusFills.length === 0) {
    return { ok: false, code: 'VALIDATION', message: 'Nada pra salvar' }
  }

  // As checagens acima leem um snapshot fora de transação (boas pra dar erro
  // rápido e específico); a validação que vale é a de applyLevelupAllocation,
  // com a linha de progresso travada — é ela que barra dois submits simultâneos.
  try {
    const updated = await applyLevelupAllocation(character.id, deltas, bonusFills)
    return { ok: true, character: updated }
  } catch (err) {
    if (err instanceof LevelupRejectedError) {
      return { ok: false, code: 'VALIDATION', message: err.message }
    }
    throw err
  }
}
