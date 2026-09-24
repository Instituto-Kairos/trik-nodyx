/**
 * Pagination des messages d'un sujet.
 *
 * Un sujet n'a AUCUN plafond de messages : seule l'AFFICHAGE est découpé en
 * pages de POSTS_PER_PAGE. `post_count` (message d'ouverture inclus) donne le
 * total, donc le nombre de pages.
 */

export const POSTS_PER_PAGE = 30

/** Nombre de pages pour `postCount` messages (toujours ≥ 1, même sujet vide). */
export function totalPages(postCount: number | null | undefined): number {
	return Math.max(1, Math.ceil((postCount ?? 0) / POSTS_PER_PAGE))
}

/**
 * Lit `?page=` : un entier ≥ 1, ou 'last' (utilisé après une réponse pour
 * atterrir sur le dernier message sans connaître le total). Tout le reste → 1.
 */
export function parsePageParam(raw: string | null): number | 'last' {
	if (raw === 'last') return 'last'
	const n = Number.parseInt(raw ?? '', 10)
	return Number.isFinite(n) && n >= 1 ? n : 1
}

/**
 * Pages à afficher dans la barre : première, dernière et deux voisines de la
 * page courante ; '…' marque un trou.
 */
export function pageItems(current: number, total: number): Array<number | '…'> {
	const keep = new Set<number>([1, total])
	for (let p = current - 2; p <= current + 2; p++) {
		if (p >= 1 && p <= total) keep.add(p)
	}
	const sorted = [...keep].sort((a, b) => a - b)
	const out: Array<number | '…'> = []
	sorted.forEach((p, i) => {
		const gap = i > 0 ? p - sorted[i - 1] : 1
		// Un trou d'une seule page s'écrit en clair : « … » n'y gagnerait pas de place.
		if (gap === 2) out.push(p - 1)
		else if (gap > 2) out.push('…')
		out.push(p)
	})
	return out
}
