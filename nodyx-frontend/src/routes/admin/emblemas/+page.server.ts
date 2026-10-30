import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const res = await apiFetch(fetch, '/admin/emblemas', {
		headers: { Authorization: `Bearer ${token}` }
	});
	const json = res.ok ? await res.json() : { badges: [], members: [] };
	return { badges: json.badges ?? [], members: json.members ?? [] };
};

export const actions: Actions = {
	give: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();
		const userId = String(form.get('user_id') ?? '');
		// Vazio no select = tirar o emblema
		const badgeId = String(form.get('badge_asset_id') ?? '') || null;

		const res = await apiFetch(fetch, `/admin/emblemas/${userId}`, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ badge_asset_id: badgeId })
		});
		if (!res.ok) {
			const j = await res.json().catch(() => ({}));
			return fail(400, { error: j.error ?? 'Não foi possível salvar', userId });
		}
		return { ok: true, userId };
	}
};
