import { describe, it, expect, vi, beforeEach } from 'vitest'

// Vários cargos por membro : setMemberGrades (conjunto completo, transacional),
// remove (o cargo principal passa ao próximo) e a volta dos cargos depois de um
// banimento temporário.

const redisCalls: unknown[][] = []
vi.mock('../config/database', () => ({
  db: { query: vi.fn(), connect: vi.fn() },
  redis: { incr: vi.fn(), del: vi.fn(async (...a: unknown[]) => { redisCalls.push(a) }), get: vi.fn(), setex: vi.fn() },
}))
vi.mock('../middleware/adminOnly', () => ({ getInstanceCommunityId: vi.fn().mockResolvedValue('c1') }))

import { db } from '../config/database'
import { setMemberGrades, remove } from '../models/grade'
import { restoreAfterBan } from '../services/octoguard/bans'

const C = 'c1'
const U = '55555555-5555-4555-8555-555555555555'
const G1 = '11111111-aaaa-4aaa-8aaa-111111111111' // position 0 (o mais alto)
const G2 = '22222222-aaaa-4aaa-8aaa-222222222222'
const G3 = '33333333-aaaa-4aaa-8aaa-333333333333'

type Call = { sql: string; params: unknown[] }
let calls: Call[]
let st: { member: { grade_id: string | null } | null; validRows: { id: string }[] }

function fakeClient() {
  return {
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ sql: s, params })
      if (s.startsWith('SELECT grade_id FROM community_members')) return { rows: st.member ? [st.member] : [] }
      if (s.startsWith('SELECT id, position, created_at FROM community_grades')) return { rows: st.validRows }
      return { rows: [], rowCount: 1 }
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks(); calls = []; redisCalls.length = 0
  st = { member: { grade_id: G1 }, validRows: [] }
  vi.mocked(db.connect).mockImplementation((async () => fakeClient()) as never)
})

const has = (prefix: string) => calls.some(c => c.sql.startsWith(prefix))
const primaryWritten = () => calls.find(c => c.sql.startsWith('UPDATE community_members SET grade_id'))?.params[2]

describe('setMemberGrades', () => {
  it('membro desconhecido : não encontrado, nada é escrito', async () => {
    st.member = null
    expect(await setMemberGrades(C, U, [G1])).toEqual({ found: false, gradeValid: true })
    expect(has('ROLLBACK')).toBe(true)
    expect(has('DELETE FROM member_grades')).toBe(false)
  })

  it('cargo de outra comunidade (ou inexistente) : inválido, nada é escrito', async () => {
    st.validRows = [{ id: G1 }] // pediu 2, só 1 é desta comunidade
    expect(await setMemberGrades(C, U, [G1, G2])).toEqual({ found: true, gradeValid: false })
    expect(has('ROLLBACK')).toBe(true)
    expect(has('DELETE FROM member_grades')).toBe(false)
    expect(has('INSERT INTO member_grades')).toBe(false)
  })

  it('grava o conjunto inteiro numa transação', async () => {
    st.validRows = [{ id: G1 }, { id: G2 }]
    expect(await setMemberGrades(C, U, [G2, G1])).toEqual({ found: true, gradeValid: true })
    expect(calls[0].sql).toBe('BEGIN')
    expect(calls.at(-1)!.sql).toBe('COMMIT')
    const del = calls.find(c => c.sql.startsWith('DELETE FROM member_grades'))!
    expect(del.params).toEqual([C, U, [G2, G1]]) // apaga o que não está no conjunto
    expect(has('INSERT INTO member_grades')).toBe(true)
  })

  it('o cargo principal continua o mesmo se ainda está no conjunto', async () => {
    st.member = { grade_id: G2 }
    st.validRows = [{ id: G1 }, { id: G2 }]
    await setMemberGrades(C, U, [G1, G2])
    expect(primaryWritten()).toBe(G2)
  })

  it('o principal saiu do conjunto : vira o de menor position', async () => {
    st.member = { grade_id: G3 }
    st.validRows = [{ id: G1 }, { id: G2 }] // a query já vem ordenada por position
    await setMemberGrades(C, U, [G2, G1])
    expect(primaryWritten()).toBe(G1)
  })

  it('conjunto vazio : apaga todos e fica sem cargo principal', async () => {
    expect(await setMemberGrades(C, U, [])).toEqual({ found: true, gradeValid: true })
    expect(primaryWritten()).toBeNull()
    expect(has('INSERT INTO member_grades')).toBe(false)
  })

  it('ids repetidos contam uma vez só', async () => {
    st.validRows = [{ id: G1 }]
    expect(await setMemberGrades(C, U, [G1, G1, G1])).toEqual({ found: true, gradeValid: true })
  })

  it('erro no meio : ROLLBACK, o erro sobe e a conexão é devolvida', async () => {
    const client = fakeClient()
    client.query.mockImplementation((async (sql: string) => {
      if (String(sql).startsWith('SELECT grade_id')) throw new Error('boom')
      return { rows: [] }
    }) as never)
    vi.mocked(db.connect).mockResolvedValue(client as never)
    await expect(setMemberGrades(C, U, [G1])).rejects.toThrow('boom')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })
})

describe('remove (apagar um cargo)', () => {
  it('antes de apagar, quem o tinha como principal passa a exibir o próximo cargo', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
    expect(await remove(G1, C)).toBe(true)
    const [promote, del] = vi.mocked(db.query).mock.calls
    expect(String(promote[0])).toContain('UPDATE community_members cm SET grade_id = (')
    expect(String(promote[0])).toContain('mg.grade_id    <> $1::uuid')
    expect(promote[1]).toEqual([G1, C])
    expect(String(del[0])).toContain('DELETE FROM community_grades')
  })
})

describe('volta de um banimento temporário', () => {
  const lifted = (over: Record<string, unknown> = {}) => [{
    user_id: U, community_id: C, prev_role: 'member', prev_grade_id: G1, prev_grade_ids: [G1, G2],
    prev_joined_at: '2025-03-01 10:00:00', ...over,
  }]

  it('devolve todos os cargos, só os que ainda existem nesta comunidade', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
    await restoreAfterBan(lifted() as never)
    const sqls = vi.mocked(db.query).mock.calls.map(c => String(c[0]).replace(/\s+/g, ' '))
    const mg = vi.mocked(db.query).mock.calls.find(c => String(c[0]).includes('INSERT INTO member_grades'))!
    expect(sqls.some(s => s.includes('INSERT INTO community_members'))).toBe(true)
    expect(String(mg[0])).toContain('g.community_id = $1')
    expect(mg[1]).toEqual([C, U, [G1, G2]])
  })

  it('a pessoa já voltou por conta própria (linha de membro existente) : nada é devolvido', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    await restoreAfterBan(lifted() as never)
    const sqls = vi.mocked(db.query).mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('INSERT INTO member_grades'))).toBe(false)
  })

  it('ban sem lista de cargos (linha antiga) : só o cargo principal volta, como antes', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
    await restoreAfterBan(lifted({ prev_grade_ids: null }) as never)
    const sqls = vi.mocked(db.query).mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('INSERT INTO member_grades'))).toBe(false)
  })
})
