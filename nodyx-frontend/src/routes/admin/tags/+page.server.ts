import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch }) => {
	const [res, catRes] = await Promise.all([
		apiFetch(fetch, '/instance/tags'),
		apiFetch(fetch, '/instance/categories'),
	]);
	const { tags } = res.ok ? await res.json() : { tags: [] };
	const { categories } = catRes.ok ? await catRes.json() : { categories: [] };
	return { tags, categories };
};

// Les refus du serveur, ramenés à une phrase traduite (l'écran affiche la clé)
const ERRORS: Record<string, string> = {
	TAG_NAME_TAKEN:    'atags.err_taken',
	TAG_NAME_TOO_LONG: 'atags.err_too_long',
	TAG_BAD_COLOR:     'atags.err_color',
	TAG_BAD_CATEGORIES: 'atags.err_categories',
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
		const category_ids = (form.getAll('category_ids') as string[]).filter(Boolean);

		if (!name) return fail(400, { errorKey: 'atags.err_name' });

		const res = await apiFetch(fetch, '/instance/tags', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ name, color, ...(category_ids.length ? { category_ids } : {}) }),
		});
		if (!res.ok) return fail(res.status, { errorKey: await errorKey(res, 'atags.err_create') });
	},

	update: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const id    = String(form.get('tag_id') ?? '');
		const name  = String(form.get('name') ?? '').trim();
		const color = String(form.get('color') ?? '');
		const category_ids = (form.getAll('category_ids') as string[]).filter(Boolean);

		if (!name) return fail(400, { editId: id, errorKey: 'atags.err_name' });

		const res = await apiFetch(fetch, `/instance/tags/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ name, ...(color ? { color } : {}), category_ids }),
		});
		if (!res.ok) return fail(res.status, { editId: id, errorKey: await errorKey(res, 'atags.err_update') });
		return { updated: id };
	},

	// Recebe a ordem completa (arrastar e soltar) e a grava.
	reorder: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form = await request.formData();

		// Recebe a sequência de IDs enviada pelo frontend.
		let ids: string[];

		try {
			ids = JSON.parse(String(form.get('ids') ?? ''));
		} catch {
			return fail(400, { errorKey: 'atags.err_update' });
		}

		if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
			return fail(400, { errorKey: 'atags.err_update' });
		}

		// Consulta a lista atual para validar os IDs recebidos.
		const list = await apiFetch(fetch, '/instance/tags');

		if (!list.ok) {
			return fail(list.status, { errorKey: 'atags.err_update' });
		}

		const { tags } = await list.json();
		const currentIds: string[] = tags.map((tag: { id: string }) => tag.id);

		// Impede IDs repetidos, ausentes ou desconhecidos.
		const isValid =
			ids.length === currentIds.length &&
			new Set(ids).size === currentIds.length &&
			ids.every((id) => currentIds.includes(id));

		if (!isValid) {
			return fail(400, { errorKey: 'atags.err_update' });
		}

		// Persiste a nova ordem no backend.
		const res = await apiFetch(fetch, '/instance/tags/order', {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ ids }),
		});
		if (!res.ok) return fail(res.status, { errorKey: await errorKey(res, 'atags.err_update') });

		return { reordered: true };
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
