// ─── Un endroit que le NAVIGATEUR doit charger ne se construit pas sur API_URL ─
//
// Trouvé le 2026-09-24, en production, sur /galeria : aucune vignette ne
// s'affichait, et la console disait deux fois la même chose :
//
//   Mixed Content: the page at 'https://…/galeria' was loaded over HTTPS, but
//   requested an insecure element 'http://127.0.0.1:3000/uploads/…_thumb.webp'
//   … violates the CSP directive: "img-src 'self' data: blob: https:"
//
// `API_URL` ($lib/api) est résolu À L'IMPORT, et vaut deux choses différentes :
//
//   browser → `${PUBLIC_API_URL}/api/v1`        (le domaine public, en https)
//   SSR     → `http://127.0.0.1:3000/api/v1`    (le backend local)
//
// Ce dédoublement est JUSTE pour que le code aille chercher l'API lui-même : en
// SSR, Node parle au backend en direct, sans ressortir par le DNS. Il est FAUX
// dès qu'on s'en sert pour fabriquer une adresse que le navigateur résoudra :
// l'URL interne part telle quelle dans le HTML rendu côté serveur, et le
// navigateur, lui, ne sait pas joindre le 127.0.0.1 du serveur. Le proxy ne
// peut pas rattraper : une IP n'est jamais promue en https.
//
// Le chemin RELATIF est la bonne réponse, et il marche partout — Caddy
// (`handle /uploads/*`, posé par install.sh) et le proxy Vite en dev envoient
// tous les deux /uploads au backend.
//
// Pourquoi un test de source : la page se rendait sans erreur, le build
// passait, et svelte-check n'a rien à dire — les deux branches sont des string.
// Seul un navigateur sur une instance en HTTPS voyait le défaut.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))   // nodyx-frontend/src

function sources(dossier: string, acc: string[] = []): string[] {
	for (const e of readdirSync(dossier)) {
		const chemin = join(dossier, e)
		if (statSync(chemin).isDirectory()) sources(chemin, acc)
		else if (e.endsWith('.svelte') || (e.endsWith('.ts') && !e.endsWith('.test.ts')))
			acc.push(chemin.split(sep).join('/'))
	}
	return acc
}

/** Le module qui PORTE la double résolution : c'est lui qui la définit. */
const DEFINITION = 'src/lib/api.ts'

/** Le code seul : la ligne qui EXPLIQUE le piège ne doit pas le déclencher. */
const codeSeul = (ligne: string) => ligne.replace(/\/\/.*$/, '')

/**
 * Les adresses fautives se lisent sur DEUX lignes, jamais une :
 *
 *     const base = API_URL.replace('/api/v1', '')      ← la contamination
 *     … => `${base}/uploads/${i.file_path}`            ← l'usage
 *
 * Un contrôle ligne à ligne ne voit donc rien, et un contrôle fichier par
 * fichier crie au loup sur la galerie corrigée (qui garde un API_URL légitime
 * pour son propre fetch). Il faut suivre la variable intermédiaire — c'est
 * exactement la forme qu'avait le défaut.
 */
function adressesFautives(src: string): string[] {
	// `\r?` n'est pas un détail : ce dépôt est édité sous Windows et la moitié
	// des fichiers sont en CRLF. Découpés sur '\n' seul, chaque ligne garde un
	// '\r' final — or '\r' est un terminateur de ligne pour JS, donc `.` ne le
	// traverse pas et tout motif ancré par `$` échoue. La première version de ce
	// test ne voyait RIEN pour cette seule raison : ni la contamination, ni même
	// les commentaires à retirer.
	const lignes = src.split(/\r?\n/)

	// Tout nom qui reçoit une valeur dérivée d'API_URL est contaminé.
	const contamines = new Set<string>()
	for (const ligne of lignes) {
		const m = /(?:const|let|var)\s+(\w+)\s*=\s*(.*\bAPI_URL\b.*)$/.exec(codeSeul(ligne))
		if (m) contamines.add(m[1])
	}

	const fautives: string[] = []
	lignes.forEach((ligne, i) => {
		const code = codeSeul(ligne)
		if (!code.includes('/uploads')) return
		const coupable =
			/\bAPI_URL\b/.test(code) ||
			[...contamines].find((nom) => new RegExp(`\\$\\{\\s*${nom}\\b|\\b${nom}\\s*\\+`).test(code))
		if (coupable) fautives.push(`${i + 1}: ${ligne.trim()}`)
	})
	return fautives
}

describe('les adresses /uploads ne se construisent pas sur API_URL', () => {
	it('aucune source ne construit une adresse /uploads sur API_URL', () => {
		const fautifs: string[] = []

		for (const fichier of sources(SRC)) {
			if (fichier.endsWith(DEFINITION)) continue
			const court = fichier.slice(fichier.indexOf('src/'))
			for (const f of adressesFautives(readFileSync(fichier, 'utf8'))) {
				fautifs.push(`${court}:${f}`)
			}
		}

		expect(
			fautifs,
			`API_URL vaut http://127.0.0.1:3000 en SSR : ces adresses partent dans le HTML et\n` +
			`le navigateur ne peut pas les charger (Mixed Content + CSP). Utiliser « /uploads/… ».\n` +
			fautifs.join('\n'),
		).toEqual([])
	})

	it('le contrôle voit la forme exacte du défaut, en deux lignes', () => {
		// LE cas qui a échappé à la première version de ce test : séparer la
		// contamination de l'usage suffisait à passer sous le radar.
		const defaut = [
			`const base = API_URL.replace('/api/v1', '')`,
			'const urlThumb = (i) => `${base}/uploads/${i.thumbnail_path}`',
		].join('\n')
		expect(adressesFautives(defaut)).toHaveLength(1)

		// Et la forme corrigée doit rester silencieuse, API_URL compris — la
		// galerie s'en sert encore, légitimement, pour son propre fetch.
		const corrige = [
			'const urlThumb = (i) => `/uploads/${i.thumbnail_path}`',
			'const res = await fetch(`${API_URL}/galeria/images`)',
		].join('\n')
		expect(adressesFautives(corrige)).toEqual([])
	})

	it('la galerie sert bien ses images en relatif', () => {
		// La page où le défaut s'est manifesté, nommée explicitement : le contrôle
		// générique ci-dessus passerait aussi si quelqu'un supprimait ces lignes.
		const src = readFileSync(join(SRC, 'routes/galeria/+page.svelte'), 'utf8')
		expect(src).toMatch(/urlThumb\s*=\s*\(i: Imagem\)\s*=>\s*`\/uploads\//)
		expect(src).toMatch(/urlCheia\s*=\s*\(i: Imagem\)\s*=>\s*`\/uploads\//)
	})

	it('le double visage d API_URL est toujours là — sinon ce test ne sert plus', () => {
		// Garde-fou du garde-fou : si un jour $lib/api cesse de résoudre deux
		// adresses selon le contexte, le piège disparaît et ce fichier doit être
		// relu plutôt que gardé par habitude.
		const api = readFileSync(join(SRC, 'lib/api.ts'), 'utf8')
		expect(api).toContain('127.0.0.1:3000')
		expect(api).toMatch(/browser\s*$/m)
	})
})
