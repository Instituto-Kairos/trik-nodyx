// H:\Projets\Nodyx\nodyx-frontend\src\routes\forum\[category]\ +page.server.ts

import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';
import { findCategoryPath } from '$lib/forumTree';

export const load: PageServerLoad = async ({ fetch, params }) => {
	// 1. Récupérer les threads (accepte UUID ou slug côté API)
	const threadsRes = await apiFetch(fetch, `/forums/threads?category_id=${params.category}`);
	const threadsJson = await threadsRes.json();

	if (!threadsRes.ok) {
		error(threadsRes.status, threadsJson.error ?? 'Erreur chargement threads');
	}

	// 2. Récupérer l'arbre des catégories
	const categoriesRes = await apiFetch(fetch, `/instance/categories`);
	const categoriesJson = await categoriesRes.json();

	// 3. Trouver la catégorie par ID ou slug, en gardant TOUTE la lignée :
	//    les catégories s'imbriquent sans limite de profondeur et le fil
	//    d'Ariane a besoin des ancêtres, pas seulement de la feuille.
	const trail    = findCategoryPath(categoriesJson.categories || [], params.category);
	const category = trail?.[trail.length - 1]
		?? threadsJson.category
		?? { id: params.category, name: 'Discussions', slug: null, description: null };

	// 4. Redirect 301 UUID → slug (SEO canonique)
	if (category.slug && params.category !== category.slug) {
		redirect(301, `/forum/${category.slug}`);
	}

	return {
		threads: threadsJson.threads,
		categoryId: category.id,
		category,
		// Lignée racine → catégorie courante. Vide si l'arbre n'a pas répondu :
		// la page retombe alors sur la catégorie seule.
		trail: (trail ?? [category]).map(c => ({ id: c.id, name: c.name, slug: c.slug ?? null }))
	};
};