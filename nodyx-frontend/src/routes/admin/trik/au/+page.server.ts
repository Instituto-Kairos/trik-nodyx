import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies, parent }) => {
	const token = cookies.get('token');
	const headers = { Authorization: `Bearer ${token}` };

	if ((await parent()).auNarrator) {
		const panel = await apiFetch(fetch, '/trik/au-panel', { headers });
		const json = panel.ok ? await panel.json() : {};
		return { categories: [], narrators: [], roots: json.roots ?? [], characters: json.characters ?? [] };
	}

	const [res, charRes, narRes] = await Promise.all([
		apiFetch(fetch, '/admin/trik/au-categories', { headers }),
		apiFetch(fetch, '/admin/trik/au-characters', { headers }),
		apiFetch(fetch, '/admin/trik/au-narrators', { headers })
	]);
	const categories = res.ok ? ((await res.json()).categories ?? []) : [];
	const characters = charRes.ok ? ((await charRes.json()).characters ?? []) : [];
	const narrators = narRes.ok ? ((await narRes.json()).narrators ?? []) : [];
	return { categories, characters, narrators, roots: [] };
};

export const actions: Actions = {
	save: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();

		let categoryIds: string[];
		try {
			categoryIds = JSON.parse(String(form.get('categoryIds') ?? '[]'));
		} catch {
			return fail(400, { error: 'JSON inválido' });
		}

		const res = await apiFetch(fetch, '/admin/trik/au-categories', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ categoryIds })
		});

		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao salvar' });
		}
		return { ok: true };
	},

	addNarrator: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const res = await apiFetch(fetch, '/admin/trik/au-narrators', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cookies.get('token')}` },
			body: JSON.stringify({ categoryId: form.get('categoryId'), username: form.get('username') })
		});
		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao adicionar narrador' });
		}
		return { ok: true };
	},

	removeNarrator: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const res = await apiFetch(fetch, `/admin/trik/au-narrators/${form.get('categoryId')}/${form.get('userId')}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${cookies.get('token')}` }
		});
		if (!res.ok) return fail(res.status, { error: 'Erro ao remover narrador' });
		return { ok: true };
	}
};
