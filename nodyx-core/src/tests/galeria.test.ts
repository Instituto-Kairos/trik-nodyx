// ─── Galeria: slug de álbum e forma da listagem ──────────────────────────────
//
// O slug entra numa restrição UNIQUE (community_id, slug), então precisa ser
// determinístico e seguro para URL a partir de um nome que os jogadores digitam
// livremente — com acento, pontuação e emoji.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbQuery = vi.fn()
vi.mock('../config/database', () => ({
	db: { query: (...a: unknown[]) => dbQuery(...a) },
}))
// sharp não é exercitado aqui (nenhum teste sobe imagem), mas o módulo o importa.
vi.mock('sharp', () => ({ default: vi.fn() }))

beforeEach(() => { dbQuery.mockReset() })

describe('slugify', () => {
	it('tira acento, baixa a caixa e junta com hífen', async () => {
		const { slugify } = await import('../services/galeriaService')
		expect(slugify('Cena da Taverna')).toBe('cena-da-taverna')
		expect(slugify('Astërion, o Pálido')).toBe('asterion-o-palido')
	})

	it('não deixa hífen sobrando nas pontas nem repetido', async () => {
		const { slugify } = await import('../services/galeriaService')
		expect(slugify('  --- Mapas!!! ---  ')).toBe('mapas')
		expect(slugify('Ato 1 // Ato 2')).toBe('ato-1-ato-2')
	})

	it('nome só de emoji ainda produz um slug utilizável', async () => {
		// Sem o repli, o slug sairia vazio e a UNIQUE (community_id, '') deixaria
		// criar apenas UM álbum desse tipo na comunidade inteira.
		const { slugify } = await import('../services/galeriaService')
		expect(slugify('🗺️🗺️')).toBe('album')
		expect(slugify('')).toBe('album')
	})

	it('corta em 90 caracteres, com folga para o sufixo de colisão', async () => {
		const { slugify } = await import('../services/galeriaService')
		// A coluna é VARCHAR(100); o desempate acrescenta "-2".."-10" ou 6 hex.
		expect(slugify('a'.repeat(200)).length).toBe(90)
	})
})

describe('createAlbum — colisão de slug', () => {
	it('usa o slug base quando está livre', async () => {
		const { createAlbum } = await import('../services/galeriaService')
		dbQuery
			.mockResolvedValueOnce({ rows: [] })                              // slug livre
			.mockResolvedValueOnce({ rows: [{ id: 'a1', slug: 'retratos' }] }) // insert
		await createAlbum({ communityId: 'c1', name: 'Retratos', createdBy: 'u1' })
		const [, params] = dbQuery.mock.calls[1] as [string, unknown[]]
		expect(params[2]).toBe('retratos')
	})

	it('desempata com sufixo quando o slug já existe', async () => {
		const { createAlbum } = await import('../services/galeriaService')
		dbQuery
			.mockResolvedValueOnce({ rows: [{ x: 1 }] })  // 'retratos' ocupado
			.mockResolvedValueOnce({ rows: [] })          // 'retratos-2' livre
			.mockResolvedValueOnce({ rows: [{ id: 'a2' }] })
		await createAlbum({ communityId: 'c1', name: 'Retratos', createdBy: 'u1' })
		const [, params] = dbQuery.mock.calls[2] as [string, unknown[]]
		expect(params[2]).toBe('retratos-2')
	})
})

describe('listImages — filtros', () => {
	const okVazio = () => { dbQuery.mockResolvedValue({ rows: [{ n: '0' }] }) }

	it('sempre escopa pela comunidade', async () => {
		const { listImages } = await import('../services/galeriaService')
		okVazio()
		await listImages({ communityId: 'c1' })
		const [sql, params] = dbQuery.mock.calls[0] as [string, unknown[]]
		expect(sql).toContain('i.community_id = $1')
		expect(params[0]).toBe('c1')
	})

	it('"sem álbum" filtra por IS NULL, não por id', async () => {
		const { listImages } = await import('../services/galeriaService')
		okVazio()
		await listImages({ communityId: 'c1', semAlbum: true })
		const [sql] = dbQuery.mock.calls[0] as [string]
		expect(sql).toContain('i.album_id IS NULL')
	})

	it('a tag vira ANY(tags), parametrizada', async () => {
		const { listImages } = await import('../services/galeriaService')
		okVazio()
		await listImages({ communityId: 'c1', tag: 'kaelen' })
		const [sql, params] = dbQuery.mock.calls[0] as [string, unknown[]]
		expect(sql).toContain('= ANY(i.tags)')
		expect(params).toContain('kaelen')
	})

	it('limite é travado em 100, mesmo se pedirem mais', async () => {
		// Sem o teto, `?limit=100000` viraria um dump da galeria inteira numa
		// requisição.
		const { listImages } = await import('../services/galeriaService')
		okVazio()
		await listImages({ communityId: 'c1', limit: 100000 })
		const [sql] = dbQuery.mock.calls[0] as [string]
		expect(sql).toContain('LIMIT 100')
	})

	it('offset negativo não vira SQL inválido', async () => {
		const { listImages } = await import('../services/galeriaService')
		okVazio()
		await listImages({ communityId: 'c1', offset: -50 })
		const [sql] = dbQuery.mock.calls[0] as [string]
		expect(sql).toContain('OFFSET 0')
	})
})
