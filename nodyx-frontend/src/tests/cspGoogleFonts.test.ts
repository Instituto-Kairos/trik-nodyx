// ─── La CSP du proxy doit rester un SUR-ENSEMBLE de celle de l'application ───
//
// Trouvé le 2026-09-22 : « les polices sélectionnables du profil ne marchent
// pas, même pas dans l'aperçu ». Rien de cassé côté code — `+layout.svelte`
// charge bien les presets depuis fonts.googleapis.com, et `svelte.config.js`
// les autorise. Mais Caddy, tel que l'écrit install.sh, pose SA politique, qui
// REMPLACE celle de SvelteKit, et celle-là n'avait ni fonts.googleapis.com en
// `style-src` ni fonts.gstatic.com en `font-src`. La feuille était refusée, donc
// AUCUNE police ne s'appliquait nulle part — pendant que couleur, halo et
// animation continuaient de marcher, n'ayant besoin d'aucune ressource externe.
//
// Deux politiques pour un seul navigateur : dès qu'elles divergent, la plus
// restrictive gagne en silence. Ce test échoue sur l'ancien install.sh.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ICI   = dirname(fileURLToPath(import.meta.url))         // nodyx-frontend/src/tests
const FRONT = join(ICI, '..', '..')                           // nodyx-frontend
const RACINE = join(FRONT, '..')                              // dépôt

/** Extrait les hôtes d'une directive CSP dans un texte de configuration. */
function directive(source: string, nom: string): string {
	// Couvre les deux écritures : `'style-src': ['self', 'https://…']` (JS) et
	// `style-src 'self' https://…;` (en-tête Caddy).
	const js = new RegExp(`'${nom}':\\s*\\[([^\\]]*)\\]`).exec(source)
	if (js) return js[1]
	const header = new RegExp(`${nom}\\s+([^;"]*)`).exec(source)
	return header ? header[1] : ''
}

const CONFIG_APP = readFileSync(join(FRONT, 'svelte.config.js'), 'utf8')

// Ce dont les effets de pseudo ont besoin : la feuille vient de googleapis,
// les woff2 de gstatic. Il faut les DEUX, elles se bloquent en série.
const REQUIS = [
	['style-src', 'fonts.googleapis.com'],
	['font-src',  'fonts.gstatic.com'],
] as const

describe('CSP — polices Google des effets de pseudo', () => {
	it("l'application les autorise (référence)", () => {
		for (const [nom, hote] of REQUIS) {
			expect(directive(CONFIG_APP, nom), nom).toContain(hote)
		}
	})

	// Les deux installeurs posent la même politique Caddy ; elle remplace celle
	// de l'application, donc elle doit couvrir au moins autant.
	for (const installeur of ['install.sh', 'install_tunnel.sh']) {
		it(`${installeur} ne les retire pas en posant la politique du proxy`, () => {
			const source = readFileSync(join(RACINE, installeur), 'utf8')
			const csp = /Content-Security-Policy\s+"([^"]+)"/.exec(source)
			expect(csp, `${installeur} : aucune CSP trouvée`).not.toBeNull()

			for (const [nom, hote] of REQUIS) {
				expect(directive(csp![1], nom), `${installeur} → ${nom}`).toContain(hote)
			}
		})
	}

	it('le <link> du layout pointe bien vers l hôte autorisé', () => {
		// Si l'URL des presets changeait d'hôte, autoriser googleapis ne servirait
		// plus à rien : on vérifie que la constante et la politique parlent du
		// même domaine.
		const effets = readFileSync(join(FRONT, 'src', 'lib', 'nameEffects.ts'), 'utf8')
		expect(effets).toContain('https://fonts.googleapis.com/css2')
	})
})
