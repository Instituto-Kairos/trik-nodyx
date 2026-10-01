import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const headers = { Authorization: `Bearer ${cookies.get('token')}` };
	// O catálogo alimenta os dropdowns de panteão/vínculo do "Editar" — os
	// mesmos do modal de /registro.
	const [res, pRes] = await Promise.all([
		apiFetch(fetch, '/admin/trik/registros', { headers }),
		apiFetch(fetch, '/admin/trik/pantheons', { headers })
	]);
	const players = res.ok ? ((await res.json()).players ?? []) : [];
	const pantheons = pRes.ok ? ((await pRes.json()).pantheons ?? []) : [];
	return { players, pantheons, failed: !res.ok };
};

/** Campo de texto opcional: vazio vira null (apagar o valor), não string vazia. */
function opt(form: FormData, key: string): string | null {
	const v = String(form.get(key) ?? '').trim();
	return v === '' ? null : v;
}

async function patch(
	fetch: typeof globalThis.fetch,
	token: string | undefined,
	path: string,
	body: Record<string, unknown>
): Promise<string | null> {
	const res = await apiFetch(fetch, path, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(body)
	});
	if (res.ok) return null;
	const json = await res.json().catch(() => ({}));
	return json.error ?? 'Erro ao salvar';
}

// Uma action por entidade, espelhando os dois endpoints do core. Jogador e
// personagem são tabelas separadas na tela, então cada formulário é um PATCH
// só — nada de salvar metade de um registro se o outro lado falhar.
export const actions: Actions = {
	togglePermit: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const playerId = String(form.get('playerId') ?? '');
		if (!playerId) return fail(400, { error: 'Jogador inválido' });

		const error = await patch(fetch, cookies.get('token'), `/admin/trik/registros/players/${playerId}`, {
			permitActive: form.get('active') === '1'
		});
		if (error) return fail(400, { error });
		return { ok: true };
	},

	savePlayer: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const playerId = String(form.get('playerId') ?? '');
		if (!playerId) return fail(400, { error: 'Jogador inválido' });

		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'O nome do jogador não pode ficar vazio' });

		const error = await patch(fetch, cookies.get('token'), `/admin/trik/registros/players/${playerId}`, {
			name,
			pronouns: opt(form, 'pronouns'),
			birthDate: opt(form, 'birthDate')
		});
		if (error) return fail(400, { error });
		return { ok: true, saved: 'jogador' };
	},

	saveCharacter: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const characterId = String(form.get('characterId') ?? '');
		if (!characterId) return fail(400, { error: 'Personagem inválido' });

		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'O nome do personagem não pode ficar vazio' });
		// ficha_link é NOT NULL: apagar o campo não é uma edição válida.
		const fichaLink = opt(form, 'fichaLink');
		if (!fichaLink) return fail(400, { error: 'O link da ficha não pode ficar vazio' });

		const body: Record<string, unknown> = {
			name,
			pronouns: opt(form, 'pronouns'),
			birthDate: opt(form, 'birthDate'),
			faceclaimName: opt(form, 'faceclaimName'),
			faceclaimBirthDate: opt(form, 'faceclaimBirthDate'),
			fichaLink,
			divineGift: opt(form, 'divineGift')
		};
		// Panteão/vínculo só vão se o admin mexeu nos dropdowns: reenviar sem
		// mudança apagaria o texto livre de registros antigos (sem id no
		// catálogo), que o dropdown não tem como representar.
		if (form.get('divineChanged') === '1') {
			body.pantheonId = opt(form, 'pantheonId');
			body.divineBondId = opt(form, 'divineBondId');
		}

		const error = await patch(fetch, cookies.get('token'), `/admin/trik/registros/characters/${characterId}`, body);
		if (error) return fail(400, { error });
		return { ok: true, saved: 'personagem' };
	},

	deleteCharacter: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const characterId = String(form.get('characterId') ?? '');
		if (!characterId) return fail(400, { error: 'Personagem inválido' });

		const res = await apiFetch(fetch, `/admin/trik/registros/characters/${characterId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${cookies.get('token')}` }
		});
		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(400, { error: json.error ?? 'Erro ao excluir' });
		}
		return { ok: true, deleted: String(form.get('name') ?? 'Personagem') };
	}
};
