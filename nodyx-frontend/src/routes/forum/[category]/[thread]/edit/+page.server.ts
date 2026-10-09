import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

// Edição do tópico (título + tags) — só owner/admin da instância. O PATCH do
// back aceita tag_ids de moderadores também; a restrição a admin é desta tela.
const isAdminRole = (role?: string) => role === 'owner' || role === 'admin';

export const load: PageServerLoad = async ({ fetch, params, cookies, parent }) => {
	const token = cookies.get('token');
	if (!token) redirect(303, `/auth/login?redirectTo=/forum/${params.category}/${params.thread}/edit`);

	const { user } = await parent();
	if (!isAdminRole((user as { role?: string } | null)?.role)) error(403, 'Réservé aux administrateurs');

	// limit=1 : só o cabeçalho do tópico interessa aqui, não os posts.
	const [threadRes, tagsRes] = await Promise.all([
		apiFetch(fetch, `/forums/threads/${params.thread}?limit=1`),
		apiFetch(fetch, '/instance/tags'),
	]);
	const threadJson = await threadRes.json();
	if (!threadRes.ok) error(threadRes.status, threadJson.error ?? 'Thread introuvable');

	const { tags } = tagsRes.ok ? await tagsRes.json() : { tags: [] };

	return { thread: threadJson.thread, tags };
};

export const actions: Actions = {
	default: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) redirect(303, '/auth/login');

		// A action não passa pelo load : refaz a checagem de papel.
		const meRes = await apiFetch(fetch, '/users/me', { headers: { Authorization: `Bearer ${token}` } });
		const me    = meRes.ok ? (await meRes.json()).user : null;
		if (!isAdminRole(me?.role)) return fail(403, { error: 'Réservé aux administrateurs' });

		const form   = await request.formData();
		const title  = ((form.get('title') as string | null) ?? '').trim();
		const tagIds = (form.getAll('tag_ids') as string[]).filter(Boolean).slice(0, 5);

		if (!title) return fail(400, { error: 'Titre requis' });

		const res  = await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ title, tag_ids: tagIds }),
		});
		const json = await res.json();

		if (!res.ok) return fail(res.status, { error: json.error });

		// O slug não muda com o título (ThreadModel.update não o recalcula).
		redirect(303, `/forum/${params.category}/${json.thread?.slug ?? params.thread}`);
	},
};
