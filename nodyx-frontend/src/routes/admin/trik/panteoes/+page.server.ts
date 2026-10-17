import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';
import { effectActions, loadEffectTargets } from '$lib/server/trikEffects';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const [pRes, targets] = await Promise.all([
		apiFetch(fetch, '/admin/trik/pantheons', { headers: { Authorization: `Bearer ${token}` } }),
		loadEffectTargets(fetch, token)
	]);
	const pantheons = pRes.ok ? ((await pRes.json()).pantheons ?? []) : [];
	return { pantheons, ...targets };
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

export const actions: Actions = {
	createPantheon: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Digite o nome do panteão' });
		return (await send(fetch, cookies.get('token'), '/admin/trik/pantheons', 'POST', { name })) ?? { ok: true, created: name };
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
		return (await send(fetch, cookies.get('token'), `/admin/trik/pantheons/${encodeURIComponent(pantheonId)}/deities`, 'POST', { name })) ?? { ok: true, created: name };
	},

	deleteDeity: async ({ request, fetch, cookies }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'Item inválido' });
		return (await send(fetch, cookies.get('token'), `/admin/trik/deities/${encodeURIComponent(id)}`, 'DELETE')) ?? { ok: true, removed: true };
	},

	...effectActions
};
