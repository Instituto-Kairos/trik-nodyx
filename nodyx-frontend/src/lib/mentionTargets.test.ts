// ─── Alvos de menção: membros + aliases de personagem ────────────────────────
//
// O compositor do chat e o do fórum compartilham esta busca justamente para não
// divergirem. E ela precisa sobreviver a um módulo RPG desligado: `/trik/aliases`
// responde 503 nesse caso, e o autocomplete de sempre não pode quebrar por isso.

import { describe, it, expect, vi } from 'vitest'
import {
	searchMentionTargets,
	mentionInsertText,
	mentionLabel,
	type ApiFetch,
	type MentionTarget,
} from './mentionTargets'

/** Resposta JSON mínima, no formato que o fetch do browser devolveria. */
const ok = (body: unknown) =>
	({ ok: true, json: async () => body }) as unknown as Response
const erro = (status: number) =>
	({ ok: false, status, json: async () => ({}) }) as unknown as Response

const MEMBROS = { members: [{ username: 'rafael', avatar: null }] }
const ALIASES = {
	aliases: [
		{ alias: 'Kaelen Duvray', username: 'rafael', player_name: 'Rafael', avatar: null },
	],
}

/** Roteia por prefixo de caminho, como o backend faria. */
function apiFalso(rotas: Record<string, () => Response>): { api: ApiFetch; pedidos: string[] } {
	const pedidos: string[] = []
	const api: ApiFetch = async (path) => {
		pedidos.push(path)
		const chave = Object.keys(rotas).find((k) => path.startsWith(k))
		if (!chave) throw new Error(`rota não mapeada: ${path}`)
		return rotas[chave]()
	}
	return { api, pedidos }
}

describe('mentionInsertText — o que entra no compositor', () => {
	it('membro vira menção simples', () => {
		expect(mentionInsertText({ username: 'rafael', avatar: null })).toBe('@rafael')
	})

	it('alias vira a forma com nome exibido e jogador por trás', () => {
		expect(
			mentionInsertText({ username: 'rafael', avatar: null, alias: 'Kaelen Duvray' }),
		).toBe('@[Kaelen Duvray](rafael)')
	})
})

describe('mentionLabel — a validação combinada', () => {
	it('mostra personagem E jogador, que é o que desfaz a ambiguidade', () => {
		expect(
			mentionLabel({ username: 'rafael', avatar: null, alias: 'Kaelen', playerName: 'Rafael' }),
		).toBe('Kaelen · Rafael')
	})

	it('cai no username quando o jogador não tem nome OOC', () => {
		expect(mentionLabel({ username: 'rafael', avatar: null, alias: 'Kaelen' })).toBe('Kaelen · rafael')
	})
})

describe('searchMentionTargets', () => {
	it('junta membros e aliases, membros primeiro', async () => {
		const { api } = apiFalso({ '/chat/members': () => ok(MEMBROS), '/trik/aliases': () => ok(ALIASES) })
		const r = await searchMentionTargets(api, 'ka')
		expect(r).toHaveLength(2)
		expect(r[0].username).toBe('rafael')
		expect(r[0].alias).toBeUndefined()
		expect(r[1]).toMatchObject({ username: 'rafael', alias: 'Kaelen Duvray', playerName: 'Rafael' })
	})

	it('módulo RPG desligado (503) devolve só os membros', async () => {
		// O caso que importa: um módulo desligado não pode quebrar o compositor.
		const { api } = apiFalso({ '/chat/members': () => ok(MEMBROS), '/trik/aliases': () => erro(503) })
		const r = await searchMentionTargets(api, 'ra')
		expect(r).toEqual([{ username: 'rafael', avatar: null }])
	})

	it('a falha de uma busca não derruba a outra', async () => {
		const { api } = apiFalso({
			'/chat/members': () => { throw new Error('rede caiu') },
			'/trik/aliases': () => ok(ALIASES),
		})
		const r = await searchMentionTargets(api, 'ka')
		expect(r).toHaveLength(1)
		expect(r[0].alias).toBe('Kaelen Duvray')
	})

	it('JSON malformado não propaga exceção', async () => {
		const quebrado = { ok: true, json: async () => { throw new Error('json inválido') } } as unknown as Response
		const { api } = apiFalso({ '/chat/members': () => quebrado, '/trik/aliases': () => ok(ALIASES) })
		await expect(searchMentionTargets(api, 'ka')).resolves.toHaveLength(1)
	})

	it('as duas buscam em paralelo, com o termo escapado', async () => {
		const { api, pedidos } = apiFalso({ '/chat/members': () => ok(MEMBROS), '/trik/aliases': () => ok(ALIASES) })
		await searchMentionTargets(api, 'Astërion & cia')
		expect(pedidos).toHaveLength(2)
		for (const p of pedidos) expect(p).toContain('Ast%C3%ABrion%20%26%20cia')
	})

	it('respeita o limite somando as duas fontes', async () => {
		const muitos = { members: Array.from({ length: 12 }, (_, i) => ({ username: `u${i}`, avatar: null })) }
		const { api } = apiFalso({ '/chat/members': () => ok(muitos), '/trik/aliases': () => ok(ALIASES) })
		expect(await searchMentionTargets(api, 'u', undefined, 8)).toHaveLength(8)
	})

	it('manda o token quando há um', async () => {
		const espia = vi.fn(async () => ok(MEMBROS)) as unknown as ApiFetch
		await searchMentionTargets(espia, 'ka', 'jeton-123')
		const chamadas = (espia as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
		for (const [, init] of chamadas) {
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jeton-123')
		}
	})

	it('resposta vazia das duas fontes devolve lista vazia, não erro', async () => {
		const { api } = apiFalso({ '/chat/members': () => ok({}), '/trik/aliases': () => ok({}) })
		expect(await searchMentionTargets(api, 'zzz')).toEqual([] as MentionTarget[])
	})
})
