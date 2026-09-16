// ─── Toute clé appelée à checkRateLimit() doit exister dans RATE_RULES ──────
//
// Trouvé en audit de la couche temps réel le 16/09 : checkRateLimit(userId,
// eventKey) renvoie 0 (toujours autorisé) quand `eventKey` n'a pas d'entrée
// dans RATE_RULES (rateLimiter.ts:74-75, "Pas de règle → toujours autorisé").
// C'est un choix de conception légitime pour les events qui n'appellent
// JAMAIS checkRateLimit — mais pour un event qui L'APPELLE, une clé absente
// du catalogue est TOUJOURS une faute de frappe ou une règle oubliée : le
// code compile, s'exécute, se lit comme une protection, et ne protège rien.
// Neuf events avaient exactement ce défaut avant ce correctif (dm:edit,
// dm:react, voice:kick avaient l'appel mais pas la règle ; d'autres n'avaient
// ni l'un ni l'autre et ont été corrigés dans la même passe).
//
// Ce test lit le code source réel de src/socket/ (pas une liste maintenue à
// la main, qui dériverait) et vérifie statiquement que chaque clé littérale
// passée à checkRateLimit(...) existe dans RATE_RULES. Il tombe dès qu'un
// futur commit ajoute un appel avec une clé non enregistrée.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { RATE_RULES } from '../socket/rateLimiter'

const SOCKET_DIR = join(__dirname, '..', 'socket')

function extractRateLimitKeys(source: string): string[] {
	// Couvre `checkRateLimit(x, 'key')` et le style guard() de voiceSfu.ts qui
	// passe un littéral en 2e position d'un autre appel — on ne cible que les
	// appels DIRECTS à checkRateLimit, guard() étant lui-même testé via ses
	// propres appelants (voice:sfu_join, etc. passent leur clé à guard()).
	const keys: string[] = []
	const re = /checkRateLimit\([^,]+,\s*'([^']+)'\)/g
	let match: RegExpExecArray | null
	while ((match = re.exec(source)) !== null) keys.push(match[1])
	return keys
}

// guard('event-name', ...) dans voiceSfu.ts relaie la clé à checkRateLimit en
// interne (rateLimiter.ts:128) : on couvre ces appels séparément puisqu'ils ne
// matchent pas le pattern `checkRateLimit(x, 'clé')` littéral.
function extractGuardKeys(source: string): string[] {
	const keys: string[] = []
	const re = /guard\('([^']+)'/g
	let match: RegExpExecArray | null
	while ((match = re.exec(source)) !== null) keys.push(match[1])
	return keys
}

describe('couverture RATE_RULES pour tous les appels checkRateLimit de src/socket/', () => {
	const files = readdirSync(SOCKET_DIR).filter(f => f.endsWith('.ts'))
	expect(files.length).toBeGreaterThan(5) // sanity check : le dossier est bien lu

	for (const file of files) {
		it(`${file} : toute clé appelée existe dans RATE_RULES`, () => {
			const source = readFileSync(join(SOCKET_DIR, file), 'utf8')
			const keys = [...extractRateLimitKeys(source), ...extractGuardKeys(source)]
			const missing = keys.filter(k => !(k in RATE_RULES))
			expect(missing, `clé(s) appelée(s) sans entrée dans RATE_RULES : ${missing.join(', ')}`).toEqual([])
		})
	}
})
