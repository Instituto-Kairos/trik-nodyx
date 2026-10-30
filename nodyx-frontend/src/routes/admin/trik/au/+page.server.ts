import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const headers = { Authorization: `Bearer ${token}` };
	const [res, charRes] = await Promise.all([
		apiFetch(fetch, '/admin/trik/au-categories', { headers }),
		apiFetch(fetch, '/admin/trik/au-characters', { headers })
	]);
	const categories = res.ok ? ((await res.json()).categories ?? []) : [];
	const characters = charRes.ok ? ((await charRes.json()).characters ?? []) : [];
	return { categories, characters };
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
	}
};
