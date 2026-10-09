import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const res = await apiFetch(fetch, '/admin/trik/narrador', {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) return { narrador: null, loadError: true };
	return { narrador: await res.json(), loadError: false };
};

export const actions: Actions = {
	distribuir: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();
		const characterId = String(form.get('characterId') ?? '');
		const xp = Number(form.get('xp'));
		if (!characterId) return fail(400, { error: 'Escolha um personagem' });
		if (!Number.isInteger(xp) || xp <= 0) return fail(400, { error: 'Digite uma quantidade de XP válida' });

		const res = await apiFetch(fetch, '/admin/trik/narrador/distribuir', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ characterId, xp })
		});

		const json = await res.json().catch(() => ({}));
		if (!res.ok) return fail(res.status, { error: json.error ?? 'Erro ao distribuir' });
		return {
			ok: true,
			distributed: { xp, characterName: json.characterName as string, leveledUp: !!json.leveledUp }
		};
	}
};
