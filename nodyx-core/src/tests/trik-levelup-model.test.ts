// Módulo RPG (trik) — models/trik.ts › applyLevelupAllocation.
// Achado da revisão de 2026-09-20: o service conferia o orçamento num snapshot fora da
// transação, e o model somava sem guarda — dois submits simultâneos passavam os dois. Agora a
// conferência é feita DENTRO da transação, com a linha de progresso travada (FOR UPDATE).
// Só o `db` é mockado; o mock de queries mantém o estado de gasto, como o Postgres faria.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockClient, mockDb } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() }
  const mockDb = { query: vi.fn(), connect: vi.fn() }
  return { mockClient, mockDb }
})

vi.mock('../config/database', () => ({ db: mockDb }))

import { applyLevelupAllocation, LevelupRejectedError } from '../models/trik'

const zero = {
  conductPresenca: 0, conductProposito: 0, conductSangue: 0,
  principlesMente: 0, principlesCoracao: 0, principlesCorpo: 0,
}

interface ProgressState {
  points_conduct: number;     spent_conduct: number
  points_principles: number;  spent_principles: number
  points_preferences: number; spent_preferences: number
  has_goal: boolean
}

const budget = (over: Partial<ProgressState> = {}): ProgressState => ({
  points_conduct: 0, spent_conduct: 0, points_principles: 0, spent_principles: 0,
  points_preferences: 0, spent_preferences: 0, has_goal: false, ...over,
})

const clientSqls = () => mockClient.query.mock.calls.map(c => c[0] as string)

/** `state` = a linha de progresso (null = personagem sem linha). O UPDATE de spent_* altera o
 *  estado, então uma 2ª chamada enxerga o gasto da 1ª — como no banco. */
function setupDb(
  state: ProgressState | null,
  opts: { bonusFilled?: boolean; fkViolation?: boolean } = {}
) {
  mockClient.query.mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM trik_character_progress') && sql.includes('FOR UPDATE')) {
      return { rows: state ? [{ ...state }] : [] }
    }
    if (sql.startsWith('UPDATE trik_characters')) return { rows: [{ id: 'char-1' }] }
    if (sql.startsWith('UPDATE trik_character_progress')) {
      state!.spent_conduct     += params[1]
      state!.spent_principles  += params[2]
      state!.spent_preferences += params[3]
      return { rows: [] }
    }
    if (sql.includes('INSERT INTO trik_character_bonuses')) {
      if (opts.fkViolation) throw Object.assign(new Error('violates foreign key constraint'), { code: '23503' })
      return { rows: opts.bonusFilled ? [] : [{ character_id: 'char-1' }] }
    }
    return { rows: [] }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.connect.mockResolvedValue(mockClient)
})

describe('applyLevelupAllocation — orçamento conferido dentro da transação', () => {
  it('dentro do orçamento: trava a linha de progresso primeiro, aplica e faz COMMIT', async () => {
    setupDb(budget({ points_conduct: 2, points_principles: 1 }))

    const character = await applyLevelupAllocation('char-1', { ...zero, conductProposito: 2, principlesMente: 1 })

    expect(character).toEqual({ id: 'char-1' })
    const sqls = clientSqls()
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls[1]).toContain('FOR UPDATE') // a checagem vem antes de qualquer gasto
    expect(sqls.at(-1)).toBe('COMMIT')
    const spend = mockClient.query.mock.calls.find(c => (c[0] as string).startsWith('UPDATE trik_character_progress'))!
    expect(spend[1]).toEqual(['char-1', 2, 1, 0])
    expect(mockClient.release).toHaveBeenCalled()
  })

  it.each([
    ['Conduta',    { conductPresenca: 2 },   budget({ points_conduct: 1 }),    'Pontos de Conduta insuficientes'],
    ['Princípios', { principlesCorpo: 3 },   budget({ points_principles: 2 }), 'Pontos de Princípios insuficientes'],
  ])('gasto de %s acima do disponível → LevelupRejectedError, ROLLBACK e nada é gasto', async (_l, deltas, state, message) => {
    setupDb(state)

    const promise = applyLevelupAllocation('char-1', { ...zero, ...deltas })

    await expect(promise).rejects.toBeInstanceOf(LevelupRejectedError)
    await expect(promise).rejects.toThrow(message)
    expect(clientSqls().at(-1)).toBe('ROLLBACK')
    expect(clientSqls()).not.toContain('COMMIT')
    expect(clientSqls().some(s => s.startsWith('UPDATE trik_characters'))).toBe(false)
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('já gastou parte: o disponível é pontos - gasto, não só os pontos', async () => {
    setupDb(budget({ points_conduct: 3, spent_conduct: 2 }))
    await expect(applyLevelupAllocation('char-1', { ...zero, conductSangue: 2 }))
      .rejects.toThrow('Pontos de Conduta insuficientes')
  })

  it('DUPLO CLIQUE: com 1 ponto, o 1º submit passa e o 2º é barrado (o snapshot do service deixava os dois passarem)', async () => {
    const state = budget({ points_conduct: 1 })
    setupDb(state)

    await expect(applyLevelupAllocation('char-1', { ...zero, conductPresenca: 1 })).resolves.toBeDefined()
    await expect(applyLevelupAllocation('char-1', { ...zero, conductPresenca: 1 }))
      .rejects.toBeInstanceOf(LevelupRejectedError)

    expect(state.spent_conduct).toBe(1) // nunca passa de points_conduct
  })

  it('personagem sem linha de progresso (nunca ganhou xp): não há pontos', async () => {
    setupDb(null)
    await expect(applyLevelupAllocation('char-1', { ...zero, conductPresenca: 1 }))
      .rejects.toThrow('Sem pontos disponíveis')
  })
})

describe('applyLevelupAllocation — preferências e objetivo', () => {
  it('preferência sem ponto de preferência disponível → rejeita', async () => {
    setupDb(budget())
    await expect(applyLevelupAllocation('char-1', zero, [{ slot: 'first_preference_id', valueId: 'pref-1' }]))
      .rejects.toThrow('Sem pontos de Preferência disponíveis')
  })

  it('preferência preenchida: gasta 1 ponto de preferência e grava o slot', async () => {
    setupDb(budget({ points_preferences: 1 }))

    await applyLevelupAllocation('char-1', zero, [{ slot: 'first_preference_id', valueId: 'pref-1' }])

    const spend = mockClient.query.mock.calls.find(c => (c[0] as string).startsWith('UPDATE trik_character_progress'))!
    expect(spend[1]).toEqual(['char-1', 0, 0, 1])
    const bonus = mockClient.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO trik_character_bonuses'))!
    expect(bonus[0]).toContain('first_preference_id')
    expect(bonus[0]).toContain('RETURNING')
    expect(bonus[1]).toEqual(['char-1', 'pref-1'])
  })

  it('slot já preenchido por outro submit (INSERT ... WHERE slot IS NULL sem linha) → aborta TUDO, sem queimar o ponto', async () => {
    const state = budget({ points_preferences: 1 })
    setupDb(state, { bonusFilled: true })

    await expect(applyLevelupAllocation('char-1', zero, [{ slot: 'second_preference_id', valueId: 'pref-2' }]))
      .rejects.toThrow('Essa preferência já foi preenchida')

    // O gasto foi feito dentro da transação, mas o ROLLBACK o desfaz: nada é confirmado.
    expect(clientSqls().at(-1)).toBe('ROLLBACK')
    expect(clientSqls()).not.toContain('COMMIT')
  })

  it('objetivo sem has_goal → rejeita; objetivo já escolhido → rejeita', async () => {
    setupDb(budget({ has_goal: false }))
    await expect(applyLevelupAllocation('char-1', zero, [{ slot: 'goal_id', valueId: 'g1' }]))
      .rejects.toThrow('Objetivo ainda não desbloqueado')

    setupDb(budget({ has_goal: true }), { bonusFilled: true })
    await expect(applyLevelupAllocation('char-1', zero, [{ slot: 'goal_id', valueId: 'g1' }]))
      .rejects.toThrow('Objetivo já escolhido')
  })

  it('objetivo não consome ponto de preferência', async () => {
    setupDb(budget({ has_goal: true }))
    await applyLevelupAllocation('char-1', zero, [{ slot: 'goal_id', valueId: 'g1' }])
    // nenhum ponto gasto → nem chega a atualizar spent_*
    expect(clientSqls().some(s => s.startsWith('UPDATE trik_character_progress'))).toBe(false)
  })
})

describe('applyLevelupAllocation — erros', () => {
  it('id de catálogo inexistente (FK violation 23503) vira erro de entrada, não 500', async () => {
    setupDb(budget({ points_preferences: 1 }), { fkViolation: true })

    const promise = applyLevelupAllocation('char-1', zero, [{ slot: 'first_preference_id', valueId: 'nao-existe' }])

    await expect(promise).rejects.toBeInstanceOf(LevelupRejectedError)
    await expect(promise).rejects.toThrow('Preferência ou objetivo inexistente')
    expect(clientSqls().at(-1)).toBe('ROLLBACK')
  })

  it('qualquer outro erro do banco propaga como está (é um erro de verdade) e libera o client', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) throw new Error('conexão caiu')
      return { rows: [] }
    })

    const promise = applyLevelupAllocation('char-1', { ...zero, conductPresenca: 1 })

    await expect(promise).rejects.toThrow('conexão caiu')
    await expect(promise).rejects.not.toBeInstanceOf(LevelupRejectedError)
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('slot fora da lista permitida é recusado antes de abrir transação', async () => {
    await expect(applyLevelupAllocation('char-1', zero, [{ slot: 'first_aptitude_id' as any, valueId: 'x' }]))
      .rejects.toThrow('slot inválido')
    expect(mockDb.connect).not.toHaveBeenCalled()
  })
})
