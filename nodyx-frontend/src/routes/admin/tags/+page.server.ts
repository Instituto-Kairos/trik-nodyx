import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch }) => {
	const res  = await apiFetch(fetch, '/instance/tags');
	const { tags } = res.ok ? await res.json() : { tags: [] };
	return { tags };
};

// Les refus du serveur, ramenés à une phrase traduite (l'écran affiche la clé)
const ERRORS: Record<string, string> = {
	TAG_NAME_TAKEN:    'atags.err_taken',
	TAG_NAME_TOO_LONG: 'atags.err_too_long',
	TAG_BAD_COLOR:     'atags.err_color',
	BAD_REQUEST:       'atags.err_name',
	NOT_FOUND:         'atags.err_gone',
	FORBIDDEN:         'atags.err_forbidden',
};
async function errorKey(res: Response, fallback: string): Promise<string> {
	const json = await res.json().catch(() => ({}));
	return ERRORS[json.code ?? ''] ?? fallback;
}

export const actions: Actions = {
	create: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const name  = String(form.get('name') ?? '').trim();
		const color = String(form.get('color') ?? '') || '#6366f1';

		if (!name) return fail(400, { errorKey: 'atags.err_name' });

		const res = await apiFetch(fetch, '/instance/tags', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ name, color }),
		});
		if (!res.ok) return fail(res.status, { errorKey: await errorKey(res, 'atags.err_create') });
	},

	update: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const id    = String(form.get('tag_id') ?? '');
		const name  = String(form.get('name') ?? '').trim();
		const color = String(form.get('color') ?? '');

		if (!name) return fail(400, { editId: id, errorKey: 'atags.err_name' });

		const res = await apiFetch(fetch, `/instance/tags/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ name, ...(color ? { color } : {}) }),
		});
		if (!res.ok) return fail(res.status, { editId: id, errorKey: await errorKey(res, 'atags.err_update') });
		return { updated: id };
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
		if (!res.ok) return fail(res.status, { errorKey: await errorKey(res, 'atags.err_update') });
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
