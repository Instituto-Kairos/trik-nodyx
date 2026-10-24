// Módulo RPG (trik) — Universo Alternativo (trik_013): o que separa os dois
// universos nas buscas de menção e na galeria. Só o `db` é mockado.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({ mockDb: { query: vi.fn() } }))
vi.mock('../config/database', () => ({ db: mockDb }))
vi.mock('sharp', () => ({ default: vi.fn() }))

import { isAuCategory, createAuAlias, deleteAuAlias } from '../models/trikAu'
import { searchNpccThreads, searchNpcImages } from '../models/trik'
import { listImages } from '../services/galeriaService'

beforeEach(() => { mockDb.query.mockReset() })

describe('isAuCategory', () => {
  it('sem categoria (chat) é o universo principal, sem ir ao banco', async () => {
    expect(await isAuCategory(undefined)).toBe(false)
    expect(mockDb.query).not.toHaveBeenCalled()
  })

  it('sobe pelos ancestrais até uma raiz AU', async () => {
    mockDb.query.mockResolvedValue({ rows: [{ au: true }] })
    expect(await isAuCategory('sub')).toBe(true)
    const [sql, params] = mockDb.query.mock.calls[0]
    expect(sql).toContain('JOIN up ON c.id = up.parent_id')
    expect(sql).toContain('trik_au_categories')
    expect(params).toEqual(['sub'])
  })
})

describe('aliases AU', () => {
  it('nome repetido (ON CONFLICT) volta null', async () => {
    mockDb.query.mockResolvedValue({ rows: [] })
    expect(await createAuAlias('u1', 'Kael')).toBeNull()
  })

  it('apagar é escopado pelo dono', async () => {
    mockDb.query.mockResolvedValue({ rowCount: 0 })
    expect(await deleteAuAlias('u1', 'a1')).toBe(false)
    const [sql, params] = mockDb.query.mock.calls[0]
    expect(sql).toContain('user_id = $2')
    expect(params).toEqual(['a1', 'u1'])
  })
})

describe('NPCC/NPC por universo', () => {
  it('NPCC filtra pela subárvore AU nos dois sentidos', async () => {
    mockDb.query.mockResolvedValue({ rows: [] })
    await searchNpccThreads('c1', '', 8, true)
    await searchNpccThreads('c1', '')
    const [[sqlAu, pAu], [, pMain]] = mockDb.query.mock.calls
    expect(sqlAu).toContain('(t.category_id IN (SELECT id FROM au_tree)) = $5')
    expect(pAu[4]).toBe(true)
    expect(pMain[4]).toBe(false)
  })

  it('no AU aceita nome com sufixo ("NPCCs AU"); o principal segue exato', async () => {
    mockDb.query.mockResolvedValue({ rows: [] })
    await searchNpccThreads('c1', '', 8, true)
    await searchNpcImages('c1', '', 8, true)
    const [[sqlNpcc], [sqlNpc]] = mockDb.query.mock.calls
    expect(sqlNpcc).toContain("($5 AND LOWER(name) LIKE 'npcc%')")
    expect(sqlNpc).toContain("($5 AND LOWER(a.name) LIKE 'npc%')")
  })

  it('NPC usa só álbuns do universo pedido', async () => {
    mockDb.query.mockResolvedValue({ rows: [] })
    await searchNpcImages('c1', '', 8, true)
    const [sql, params] = mockDb.query.mock.calls[0]
    expect(sql).toContain('a.is_au = $5')
    expect(params[4]).toBe(true)
  })
})

describe('galeria — visão "Todas"', () => {
  const vazio = () => mockDb.query.mockResolvedValue({ rows: [{ n: '0' }] })

  it('sem filtro esconde imagens de álbum AU', async () => {
    vazio()
    await listImages({ communityId: 'c1' })
    expect(mockDb.query.mock.calls[0][0]).toContain('NOT EXISTS (SELECT 1 FROM galeria_albums ax')
  })

  it('"Ver AU" traz só as de álbum AU', async () => {
    vazio()
    await listImages({ communityId: 'c1', au: true })
    const sql = mockDb.query.mock.calls[0][0] as string
    expect(sql).toContain('EXISTS (SELECT 1 FROM galeria_albums ax')
    expect(sql).not.toContain('NOT EXISTS')
  })

  it('álbum escolhido mostra tudo dele, AU ou não', async () => {
    vazio()
    await listImages({ communityId: 'c1', albumId: 'a1' })
    expect(mockDb.query.mock.calls[0][0]).not.toContain('galeria_albums ax')
  })
})
