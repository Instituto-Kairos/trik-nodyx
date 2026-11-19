import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies, parent }) => {
	const token = cookies.get('token');
	const headers = { Authorization: `Bearer ${token}` };

	if ((await parent()).auNarrator) {
		const panel = await apiFetch(fetch, '/trik/au-panel', { headers });
		const json = panel.ok ? await panel.json() : {};
		return {
			readOnly: true,
			scope: (json.scope ?? 'narrator') as 'moderator' | 'narrator',
			categories: [],
			narrators: json.narrators ?? [],
			roots: json.roots ?? [],
			characters: json.characters ?? []
		};
	}

	const [res, charRes, narRes] = await Promise.all([
		apiFetch(fetch, '/admin/trik/au-categories', { headers }),
		apiFetch(fetch, '/admin/trik/au-characters', { headers }),
		apiFetch(fetch, '/admin/trik/au-narrators', { headers })
	]);
	const categories = res.ok ? ((await res.json()).categories ?? []) : [];
	const characters = charRes.ok ? ((await charRes.json()).characters ?? []) : [];
	const narrators = narRes.ok ? ((await narRes.json()).narrators ?? []) : [];
	return { readOnly: false, scope: 'admin' as const, categories, characters, narrators, roots: [] };
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

	adjustXp: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const amount = Math.abs(Math.trunc(Number(form.get('amount'))));
		const sign = form.get('op') === 'sub' ? -1 : 1;
		if (!amount) return fail(400, { error: 'Informe uma quantidade de XP maior que zero' });
		const res = await apiFetch(fetch, `/trik/au-characters/${form.get('characterId')}/xp`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cookies.get('token')}` },
			body: JSON.stringify({ delta: sign * amount })
		});
		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao ajustar XP' });
		}
		return { ok: true };
	},

	editCharacter: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const res = await apiFetch(fetch, `/trik/au-characters/${form.get('characterId')}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cookies.get('token')}` },
			body: JSON.stringify({
				name: String(form.get('name') ?? '').trim(),
				fichaLink: String(form.get('fichaLink') ?? '').trim()
			})
		});
		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao editar personagem' });
		}
		return { ok: true };
	},

	deleteCharacter: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const res = await apiFetch(fetch, `/trik/au-characters/${form.get('characterId')}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${cookies.get('token')}` }
		});
		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao excluir personagem' });
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
