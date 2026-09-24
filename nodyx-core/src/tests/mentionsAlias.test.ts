// ─── resolveMentions : alias de personagem `@[Nome](username)` ───────────────
//
// Marcar um personagem numa cena de RPG tem de notificar O JOGADOR por trás
// dele. O nome entre colchetes é rótulo; o alvo é sempre o username entre
// parênteses — um alias é um apelido DO JOGADOR, não uma entidade mencionável à
// parte, então nada precisa ser desambiguado aqui (quem escolheu no
// autocomplete já validou o par "personagem · jogador").
//
// O formato é duplicado no cliente, em nodyx-frontend/src/lib/linkify.ts, que é
// quem o renderiza. Bundles separados, sem módulo comum: estes testes fixam
// este lado, os de lá fixam o outro.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbQuery = vi.fn()
vi.mock('../config/database', () => ({
	db: { query: (...a: unknown[]) => dbQuery(...a) },
}))

beforeEach(() => {
	dbQuery.mockReset()
})

/** Os usernames que resolveMentions levou à base, na ordem em que os pediu. */
async function usernamesConsultados(texto: string): Promise<string[]> {
	const { resolveMentions } = await import('../utils/mentions')
	dbQuery.mockResolvedValueOnce({ rows: [] })
	await resolveMentions(texto, 'community-1')
	if (dbQuery.mock.calls.length === 0) return []
	const [, params] = dbQuery.mock.calls[0] as [string, [string[], string]]
	return params[0]
}

describe('resolveMentions — alias de personagem', () => {
	it('notifica o jogador entre parênteses, não o nome do personagem', async () => {
		expect(await usernamesConsultados('@[Kaelen Duvray](rafael) saca a lâmina.'))
			.toEqual(['rafael'])
	})

	it('aceita espaços e acentos, que a forma simples não alcança', async () => {
		// `@Astërion` casaria só como "Ast" em /@([\w\-]{2,30})/ (\w sem flag u não
		// pega acento) — é por isso que o alias é delimitado por colchetes.
		expect(await usernamesConsultados('@[Astërion, o Pálido](joana) observa.'))
			.toEqual(['joana'])
	})

	it('resolve as duas formas na mesma frase, sem duplicar', async () => {
		const u = await usernamesConsultados('@[Kaelen](rafael) responde a @joana e a @rafael')
		expect(u.sort()).toEqual(['joana', 'rafael'])
	})

	it('a forma de alias não vira uma menção simples por acidente', async () => {
		// Em `@[Kaelen](rafael)` o caractere após o `@` é `[`, que não é `\w`:
		// MENTION_RE não casa nada ali. Se casasse, "Kaelen" entraria como se
		// fosse um username e a busca notificaria a pessoa errada.
		const u = await usernamesConsultados('@[Kaelen](rafael)')
		expect(u).not.toContain('kaelen')
		expect(u).toEqual(['rafael'])
	})

	it('normaliza para minúsculas, como a forma simples', async () => {
		expect(await usernamesConsultados('@[Kaelen](Rafael)')).toEqual(['rafael'])
	})

	it('ignora alias mal formado', async () => {
		for (const cru of ['@[](rafael)', '@[Kaelen]()', '@[Kaelen] (rafael)']) {
			const u = await usernamesConsultados(cru)
			expect(u, cru).not.toContain('rafael')
		}
	})

	it('respeita o plafond somando as duas formas', async () => {
		// O plafond existe porque cada mention distinta custa fetchSockets +
		// INSERT + COUNT + SELECT + Web Push (audit de 16/09). O alias não pode
		// ser uma porta para furá-lo.
		const muitos = Array.from({ length: 40 }, (_, i) => `@[P${i}](user${i})`).join(' ')
		const u = await usernamesConsultados(`${muitos} e mais @outro1 @outro2`)
		expect(u.length).toBeLessThanOrEqual(20)
	})

	it('dá precedência ao alias quando o plafond aperta', async () => {
		// Numa cena, o alias é a forma dominante: se algo tiver de ser cortado,
		// que sejam as menções OOC do fim, não os personagens da cena.
		const aliases = Array.from({ length: 20 }, (_, i) => `@[P${i}](player${i})`).join(' ')
		const u = await usernamesConsultados(`${aliases} @fulano @beltrano`)
		expect(u).toHaveLength(20)
		expect(u).toContain('player0')
		expect(u).toContain('player19')
		expect(u).not.toContain('fulano')
	})

	it('sem menção alguma, não toca a base', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		expect(await resolveMentions('Kaelen saca a lâmina, sem marcar ninguém.', 'c1')).toEqual([])
		expect(dbQuery).not.toHaveBeenCalled()
	})

	it('mantém o escopo de comunidade e a exclusão de bots', async () => {
		// Garde-fou do upstream (audit 16/09): a consulta filtra por
		// community_members e is_system. O alias não pode contornar isso.
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [] })
		await resolveMentions('@[Kaelen](rafael)', 'community-42')
		const [sql, params] = dbQuery.mock.calls[0] as [string, [string[], string]]
		expect(sql).toContain('community_members')
		expect(sql).toContain('is_system = false')
		expect(params[1]).toBe('community-42')
	})
})
