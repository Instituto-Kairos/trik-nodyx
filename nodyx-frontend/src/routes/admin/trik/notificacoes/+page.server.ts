import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const res = await apiFetch(fetch, '/admin/trik/notify-categories', {
		headers: { Authorization: `Bearer ${token}` }
	});
	const categories = res.ok ? ((await res.json()).categories ?? []) : [];
	return { categories };
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

		const res = await apiFetch(fetch, '/admin/trik/notify-categories', {
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
