import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch }) => {
	const res  = await apiFetch(fetch, '/instance/tags');
	const { tags } = res.ok ? await res.json() : { tags: [] };
	return { tags };
};

export const actions: Actions = {
	create: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const name  = (form.get('name')  as string).trim();
		const color = (form.get('color') as string) || '#6366f1';

		if (!name) return fail(400, { error: 'Le nom est obligatoire.' });

		const res = await apiFetch(fetch, '/instance/tags', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ name, color }),
		});
		if (!res.ok) return fail(res.status, { error: (await res.json()).error ?? 'Erreur création tag' });
	},

	update: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const tagId = form.get('tag_id') as string;
		const name  = (form.get('name') as string).trim();
		const color = form.get('color') as string;

		if (!name) return fail(400, { error: 'Le nom est obligatoire.' });

		const res = await apiFetch(fetch, `/instance/tags/${tagId}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ name, color }),
		});
		if (!res.ok) return fail(res.status, { error: (await res.json()).error ?? 'Erreur modification tag' });
		return { updated: tagId };
	},

	// Move uma tag uma posição para cima/baixo e grava a ordem completa.
	move: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const tagId = form.get('tag_id') as string;
		const dir   = form.get('dir') === 'up' ? -1 : 1;

		const list = await apiFetch(fetch, '/instance/tags');
		const { tags } = list.ok ? await list.json() : { tags: [] };
		const ids: string[] = tags.map((t: { id: string }) => t.id);

		const i = ids.indexOf(tagId);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];

		const res = await apiFetch(fetch, '/instance/tags/order', {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ ids }),
		});
		if (!res.ok) return fail(res.status, { error: (await res.json()).error ?? 'Erreur réorganisation tags' });
	},

	delete: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const tagId = form.get('tag_id') as string;

		await apiFetch(fetch, `/instance/tags/${tagId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		});
	},
};
