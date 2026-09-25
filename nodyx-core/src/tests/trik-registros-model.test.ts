// Módulo RPG (trik) — models/trik.ts › listRegistros (tabela de registros do
// admin). Só o `db` é mockado: duas queries (jogadores e personagens) que a
// função agrupa em memória.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({ mockDb: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../config/database', () => ({ db: mockDb }))

import { listRegistros, updateRegistroPlayer, updateRegistroCharacter } from '../models/trik'

const PLAYER_A = { id: 'pa', username: 'orfeus', name: 'Orfeu', pronouns: 'ele/dele', birth_date: '2000-09-22', permit_active: false, created_at: '2026-09-20T15:52:26.657Z' }
const PLAYER_B = { id: 'pb', username: 'sem_personagem', name: 'Ninguém', pronouns: null, birth_date: null, permit_active: false, created_at: '2026-09-19T10:00:00.000Z' }

const character = (over: Record<string, unknown>) => ({
  id: 'c1', player_id: 'pa', name: 'Jahzell', pronouns: null, birth_date: '1999-09-03',
  faceclaim_name: null, faceclaim_birth_date: null, ficha_link: 'https://exemplo.test/ficha',
  pantheon: null, divine_bond: null, divine_gift: null,
  conduct_presenca: 0, conduct_proposito: 1, conduct_sangue: 0,
  principles_mente: 1, principles_coracao: 1, principles_corpo: 0,
  template_name: null, template_signature: null,
  created_at: '2026-09-20T15:52:26.660Z', last_active_at: '2026-09-20T15:52:26.660Z',
  level: 1, progress_xp: '0', goal_xp: '500',
  ...over,
})

/** 1ª query = jogadores, 2ª = personagens (a ordem do Promise.all). */
function mockRows(players: unknown[], characters: unknown[]) {
  mockDb.query
    .mockResolvedValueOnce({ rows: players })
    .mockResolvedValueOnce({ rows: characters })
}

beforeEach(() => vi.clearAllMocks())

describe('listRegistros', () => {
  it('agrupa os personagens no jogador certo e tira o player_id da linha', async () => {
    mockRows(
      [PLAYER_A, PLAYER_B],
      [character({ id: 'c1', name: 'Jahzell' }), character({ id: 'c2', name: 'Segundo' })],
    )

    const [a, b] = await listRegistros()

    expect(a.username).toBe('orfeus')
    expect(a.characters.map(c => c.name)).toEqual(['Jahzell', 'Segundo'])
    expect(a.characters[0]).not.toHaveProperty('player_id')
    expect(b.characters).toEqual([]) // jogador sem personagem continua na lista
  })

  it('converte xp (BIGINT vem como string do pg) pra número e mantém null quando é nível máximo', async () => {
    mockRows([PLAYER_A], [
      character({ id: 'c1', level: 2, progress_xp: '120', goal_xp: '750' }),
      character({ id: 'c2', level: 4, progress_xp: '9000', goal_xp: null }),
    ])

    const [{ characters }] = await listRegistros()

    expect(characters[0]).toMatchObject({ level: 2, progress_xp: 120, goal_xp: 750 })
    expect(characters[1]).toMatchObject({ level: 4, progress_xp: 9000, goal_xp: null })
  })

  it('personagem sem linha de progresso entra como nível 1 / 0 xp (COALESCE no SQL)', async () => {
    mockRows([PLAYER_A], [character({ level: 1, progress_xp: '0' })])

    const [{ characters }] = await listRegistros()

    expect(characters[0]).toMatchObject({ level: 1, progress_xp: 0 })
    const characterSql = mockDb.query.mock.calls[1][0] as string
    expect(characterSql).toContain('COALESCE(g.level, 1)')
    expect(characterSql).toContain('COALESCE(g.progress_xp, 0)')
  })

  it('datas DATE saem como texto no SQL (Date do pg deslocaria o dia no JSON)', async () => {
    mockRows([], [])

    await listRegistros()

    const [playersSql, charactersSql] = mockDb.query.mock.calls.map(c => c[0] as string)
    expect(playersSql).toContain('p.birth_date::text')
    expect(charactersSql).toContain('c.birth_date::text')
    expect(charactersSql).toContain('c.faceclaim_birth_date::text')
  })

  it('sem nada cadastrado → lista vazia', async () => {
    mockRows([], [])
    expect(await listRegistros()).toEqual([])
  })
})

// ─── PATCH de um registro ────────────────────────────────────────────────────
// O SET é montado por concatenação a partir de uma whitelist, então o que
// importa testar aqui é: (a) só as chaves presentes viram coluna, (b) a
// numeração dos placeholders não colide com o $1 do id, (c) chave desconhecida
// não vira SQL.

/** Última chamada a db.query, como { sql, params } — mais `set`, só a cláusula
 *  SET, porque o `WHERE id = $1` contém "id = $" e envenenaria um not.toContain. */
function lastQuery() {
  const [raw, params] = mockDb.query.mock.calls.at(-1)!
  const sql = String(raw).replace(/\s+/g, ' ')
  const set = sql.slice(sql.indexOf('SET '), sql.indexOf(' WHERE '))
  return { sql, set, params }
}

describe('updateRegistroPlayer', () => {
  it('escreve só os campos presentes, com o id em $1', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ ...PLAYER_A, name: 'Orfeu Novo' }] })

    await updateRegistroPlayer('pa', { name: 'Orfeu Novo', pronouns: null })

    const { sql, params } = lastQuery()
    expect(sql).toContain('SET name = $2, pronouns = $3, updated_at = NOW()')
    expect(sql).not.toContain('birth_date =')
    expect(sql).not.toContain('permit_active =')
    expect(params).toEqual(['pa', 'Orfeu Novo', null])
  })

  it('grava o Passe sozinho (o botão da tela manda só isso)', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ ...PLAYER_A, permit_active: true }] })

    const player = await updateRegistroPlayer('pa', { permitActive: true })

    const { sql, params } = lastQuery()
    expect(sql).toContain('SET permit_active = $2')
    expect(params).toEqual(['pa', true])
    expect(player!.permit_active).toBe(true)
  })

  it('ignora chave fora da whitelist', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [PLAYER_A] })

    await updateRegistroPlayer('pa', { name: 'X', id: 'outro', permit_active: true } as never)

    const { set, params } = lastQuery()
    expect(set).toBe('SET name = $2, updated_at = NOW()')
    expect(params).toEqual(['pa', 'X'])
  })

  it('devolve null quando o jogador não existe', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] })
    expect(await updateRegistroPlayer('nao-existe', { name: 'X' })).toBeNull()
  })

  it('devolve o jogador atual, sem UPDATE, se o patch vier vazio', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [PLAYER_A] })

    await updateRegistroPlayer('pa', {})

    expect(lastQuery().sql).toContain('SELECT * FROM trik_players WHERE id = $1')
  })
})

describe('updateRegistroCharacter', () => {
  it('mapeia camelCase pra coluna e devolve as datas como texto', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [character({ faceclaim_name: 'Alguem' })] })

    await updateRegistroCharacter('c1', {
      faceclaimName: 'Alguem',
      faceclaimBirthDate: '1990-01-02',
      fichaLink: 'https://exemplo.test/nova',
      divineBond: null,
    })

    const { sql, params } = lastQuery()
    expect(sql).toContain(
      'SET faceclaim_name = $2, faceclaim_birth_date = $3, ficha_link = $4, divine_bond = $5',
    )
    expect(params).toEqual(['c1', 'Alguem', '1990-01-02', 'https://exemplo.test/nova', null])
    expect(sql).toContain('birth_date::text AS birth_date')
    expect(sql).toContain('faceclaim_birth_date::text AS faceclaim_birth_date')
  })

  it('não deixa editar conduta/princípios/plaquinha por aqui', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [character({})] })

    await updateRegistroCharacter('c1', {
      name: 'Novo',
      conduct_presenca: 9,
      principles_mente: 9,
      template_name: 'burla',
    } as never)

    const { sql, params } = lastQuery()
    expect(sql).toContain('SET name = $2, updated_at = NOW()')
    expect(sql).not.toContain('conduct_presenca =')
    expect(sql).not.toContain('principles_mente =')
    expect(sql).not.toContain('template_name =')
    expect(params).toEqual(['c1', 'Novo'])
  })

  it('devolve null quando o personagem não existe', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] })
    expect(await updateRegistroCharacter('nao-existe', { name: 'X' })).toBeNull()
  })
})
