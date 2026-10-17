import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';
import { effectActions, loadEffectTargets } from '$lib/server/trikEffects';

const KINDS = ['aptitude', 'preference', 'goal', 'disorder', 'disturbance', 'unique_ability', 'peculiarity'] as const;
type Kind = (typeof KINDS)[number];

function resolveKind(raw: string | null): Kind {
	return (KINDS as readonly string[]).includes(raw ?? '') ? (raw as Kind) : 'aptitude';
}

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const kind = resolveKind(url.searchParams.get('kind'));
	const token = cookies.get('token');
	const [res, targets] = await Promise.all([
		apiFetch(fetch, `/admin/trik/bonus-catalog?kind=${kind}`, { headers: { Authorization: `Bearer ${token}` } }),
		loadEffectTargets(fetch, token)
	]);
	const items = res.ok ? ((await res.json()).items ?? []) : [];
	return { kind, items, ...targets };
};

export const actions: Actions = {
	create: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const kind = resolveKind(String(form.get('kind') ?? ''));
		const name = String(form.get('name') ?? '').trim();
		const category = String(form.get('category') ?? '').trim();
		if (!name) return fail(400, { error: 'Digite um nome' });
		if (!category) return fail(400, { error: 'Escolha a categoria' });

		const res = await apiFetch(fetch, '/admin/trik/bonus-catalog', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cookies.get('token')}` },
			body: JSON.stringify({ kind, name, category })
		});
		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao cadastrar' });
		}
		return { ok: true, created: name };
	},

	setCategory: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const kind = resolveKind(String(form.get('kind') ?? ''));
		const id = String(form.get('id') ?? '');
		const category = String(form.get('category') ?? '').trim();
		if (!id || !category) return fail(400, { error: 'Escolha a categoria' });

		const res = await apiFetch(fetch, `/admin/trik/bonus-catalog/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cookies.get('token')}` },
			body: JSON.stringify({ kind, category })
		});
		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao trocar a categoria' });
		}
		return { ok: true };
	},

	delete: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const kind = resolveKind(String(form.get('kind') ?? ''));
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Item inválido' });

		const res = await apiFetch(fetch, `/admin/trik/bonus-catalog/${encodeURIComponent(id)}?kind=${kind}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${cookies.get('token')}` }
		});
		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao remover' });
		}
		return { ok: true, removed: true };
	},

	...effectActions
};
