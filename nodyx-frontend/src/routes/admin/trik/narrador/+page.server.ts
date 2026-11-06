import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail, redirect } from '@sveltejs/kit';

// trik_018: vários narradores, cada um com a sua tag. A aba mostra uma sub-aba
// por narrador (?u=<userId>); sem ?u, abre o primeiro.
export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = cookies.get('token');
	const headers = { Authorization: `Bearer ${token}` };

	const resList = await apiFetch(fetch, '/admin/trik/narradores', { headers });
	if (!resList.ok) return { narrators: [], selected: null, detail: null, loadError: true };
	const narrators: Array<{ user_id: string; username: string; tags: string[]; is_main: boolean; available: number }> =
		(await resList.json()).narrators ?? [];

	const wanted = url.searchParams.get('u');
	const selected = narrators.find((n) => n.user_id === wanted) ?? narrators[0] ?? null;
	if (!selected) return { narrators, selected: null, detail: null, loadError: false };

	const resDetail = await apiFetch(fetch, `/admin/trik/narradores/${selected.user_id}`, { headers });
	return {
		narrators,
		selected: selected.user_id,
		detail: resDetail.ok ? await resDetail.json() : null,
		loadError: !resDetail.ok
	};
};

const json = (token: string | undefined) => ({
	'Content-Type': 'application/json',
	Authorization: `Bearer ${token}`
});

export const actions: Actions = {
	adicionar: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const tag = String(form.get('tag') ?? '').trim();
		if (!username || !tag) return fail(400, { addError: 'Preencha o usuário e a tag' });

		const res = await apiFetch(fetch, '/admin/trik/narradores', {
			method: 'POST',
			headers: json(cookies.get('token')),
			body: JSON.stringify({ username, tag })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) return fail(res.status, { addError: body.error ?? 'Erro ao adicionar narrador' });
		redirect(303, `/admin/trik/narrador?u=${body.narrator.user_id}`);
	},

	remover: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const res = await apiFetch(fetch, `/admin/trik/narradores/${userId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${cookies.get('token')}` }
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			return fail(res.status, { error: body.error ?? 'Erro ao remover narrador' });
		}
		redirect(303, '/admin/trik/narrador');
	},

	// trik_020: tags extras do narrador (uma ou várias, separadas por espaço/vírgula).
	adicionarTag: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const tag = String(form.get('tag') ?? '').trim();
		if (!tag) return fail(400, { tagError: 'Digite a tag' });

		const res = await apiFetch(fetch, `/admin/trik/narradores/${userId}/tags`, {
			method: 'POST',
			headers: json(cookies.get('token')),
			body: JSON.stringify({ tag })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) return fail(res.status, { tagError: body.error ?? 'Erro ao adicionar tag' });
		return { tagAdded: true };
	},

	removerTag: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const tag = String(form.get('tag') ?? '');
		const res = await apiFetch(
			fetch,
			`/admin/trik/narradores/${userId}/tags/${encodeURIComponent(tag)}`,
			{ method: 'DELETE', headers: { Authorization: `Bearer ${cookies.get('token')}` } }
		);
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			return fail(res.status, { tagError: body.error ?? 'Erro ao remover tag' });
		}
		return { tagRemoved: true };
	},

	distribuir: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		// Valor do select: "main:<id>" (personagem do /registro) ou "au:<id>" (/registro-au).
		const [kind, characterId] = String(form.get('character') ?? '').split(':');
		const xp = Number(form.get('xp'));
		if (!characterId) return fail(400, { error: 'Escolha um personagem' });
		if (!Number.isInteger(xp) || xp <= 0) return fail(400, { error: 'Digite uma quantidade de XP válida' });

		const res = await apiFetch(fetch, `/admin/trik/narradores/${userId}/distribuir`, {
			method: 'POST',
			headers: json(cookies.get('token')),
			body: JSON.stringify({ characterId, xp, au: kind === 'au' })
		});

		const body = await res.json().catch(() => ({}));
		if (!res.ok) return fail(res.status, { error: body.error ?? 'Erro ao distribuir' });
		return {
			ok: true,
			distributed: { xp, characterName: body.characterName as string, leveledUp: !!body.leveledUp }
		};
	}
};
