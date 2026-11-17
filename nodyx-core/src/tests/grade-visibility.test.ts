import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// Visibilidade dos cargos : secreto nunca aparece ao público, a pessoa escolhe
// quais dos seus cargos mostra, e "separado no painel" (hoist) nunca vale para
// um cargo secreto (revelaria quem o tem).

vi.mock('../config/database', () => ({ db: { query: vi.fn(), connect: vi.fn() }, redis: {} }))

import { db } from '../config/database'
import { create, update, setMyBadges, listMine, visibleGradeJoin, visibleGradesJson } from '../models/grade'

const C = 'c1'
const U = '55555555-5555-4555-8555-555555555555'
const G1 = '11111111-aaaa-4aaa-8aaa-111111111111'
const G2 = '22222222-aaaa-4aaa-8aaa-222222222222'

const sql = (n = 0) => String(vi.mocked(db.query).mock.calls[n][0]).replace(/\s+/g, ' ').trim()
const params = (n = 0) => vi.mocked(db.query).mock.calls[n][1] as unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.query).mockResolvedValue({ rows: [{ id: G1 }], rowCount: 1 } as never)
})

describe('o filtro público de cargos', () => {
  it('só mostra cargo NÃO secreto que a pessoa escolheu mostrar', () => {
    for (const s of [visibleGradeJoin(), visibleGradesJson()]) {
      expect(s).toContain('NOT g.is_secret')
      expect(s).toContain('mg.show_badge')
    }
  })
  it('ordem estável : o cargo mais alto (position menor) primeiro', () => {
    expect(visibleGradeJoin()).toContain('ORDER BY g.position ASC, g.created_at ASC')
    expect(visibleGradesJson()).toContain('ORDER BY g.position ASC, g.created_at ASC')
  })
  it('o alias e o membro são configuráveis (cada consulta pública usa os seus)', () => {
    expect(visibleGradeJoin('g', 'cm')).toContain(') g ON true')
    expect(visibleGradesJson('m2')).toContain('mg.user_id = m2.user_id')
  })
})

describe('guarda : nenhuma consulta PÚBLICA junta o cargo principal cru', () => {
  // Um JOIN direto em cm.grade_id ignora is_secret e show_badge e vazaria o cargo secreto.
  // Estes arquivos servem dados ao público e devem usar visibleGradeJoin / visibleGradesJson.
  const PUBLIC_FILES = [
    'models/post.ts', 'models/community.ts', 'routes/instance.ts', 'services/mentionPeople.ts',
    'services/presenceGrades.ts', 'socket/index.ts',
  ]
  const src = (f: string) => readFileSync(path.join(__dirname, '..', f), 'utf8')

  it.each(PUBLIC_FILES)('%s usa o filtro de cargos visíveis', (f) => {
    const text = src(f)
    // O único JOIN cru permitido em community.ts é o do getMember interno (checagem de pertencimento)
    const raw = (text.match(/JOIN community_grades \w+ ON \w+\.id = cm\.grade_id/g) ?? [])
    const allowed = f === 'models/community.ts' ? 1 : 0
    expect(raw.length).toBeLessThanOrEqual(allowed)
    expect(text).toMatch(/visibleGrade(Join|sJson)/)
  })

  it('o perfil público (users.ts) usa o filtro; só o /me próprio vê o cargo principal cru', () => {
    const text = src('routes/users.ts')
    expect(text).toMatch(/visibleGradeJoin\('g', 'cm'\)/)
    expect((text.match(/JOIN community_grades \w+ ON \w+\.id = cm\.grade_id/g) ?? []).length).toBe(1) // o /me
  })
})

describe('criar e editar um cargo : separado × secreto', () => {
  it('criar secreto : nunca separado, mesmo se pedirem os dois', async () => {
    await create({ community_id: C, name: 'Fantasma', hoist: true, is_secret: true })
    const p = params()
    expect(p.at(-2)).toBe(false) // hoist
    expect(p.at(-1)).toBe(true)  // is_secret
  })
  it('criar um cargo normal separado', async () => {
    await create({ community_id: C, name: 'Mestres', hoist: true })
    expect(params().at(-2)).toBe(true)
    expect(params().at(-1)).toBe(false)
  })
  it('por padrão: nem separado nem secreto', async () => {
    await create({ community_id: C, name: 'Titulo' })
    expect(params().slice(-2)).toEqual([false, false])
  })
  it('tornar secreto desliga o separado no mesmo UPDATE', async () => {
    await update(G1, C, { is_secret: true })
    expect(sql()).toContain('is_secret = $1')
    expect(sql()).toContain('hoist = false')
  })
  it('separar um cargo (sem mexer no secreto) respeita o secreto que já está no banco', async () => {
    await update(G1, C, { hoist: true })
    expect(sql()).toContain('hoist = ($1 AND NOT is_secret)')
  })
  it('deixar de ser secreto e separar no mesmo pedido', async () => {
    await update(G1, C, { is_secret: false, hoist: true })
    expect(sql()).toContain('is_secret = $1')
    expect(sql()).toContain('hoist = $2')
    expect(sql()).not.toContain('hoist = false')
  })
})

describe('a pessoa escolhe quais cargos mostra', () => {
  it('só mexe nos cargos NÃO secretos, nos dela', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 2 } as never)
    expect(await setMyBadges(C, U, [G1])).toBe(2)
    expect(sql()).toContain('NOT g.is_secret')
    expect(sql()).toContain('show_badge = (mg.grade_id = ANY($3::uuid[]))')
    expect(params()).toEqual([C, U, [G1]])
  })
  it('lista vazia : esconde todos os cargos visíveis', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 3 } as never)
    await setMyBadges(C, U, [])
    expect(params()[2]).toEqual([])
  })
  it('a lista dela inclui os secretos (ela sabe que os tem), com a escolha de cada um', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [{ id: G1, is_secret: false, show_badge: true }, { id: G2, is_secret: true, show_badge: true }] } as never)
    const mine = await listMine(C, U)
    expect(mine.map(g => g.is_secret)).toEqual([false, true])
    expect(sql()).toContain('g.is_secret, mg.show_badge')
    expect(sql()).not.toContain('NOT g.is_secret')
  })
})
