import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const res = await apiFetch(fetch, '/admin/trik/channels', {
		headers: { Authorization: `Bearer ${token}` }
	});
	const channels = res.ok ? ((await res.json()).channels ?? []) : [];
	return { channels };
};

export const actions: Actions = {
	save: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();
		const entriesRaw = String(form.get('entries') ?? '[]');

		let entries: { channelId: string; purpose: string }[];
		try {
			entries = JSON.parse(entriesRaw);
		} catch {
			return fail(400, { error: 'JSON inválido' });
		}

		const res = await apiFetch(fetch, '/admin/trik/channels', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ entries })
		});

		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao salvar' });
		}
		return { ok: true };
	}
};
