import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const res = await apiFetch(fetch, '/admin/trik/bot', {
		headers: { Authorization: `Bearer ${token}` }
	});
	const bot = res.ok ? ((await res.json()).bot ?? null) : null;
	return { bot };
};

export const actions: Actions = {
	save: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();
		const bio       = String(form.get('bio') ?? '').trim();
		const avatarUrl = String(form.get('avatarUrl') ?? '').trim();

		const res = await apiFetch(fetch, '/admin/trik/bot', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				bio:       bio || null,
				avatarUrl: avatarUrl || null,
			})
		});

		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao salvar' });
		}
		return { ok: true };
	}
};
