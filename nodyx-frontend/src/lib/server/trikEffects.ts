// Módulo RPG (trik) — Fase 3: actions compartilhadas do EffectsEditor
// (abas Bônus e Panteões). O formulário do editor manda o alvo codificado num
// campo só ("weapon:<id>", "weaponCat:<nome>", "knowledge:<id>",
// "knowledgeCat:<nome>"); aqui ele vira os campos que POST /effects espera.
// A validação de verdade fica no core (zod + CHECKs) — o erro volta legível.

import { fail, type Action } from '@sveltejs/kit';
import { apiFetch } from '$lib/api';

/** Armas e matérias do catálogo — alvo específico e categorias do editor. */
export async function loadEffectTargets(fetch: typeof globalThis.fetch, token: string | undefined) {
	const headers = { Authorization: `Bearer ${token}` };
	const [wRes, kRes] = await Promise.all([
		apiFetch(fetch, '/admin/trik/catalog?type=weapon', { headers }),
		apiFetch(fetch, '/admin/trik/catalog?type=knowledge', { headers })
	]);
	const weapons = wRes.ok ? ((await wRes.json()).entries ?? []) : [];
	const knowledges = kRes.ok ? ((await kRes.json()).entries ?? []) : [];
	return { weapons, knowledges };
}

const TARGET_FIELD: Record<string, string> = {
	weapon: 'weaponId',
	weaponCat: 'weaponCategory',
	knowledge: 'knowledgeId',
	knowledgeCat: 'knowledgeCategory'
};

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

const addEffect: Action = async ({ request, fetch, cookies }) => {
	const form = await request.formData();
	const body: Record<string, unknown> = {
		ownerKind: str(form, 'ownerKind'),
		ownerId: str(form, 'ownerId'),
		effect: str(form, 'effect'),
		activity: str(form, 'activity') || 'todas',
		conditionKind: str(form, 'conditionKind') || 'sempre'
	};
	const target = str(form, 'target');
	if (target) {
		const sep = target.indexOf(':');
		const field = TARGET_FIELD[target.slice(0, sep)];
		if (field) body[field] = target.slice(sep + 1);
	}
	if (str(form, 'alertKind')) body.alertKind = str(form, 'alertKind');
	if (str(form, 'conditionValue')) body.conditionValue = str(form, 'conditionValue');
	const value = str(form, 'value').replace(',', '.');
	if (value) body.value = Number(value);

	const res = await apiFetch(fetch, '/admin/trik/effects', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cookies.get('token')}` },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const json = await res.json().catch(() => ({}));
		return fail(res.status, { error: json.error ?? 'Erro ao salvar o efeito' });
	}
	return { ok: true, effectSaved: true };
};

const deleteEffect: Action = async ({ request, fetch, cookies }) => {
	const id = str(await request.formData(), 'id');
	if (!id) return fail(400, { error: 'Efeito inválido' });
	const res = await apiFetch(fetch, `/admin/trik/effects/${encodeURIComponent(id)}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${cookies.get('token')}` }
	});
	if (!res.ok) {
		const json = await res.json().catch(() => ({}));
		return fail(res.status, { error: json.error ?? 'Erro ao remover o efeito' });
	}
	return { ok: true };
};

export const effectActions = { addEffect, deleteEffect };
