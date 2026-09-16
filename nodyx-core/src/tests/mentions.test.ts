// ─── resolveMentions : plafond + périmètre communauté ───────────────────────
//
// Trouvé en audit de la couche temps réel le 16/09 : un seul message pouvait
// porter un nombre illimité de mentions distinctes, chacune déclenchant un
// fetchSockets + un INSERT + un COUNT + un SELECT + un Web Push — un compte
// membre ordinaire pouvait ainsi amplifier un seul message en dizaines de
// milliers de requêtes. La résolution n'était pas non plus scopée à la
// communauté du canal : un utilisateur exclu pouvait quand même être notifié.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbQuery = vi.fn()
vi.mock('../config/database', () => ({
	db: { query: (...a: unknown[]) => dbQuery(...a) },
}))

beforeEach(() => {
	dbQuery.mockReset()
})

describe('resolveMentions', () => {
	it('ne dépasse jamais MAX_MENTIONS_PER_MESSAGE quel que soit le nombre de @mentions dans le texte', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [] })

		const manyMentions = Array.from({ length: 1000 }, (_, i) => `@user${i}`).join(' ')
		await resolveMentions(manyMentions, 'community-1')

		expect(dbQuery).toHaveBeenCalledTimes(1)
		const [, params] = dbQuery.mock.calls[0] as [string, [string[], string]]
		const usernamesQueried = params[0]
		expect(usernamesQueried.length).toBeLessThanOrEqual(20)
	})

	it('scope la résolution à la communauté fournie', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [{ id: 'user-a' }] })

		await resolveMentions('salut @alice', 'community-42')

		const [sql, params] = dbQuery.mock.calls[0] as [string, [string[], string]]
		expect(sql).toMatch(/community_members/)
		expect(sql).toMatch(/cm\.community_id\s*=\s*\$2/)
		expect(params[1]).toBe('community-42')
	})

	it("ne fait aucune requête DB s'il n'y a aucune mention", async () => {
		const { resolveMentions } = await import('../utils/mentions')
		const result = await resolveMentions('aucune mention ici', 'community-1')
		expect(result).toEqual([])
		expect(dbQuery).not.toHaveBeenCalled()
	})

	it('déduplique les mentions répétées avant de plafonner', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [] })

		await resolveMentions('@bob @bob @bob @bob', 'community-1')

		const [, params] = dbQuery.mock.calls[0] as [string, [string[], string]]
		expect(params[0]).toEqual(['bob'])
	})
})
