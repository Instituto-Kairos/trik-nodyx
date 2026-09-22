// Módulo RPG (trik) — Fase 2: submitLevelup.
// Ver plans/fase-dois.md, "Fluxo 2", e trik-plaquinha.test.ts (Fase 1) pro
// mesmo padrão de teste de ownership em nível de serviço.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const OWNER_ID = 'owner-uuid'
const OTHER_ID = 'other-uuid'
const CHAR_ID  = 'char-uuid'

vi.mock('../models/trik', () => ({
  getPlayer:               vi.fn(),
  getCharacterById:        vi.fn(),
  getOrCreateProgress:     vi.fn(),
  getCharacterBonuses:     vi.fn(),
  applyLevelupAllocation:  vi.fn(),
  // Classe de verdade (não vi.fn): o service usa `instanceof` pra separar rejeição de regra de erro de banco.
  LevelupRejectedError:    class LevelupRejectedError extends Error {},
}))

import {
  getPlayer, getCharacterById, getOrCreateProgress, getCharacterBonuses, applyLevelupAllocation,
  LevelupRejectedError,
} from '../models/trik'
import { submitLevelup } from '../services/trik/xp/levelup'

function zeroDeltas(overrides: Record<string, number> = {}) {
  return {
    conductPresenca: 0, conductProposito: 0, conductSangue: 0,
    principlesMente: 0, principlesCoracao: 0, principlesCorpo: 0,
    ...overrides,
  }
}

function progress(overrides: Record<string, unknown> = {}) {
  return {
    character_id: CHAR_ID, level: 1, progress_xp: 0,
    points_conduct: 0, points_principles: 0, points_preferences: 0,
    spent_conduct: 0, spent_principles: 0, spent_preferences: 0,
    has_goal: false, updated_at: '',
    ...overrides,
  }
}

describe('submitLevelup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCharacterById).mockResolvedValue({ id: CHAR_ID, player_id: OWNER_ID } as any)
    vi.mocked(getPlayer).mockResolvedValue({ id: OWNER_ID } as any)
    vi.mocked(getCharacterBonuses).mockResolvedValue(null)
  })

  it('rejeita personagem inexistente', async () => {
    vi.mocked(getCharacterById).mockResolvedValue(null)
    const result = await submitLevelup(OWNER_ID, { characterId: CHAR_ID, deltas: zeroDeltas() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_FOUND')
  })

  it('rejeita personagem de outro jogador', async () => {
    vi.mocked(getCharacterById).mockResolvedValue({ id: CHAR_ID, player_id: OTHER_ID } as any)
    const result = await submitLevelup(OWNER_ID, { characterId: CHAR_ID, deltas: zeroDeltas() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FORBIDDEN')
    expect(applyLevelupAllocation).not.toHaveBeenCalled()
  })

  it('rejeita gasto de conduct acima do disponível', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ points_conduct: 1, spent_conduct: 0 }) as any)
    const result = await submitLevelup(OWNER_ID, {
      characterId: CHAR_ID, deltas: zeroDeltas({ conductPresenca: 2 }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VALIDATION')
    expect(applyLevelupAllocation).not.toHaveBeenCalled()
  })

  it('rejeita gasto de principles acima do disponível', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ points_principles: 1 }) as any)
    const result = await submitLevelup(OWNER_ID, {
      characterId: CHAR_ID, deltas: zeroDeltas({ principlesMente: 2 }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VALIDATION')
  })

  it('rejeita submit vazio (nada pra salvar)', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress() as any)
    const result = await submitLevelup(OWNER_ID, { characterId: CHAR_ID, deltas: zeroDeltas() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VALIDATION')
  })

  it('aceita e aplica deltas dentro do orçamento', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ points_conduct: 2, spent_conduct: 0 }) as any)
    vi.mocked(applyLevelupAllocation).mockResolvedValue({ id: CHAR_ID, conduct_presenca: 1 } as any)

    const result = await submitLevelup(OWNER_ID, {
      characterId: CHAR_ID, deltas: zeroDeltas({ conductPresenca: 1 }),
    })
    expect(result.ok).toBe(true)
    expect(applyLevelupAllocation).toHaveBeenCalledWith(
      CHAR_ID, zeroDeltas({ conductPresenca: 1 }), []
    )
  })

  it('rejeita preferência sem pontos disponíveis', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ points_preferences: 0 }) as any)
    const result = await submitLevelup(OWNER_ID, {
      characterId: CHAR_ID, deltas: zeroDeltas(), preferenceId: 'pref-1',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VALIDATION')
  })

  it('preenche o primeiro slot livre de preferência', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ points_preferences: 1 }) as any)
    vi.mocked(getCharacterBonuses).mockResolvedValue({
      character_id: CHAR_ID, first_aptitude_id: null, second_aptitude_id: null,
      first_preference_id: null, second_preference_id: null, goal_id: null,
    } as any)
    vi.mocked(applyLevelupAllocation).mockResolvedValue({ id: CHAR_ID } as any)

    await submitLevelup(OWNER_ID, { characterId: CHAR_ID, deltas: zeroDeltas(), preferenceId: 'pref-1' })
    expect(applyLevelupAllocation).toHaveBeenCalledWith(
      CHAR_ID, zeroDeltas(), [{ slot: 'first_preference_id', valueId: 'pref-1' }]
    )
  })

  it('rejeita preferência quando os dois slots já estão preenchidos', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ points_preferences: 5 }) as any)
    vi.mocked(getCharacterBonuses).mockResolvedValue({
      character_id: CHAR_ID, first_aptitude_id: null, second_aptitude_id: null,
      first_preference_id: 'p1', second_preference_id: 'p2', goal_id: null,
    } as any)
    const result = await submitLevelup(OWNER_ID, { characterId: CHAR_ID, deltas: zeroDeltas(), preferenceId: 'pref-3' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VALIDATION')
    expect(applyLevelupAllocation).not.toHaveBeenCalled()
  })

  it('rejeita objetivo se has_goal ainda não foi desbloqueado', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ has_goal: false }) as any)
    const result = await submitLevelup(OWNER_ID, { characterId: CHAR_ID, deltas: zeroDeltas(), goalId: 'goal-1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VALIDATION')
  })

  it('rejeita objetivo já escolhido', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ has_goal: true }) as any)
    vi.mocked(getCharacterBonuses).mockResolvedValue({
      character_id: CHAR_ID, first_aptitude_id: null, second_aptitude_id: null,
      first_preference_id: null, second_preference_id: null, goal_id: 'already-set',
    } as any)
    const result = await submitLevelup(OWNER_ID, { characterId: CHAR_ID, deltas: zeroDeltas(), goalId: 'goal-1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VALIDATION')
  })

  it('aceita objetivo desbloqueado e ainda vazio', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ has_goal: true }) as any)
    vi.mocked(applyLevelupAllocation).mockResolvedValue({ id: CHAR_ID } as any)
    const result = await submitLevelup(OWNER_ID, { characterId: CHAR_ID, deltas: zeroDeltas(), goalId: 'goal-1' })
    expect(result.ok).toBe(true)
    expect(applyLevelupAllocation).toHaveBeenCalledWith(
      CHAR_ID, zeroDeltas(), [{ slot: 'goal_id', valueId: 'goal-1' }]
    )
  })

  // A checagem do service lê um snapshot fora de transação; a que vale é a do model, com a
  // linha de progresso travada. Quando ela recusa (duplo clique, slot já preenchido, id de
  // catálogo inexistente), o usuário recebe um 400 com a mensagem — não um 500.
  it('rejeição de regra do model (LevelupRejectedError) vira VALIDATION com a mensagem dela', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ points_conduct: 1 }) as any)
    vi.mocked(applyLevelupAllocation).mockRejectedValue(new LevelupRejectedError('Pontos de Conduta insuficientes'))

    const result = await submitLevelup(OWNER_ID, {
      characterId: CHAR_ID, deltas: zeroDeltas({ conductPresenca: 1 }),
    })

    expect(result).toEqual({ ok: false, code: 'VALIDATION', message: 'Pontos de Conduta insuficientes' })
  })

  it('erro que NÃO é rejeição de regra continua propagando (é falha de verdade)', async () => {
    vi.mocked(getOrCreateProgress).mockResolvedValue(progress({ points_conduct: 1 }) as any)
    vi.mocked(applyLevelupAllocation).mockRejectedValue(new Error('conexão caiu'))

    await expect(submitLevelup(OWNER_ID, {
      characterId: CHAR_ID, deltas: zeroDeltas({ conductPresenca: 1 }),
    })).rejects.toThrow('conexão caiu')
  })
})
