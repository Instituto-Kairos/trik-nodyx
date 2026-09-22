import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

const CATALOG_TYPES = ['weapon', 'knowledge'] as const;
type CatalogType = (typeof CATALOG_TYPES)[number];

function resolveType(raw: string | null): CatalogType {
	return (CATALOG_TYPES as readonly string[]).includes(raw ?? '') ? (raw as CatalogType) : 'weapon';
}

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const type = resolveType(url.searchParams.get('type'));
	const token = cookies.get('token');
	const res = await apiFetch(fetch, `/admin/trik/catalog?type=${type}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	const entries = res.ok ? ((await res.json()).entries ?? []) : [];
	return { entries, type };
};

export const actions: Actions = {
	create: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();
		const type = resolveType(String(form.get('type') ?? ''));
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Digite um nome' });
		// Categoria só existe pra arma (validação de bônus por categoria, Fase 3).
		const category = String(form.get('category') ?? '').trim();
		if (type === 'weapon' && !category) return fail(400, { error: 'Informe a categoria da arma' });

		const res = await apiFetch(fetch, '/admin/trik/catalog', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify(type === 'weapon' ? { type, name, category } : { type, name })
		});

		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao cadastrar' });
		}
		return { ok: true, created: name };
	},

	delete: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();
		const type = resolveType(String(form.get('type') ?? ''));
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Item inválido' });

		const res = await apiFetch(fetch, `/admin/trik/catalog/${encodeURIComponent(id)}?type=${type}`, {
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
