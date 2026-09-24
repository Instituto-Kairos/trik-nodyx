import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { POSTS_PER_PAGE, totalPages, parsePageParam } from '$lib/forumPagination';

export const load: PageServerLoad = async ({ fetch, params, cookies, url }) => {
	const token = cookies.get('token') ?? null;

	// Pagination : pas de plafond de messages par sujet, seulement un découpage
	// d'affichage. `?page=last` (posé après une réponse) et une page hors borne
	// sont résolues avec le total renvoyé par l'API, d'où un éventuel 2e appel.
	const wanted = parsePageParam(url.searchParams.get('page'));
	const fetchPage = (p: number, limit = POSTS_PER_PAGE) =>
		apiFetch(fetch, `/forums/threads/${params.thread}?limit=${limit}&offset=${(p - 1) * POSTS_PER_PAGE}`);

	let page = wanted === 'last' ? 1 : wanted;
	let res  = await fetchPage(page, wanted === 'last' ? 1 : POSTS_PER_PAGE);
	let json = await res.json();

	if (!res.ok) {
		error(res.status, json.error ?? 'Thread introuvable');
	}

	const pages  = totalPages(json.thread.post_count);
	const target = wanted === 'last' ? pages : Math.min(wanted, pages);
	if (target !== page || wanted === 'last') {
		page = target;
		res  = await fetchPage(page);
		json = await res.json();
		if (!res.ok) {
			error(res.status, json.error ?? 'Thread introuvable');
		}
	}

	// Redirect UUID-based URLs to canonical slug URL (301 for SEO)
	const thread = json.thread;
	const catParam  = params.category;
	const catSlug   = thread.category_slug ?? null;
	const canonical = `/forum/${catSlug ?? catParam}/${thread.slug ?? params.thread}${page > 1 ? `?page=${page}` : ''}`;
	if ((thread.slug && params.thread !== thread.slug) || (catSlug && catParam !== catSlug)) {
		redirect(301, canonical);
	}

	// Image de partage (og:image) : la première image du premier post, donc la
	// bannière de l'article. Lue côté serveur pour que Discord/Twitter/Facebook
	// (qui n'exécutent pas de JS) la voient dans le HTML SSR. Chemin relatif :
	// le composant l'absolutise via page.url.origin.
	// Seule la page 1 porte le message d'ouverture : ailleurs, pas d'image propre.
	const ogImagePath: string | null = page > 1 ? null :
		(json.posts?.[0]?.content ?? '').match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] ?? null;

	// Charger le sondage lié à ce thread (s'il existe)
	let poll: any = null;
	if (token) {
		const pollRes = await apiFetch(fetch, `/polls?thread_id=${thread.id}&limit=1`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (pollRes.ok) {
			const pollJson = await pollRes.json();
			poll = pollJson.polls?.[0] ?? null;
		}
	}

	// Módulo RPG (trik, Fase 2) : estado de elegibilidade de XP do tópico. Vem
	// na própria resposta do tópico (`xp_enabled`) — antes era uma chamada extra
	// à rota admin, que devolvia 403 pra todo jogador e deixava o selo "XP ativo"
	// sempre apagado pra quem ele deveria informar.
	const xpEnabled: boolean = json.xp_enabled === true;

	return { thread: json.thread, posts: json.posts, poll, token, ogImagePath, xpEnabled, page, totalPages: pages };
};

export const actions: Actions = {

	// ── Publier une réponse ───────────────────────────────────────────────
	reply: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form    = await request.formData();
		const content = form.get('content') as string;

		const res  = await apiFetch(fetch, '/forums/posts', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ thread_id: params.thread, content })
		});

		if (!res.ok) {
			const json = await res.json();
			return fail(res.status, { replyError: json.error });
		}

		// Atterrit sur le dernier message : sa page n'est pas connue ici (le total
		// vient du load), d'où `?page=last` + ancre sur le post créé.
		const { post } = await res.json();
		redirect(303, `/forum/${params.category}/${params.thread}?page=last${post?.id ? `#post-${post.id}` : ''}`);
	},

	// ── Éditer un post ────────────────────────────────────────────────────
	editPost: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form    = await request.formData();
		const postId  = form.get('post_id') as string;
		const content = form.get('content') as string;

		const res = await apiFetch(fetch, `/forums/posts/${postId}`, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ content })
		});

		if (!res.ok) {
			const json = await res.json();
			return fail(res.status, { editError: json.error });
		}
	},

	// ── Supprimer un post ─────────────────────────────────────────────────
	deletePost: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form   = await request.formData();
		const postId = form.get('post_id') as string;

		await apiFetch(fetch, `/forums/posts/${postId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` }
		});
	},

	// ── Éditer le titre du thread ─────────────────────────────────────────
	editTitle: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form  = await request.formData();
		const title = (form.get('title') as string).trim();

		if (!title) return fail(400, { editTitleError: 'Titre requis' });

		const res  = await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ title })
		});

		if (!res.ok) {
			const json = await res.json();
			return fail(res.status, { editTitleError: json.error });
		}
	},

	// ── Épingler / désépingler ────────────────────────────────────────────
	pinThread: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form     = await request.formData();
		const isPinned = form.get('is_pinned') === 'true';

		await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ is_pinned: isPinned })
		});
	},

	// ── Verrouiller / déverrouiller ───────────────────────────────────────
	lockThread: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form     = await request.formData();
		const isLocked = form.get('is_locked') === 'true';

		await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ is_locked: isLocked })
		});
	},

	// ── Promouvoir / rétrograder en article mis en avant ─────────────────
	featureThread: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form       = await request.formData();
		const isFeatured = form.get('is_featured') === 'true';

		await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ is_featured: isFeatured })
		});
	},

	// ── Módulo RPG (trik) : marcar/desmarcar o tópico pra contagem de XP ───
	toggleXp: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form    = await request.formData();
		const enabled = form.get('is_xp_enabled') === 'true';

		const res = await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ is_xp_enabled: enabled })
		});

		if (!res.ok) {
			const json = await res.json();
			return fail(res.status, { xpError: json.error });
		}
	},

	// ── Supprimer le thread ───────────────────────────────────────────────
	deleteThread: async ({ fetch, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ delete: true })
		});

		redirect(303, `/forum/${params.category}`);
	},

	// ── Réagir à un post ─────────────────────────────────────────────────
	reactPost: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) return fail(401, { error: 'Non connecté' });

		const form   = await request.formData();
		const postId = form.get('post_id') as string;
		const emoji  = form.get('emoji')   as string;

		await apiFetch(fetch, `/forums/posts/${postId}/reactions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ emoji })
		});
	},

	// ── Remercier un post ─────────────────────────────────────────────────
	thankPost: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) return fail(401, { error: 'Non connecté' });

		const form   = await request.formData();
		const postId = form.get('post_id') as string;

		await apiFetch(fetch, `/forums/posts/${postId}/thanks`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` }
		});
	},
};
