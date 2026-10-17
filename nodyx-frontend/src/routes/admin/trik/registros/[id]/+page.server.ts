import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { error, fail } from '@sveltejs/kit';
import { loadEffectTargets } from '$lib/server/trikEffects';

const TRAIT_KINDS = ['disorder', 'disturbance', 'unique_ability', 'peculiarity'] as const;

// Ficha completa de um personagem: tudo que não cabe no resumo da aba
// Registros (que mostra só o que veio do /registro).
export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
	const token = cookies.get('token');
	const headers = { Authorization: `Bearer ${token}` };
	const [res, targets, ...catalogRes] = await Promise.all([
		apiFetch(fetch, `/admin/trik/characters/${encodeURIComponent(params.id)}/sheet`, { headers }),
		loadEffectTargets(fetch, token),
		...TRAIT_KINDS.map((kind) => apiFetch(fetch, `/admin/trik/bonus-catalog?kind=${kind}`, { headers }))
	]);
	if (res.status === 404) error(404, 'Personagem não encontrado');
	if (!res.ok) error(500, 'Erro ao carregar a ficha');

	const traitCatalog: Record<string, { id: string; name: string; category: string | null }[]> = {};
	for (const [i, kind] of TRAIT_KINDS.entries()) {
		traitCatalog[kind] = catalogRes[i].ok ? ((await catalogRes[i].json()).items ?? []) : [];
	}
	return { sheet: (await res.json()).sheet, traitCatalog, ...targets };
};

async function errorOf(res: Response, fallback: string) {
	const json = await res.json().catch(() => ({}));
	return json.error ?? fallback;
}

export const actions: Actions = {
	// Valor do select: "<kind>:<itemId>".
	unlockTrait: async ({ request, fetch, cookies, params }) => {
		const [kind, itemId] = String((await request.formData()).get('trait') ?? '').split(':');
		if (!kind || !itemId) return fail(400, { error: 'Escolha o item' });
		const res = await apiFetch(fetch, `/admin/trik/characters/${params.id}/traits`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cookies.get('token')}` },
			body: JSON.stringify({ kind, itemId })
		});
		if (!res.ok) return fail(400, { error: await errorOf(res, 'Erro ao desbloquear') });
		return { ok: true };
	},

	removeTrait: async ({ request, fetch, cookies, params }) => {
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '');
		const itemId = String(form.get('itemId') ?? '');
		if (!kind || !itemId) return fail(400, { error: 'Item inválido' });
		const res = await apiFetch(fetch, `/admin/trik/characters/${params.id}/traits/${kind}/${itemId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${cookies.get('token')}` }
		});
		if (!res.ok) return fail(400, { error: await errorOf(res, 'Erro ao remover') });
		return { ok: true };
	}
};
