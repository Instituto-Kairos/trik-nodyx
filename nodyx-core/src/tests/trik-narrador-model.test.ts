// Módulo RPG (trik) — models/trikNarrador.ts › distributeNarratorXp.
// O saldo é conferido DENTRO da transação, depois do lock na linha do
// narrador — senão duas distribuições simultâneas gastariam o mesmo saldo.
// Só o `db` é mockado.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockClient, mockDb } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() }
  const mockDb = { query: vi.fn(), connect: vi.fn() }
  return { mockClient, mockDb }
})

vi.mock('../config/database', () => ({ db: mockDb }))

import { distributeNarratorXp, NarratorDistributionError } from '../models/trikNarrador'

const NARRATOR = 'user-narrador'
const ADMIN    = 'user-admin'
const CHAR     = 'char-1'

const clientSqls = () => mockClient.query.mock.calls.map(c => (c[0] as string).trim())

function setupDb(opts: { earned: number; distributed: number; ownsCharacter?: boolean }) {
  mockClient.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM trik_characters WHERE id')) {
      return { rows: opts.ownsCharacter === false ? [] : [{ name: 'Kaelen' }] }
    }
    if (sql.includes('FROM trik_narrator_awards')) {
      return { rows: [{ earned: String(opts.earned), distributed: String(opts.distributed) }] }
    }
    if (sql.includes('FROM trik_character_progress') && sql.includes('FOR UPDATE')) {
      return { rows: [{ character_id: CHAR, level: 1, progress_xp: '0', points_conduct: 0, points_principles: 0, points_preferences: 0, has_goal: false }] }
    }
    if (sql.startsWith('UPDATE trik_character_progress')) return { rows: [{}] }
    return { rows: [] }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.connect.mockResolvedValue(mockClient)
})

describe('distributeNarratorXp', () => {
  it('dentro do saldo: trava o narrador, grava a distribuição, aplica o xp e faz COMMIT', async () => {
    setupDb({ earned: 100, distributed: 30 })

    const result = await distributeNarratorXp(NARRATOR, CHAR, 50, ADMIN)

    expect(result.characterName).toBe('Kaelen')
    expect(result.balance).toEqual({ earned: 100, distributed: 80, available: 20 })

    const sqls = clientSqls()
    const lock   = sqls.findIndex(s => s.includes('FROM users WHERE id') && s.includes('FOR UPDATE'))
    const saldo  = sqls.findIndex(s => s.includes('FROM trik_narrator_awards'))
    const insert = sqls.findIndex(s => s.startsWith('INSERT INTO trik_narrator_distributions'))
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(saldo)
    expect(saldo).toBeLessThan(insert)
    expect(sqls.at(-1)).toBe('COMMIT')
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('acima do saldo: recusa e faz ROLLBACK sem gravar nada', async () => {
    setupDb({ earned: 40, distributed: 0 })

    await expect(distributeNarratorXp(NARRATOR, CHAR, 41, ADMIN))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_XP' })

    const sqls = clientSqls()
    expect(sqls.some(s => s.startsWith('INSERT INTO trik_narrator_distributions'))).toBe(false)
    expect(sqls.at(-1)).toBe('ROLLBACK')
  })

  it('personagem de outro jogador: recusa', async () => {
    setupDb({ earned: 100, distributed: 0, ownsCharacter: false })

    const err = await distributeNarratorXp(NARRATOR, CHAR, 10, ADMIN).catch(e => e)
    expect(err).toBeInstanceOf(NarratorDistributionError)
    expect(err.code).toBe('NOT_NARRATOR_CHARACTER')
    expect(clientSqls().at(-1)).toBe('ROLLBACK')
  })
})
