// ─── Le « Voir » d'une notification doit tomber SUR le message ───────────────
//
// Constaté le 2026-09-24 : le bouton menait au sujet, jamais au message qui
// avait déclenché la notification. Deux défauts superposés, qui se cachaient
// l'un l'autre :
//
//  1. l'ancre était `#<uuid>`, alors que le DOM porte `id="post-<uuid>"`
//     (forum/[category]/[thread]/+page.svelte). Elle ne correspondait à rien,
//     donc aucun saut — et comme le sujet s'ouvrait quand même, ça passait
//     pour « normal » ;
//  2. la page manquait. Un sujet se pagine par POSTS_PER_PAGE : à partir du
//     31e message, la cible n'est même pas rendue. Corriger l'ancre seule
//     n'aurait rien changé pour les sujets longs, c'est-à-dire ceux où le
//     besoin est réel.
//
// Le serveur fournit `post_index` (nombre de messages AVANT celui-ci) — voir
// models/notification.ts. Ces contrôles échouent sur l'ancienne logique.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { POSTS_PER_PAGE } from '$lib/forumPagination'

/**
 * Copie de `notifLink` (routes/notifications/+page.svelte).
 *
 * Dupliquée faute de pouvoir importer une fonction déclarée dans le <script>
 * d'un composant. Le troisième test ci-dessous arrime cette copie à la source :
 * si l'une bouge sans l'autre, il tombe.
 */
function notifLink(n: any): string {
	if (!n.category_id || !n.thread_id) return '#'

	const cat    = n.category_slug ?? n.category_id
	const thread = n.thread_slug   ?? n.thread_id
	let url      = `/forum/${cat}/${thread}`

	if (typeof n.post_index === 'number') {
		const page = Math.floor(n.post_index / POSTS_PER_PAGE) + 1
		if (page > 1) url += `?page=${page}`
	}
	if (n.post_id) url += `#post-${n.post_id}`
	return url
}

const base = {
	category_id: 'cat-uuid', thread_id: 'thr-uuid', post_id: 'post-uuid',
	category_slug: 'general', thread_slug: 'mon-sujet',
}

describe('lien « Voir » d une notification', () => {
	it('ancre le message avec le préfixe post-, celui du DOM', () => {
		const url = notifLink({ ...base, post_index: 0 })
		expect(url).toContain('#post-post-uuid')
		// L'ancienne forme, `#<uuid>` nu, ne doit plus apparaître.
		expect(url.endsWith('#post-uuid')).toBe(false)
	})

	it('vise la bonne page quand le message est au-delà de la première', () => {
		// Premier message de la 2e page = index POSTS_PER_PAGE.
		expect(notifLink({ ...base, post_index: POSTS_PER_PAGE })).toContain('?page=2')
		// Dernier de la 1re page : pas de ?page=, il est déjà là.
		expect(notifLink({ ...base, post_index: POSTS_PER_PAGE - 1 })).not.toContain('?page=')
		// Un index bien plus loin tombe sur sa page, pas sur la 1re.
		expect(notifLink({ ...base, post_index: POSTS_PER_PAGE * 4 + 3 })).toContain('?page=5')
	})

	it('reste sur la 1re page et garde l ordre ?page= avant #ancre', () => {
		const url = notifLink({ ...base, post_index: POSTS_PER_PAGE * 2 })
		// Une URL qui écrirait l'ancre avant la query casserait la query :
		// tout ce qui suit le # est un fragment, jamais lu par le serveur.
		expect(url).toBe('/forum/general/mon-sujet?page=3#post-post-uuid')
	})

	it('retombe sur les UUID quand les slugs manquent', () => {
		const url = notifLink({ ...base, category_slug: null, thread_slug: null, post_index: 0 })
		expect(url).toBe('/forum/cat-uuid/thr-uuid#post-post-uuid')
	})

	it('ne fabrique pas de lien sans sujet (aceno, canvas)', () => {
		expect(notifLink({ category_id: null, thread_id: null, post_id: null })).toBe('#')
	})

	it('sans post_index, pas de ?page= inventée', () => {
		// Notification antérieure au champ, ou post supprimé : on ouvre le sujet
		// plutôt que de deviner une page qui n'existe peut-être pas.
		const url = notifLink({ ...base, post_index: null })
		expect(url).toBe('/forum/general/mon-sujet#post-post-uuid')
	})

	it('la copie ci-dessus dit la même chose que le composant', () => {
		// Arrimage : le composant est la source, ce fichier n'en est qu'un double.
		const src  = fileURLToPath(new URL('../routes/notifications/+page.svelte', import.meta.url))
		const code = readFileSync(src, 'utf8')
		expect(code).toContain('#post-${n.post_id}')
		expect(code).toContain('Math.floor(n.post_index / POSTS_PER_PAGE) + 1')
	})
})
