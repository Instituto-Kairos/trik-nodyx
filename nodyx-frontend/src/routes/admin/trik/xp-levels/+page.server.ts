import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

const XP_TYPES = ['character', 'knowledge', 'weapon'] as const;
type XpType = (typeof XP_TYPES)[number];

function resolveType(raw: string | null): XpType {
	return (XP_TYPES as readonly string[]).includes(raw ?? '') ? (raw as XpType) : 'character';
}

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const type = resolveType(url.searchParams.get('type'));
	const token = cookies.get('token');
	const res = await apiFetch(fetch, `/admin/trik/xp-levels?type=${type}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	const levels = res.ok ? ((await res.json()).levels ?? []) : [];
	return { levels, type };
};

export const actions: Actions = {
	save: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form = await request.formData();
		const type = resolveType(String(form.get('type') ?? ''));
		const levelsRaw = String(form.get('levels') ?? '[]');

		let levels: unknown;
		try {
			levels = JSON.parse(levelsRaw);
		} catch {
			return fail(400, { error: 'JSON inválido' });
		}

		const res = await apiFetch(fetch, '/admin/trik/xp-levels', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ type, levels })
		});

		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erro ao salvar' });
		}
		return { ok: true };
	}
};
