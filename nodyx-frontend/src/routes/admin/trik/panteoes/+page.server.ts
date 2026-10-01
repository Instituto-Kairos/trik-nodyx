import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const headers = { Authorization: `Bearer ${cookies.get('token')}` };
	const [pRes, bRes] = await Promise.all([
		apiFetch(fetch, '/admin/trik/pantheons', { headers }),
		apiFetch(fetch, '/admin/trik/bonus', { headers })
	]);
	const pantheons = pRes.ok ? ((await pRes.json()).pantheons ?? []) : [];
	const bonuses = bRes.ok ? ((await bRes.json()).entries ?? []) : [];
	return { pantheons, bonuses };
};

async function send(fetch: typeof globalThis.fetch, token: string | undefined, path: string, method: string, body?: object) {
	const res = await apiFetch(fetch, path, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			...(body ? { 'Content-Type': 'application/json' } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	if (res.ok) return null;
	const json = await res.json().catch(() => ({}));
	return fail(res.status, { error: json.error ?? 'Erro ao salvar' });
}

const bonusIdOf = (form: FormData) => String(form.get('bonusId') ?? '') || null;

export const actions: Actions = {
	createPantheon: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const category = String(form.get('category') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		if (!category) return fail(400, { error: 'Digite a categoria do panteão' });
		if (!name) return fail(400, { error: 'Digite o nome do panteão' });
		return (await send(fetch, cookies.get('token'), '/admin/trik/pantheons', 'POST', { category, name, bonusId: bonusIdOf(form) })) ?? { ok: true, created: name };
	},

	setPantheonBonus: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Item inválido' });
		return (await send(fetch, cookies.get('token'), `/admin/trik/pantheons/${encodeURIComponent(id)}`, 'PATCH', { bonusId: bonusIdOf(form) })) ?? { ok: true };
	},

	deletePantheon: async ({ request, fetch, cookies }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'Item inválido' });
		return (await send(fetch, cookies.get('token'), `/admin/trik/pantheons/${encodeURIComponent(id)}`, 'DELETE')) ?? { ok: true, removed: true };
	},

	createDeity: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const pantheonId = String(form.get('pantheonId') ?? '');
		const name = String(form.get('name') ?? '').trim();
		if (!pantheonId) return fail(400, { error: 'Panteão inválido' });
		if (!name) return fail(400, { error: 'Digite o nome da divindade' });
		return (await send(fetch, cookies.get('token'), `/admin/trik/pantheons/${encodeURIComponent(pantheonId)}/deities`, 'POST', { name, bonusId: bonusIdOf(form) })) ?? { ok: true, created: name };
	},

	setDeityBonus: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Item inválido' });
		return (await send(fetch, cookies.get('token'), `/admin/trik/deities/${encodeURIComponent(id)}`, 'PATCH', { bonusId: bonusIdOf(form) })) ?? { ok: true };
	},

	deleteDeity: async ({ request, fetch, cookies }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'Item inválido' });
		return (await send(fetch, cookies.get('token'), `/admin/trik/deities/${encodeURIComponent(id)}`, 'DELETE')) ?? { ok: true, removed: true };
	}
};
