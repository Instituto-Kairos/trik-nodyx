import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const res = await apiFetch(fetch, '/admin/trik/bonus', {
		headers: { Authorization: `Bearer ${token}` }
	});
	const entries = res.ok ? ((await res.json()).entries ?? []) : [];
	return { entries };
};

export const actions: Actions = {
	create: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();
		const bonusType = String(form.get('bonusType') ?? '').trim();
		const bonusValue = String(form.get('bonusValue') ?? '').trim();
		const isCategory = form.get('isCategory') === 'on';
		if (!bonusType) return fail(400, { error: 'Digite o tipo de bônus' });
		if (!bonusValue) return fail(400, { error: 'Digite o valor do bônus' });

		const res = await apiFetch(fetch, '/admin/trik/bonus', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ bonusType, bonusValue, isCategory })
		});

		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao cadastrar' });
		}
		return { ok: true, created: bonusType };
	},

	delete: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Item inválido' });

		const res = await apiFetch(fetch, `/admin/trik/bonus/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` }
		});

		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao remover' });
		}
		return { ok: true, removed: true };
	}
};
