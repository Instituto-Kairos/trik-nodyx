import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { error, fail, redirect } from '@sveltejs/kit';

// Aba "Conta" das Configurações: troca de nome de usuário (1 vez a cada 30
// dias, username_history). Fica isolada aqui — e não na edição de perfil —
// pra não ser enviada junto com outras mudanças nem perder o que não foi salvo.
export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	if (!token) return { usernameNextChangeAt: null };
	const res = await apiFetch(fetch, '/users/me/username', { headers: { Authorization: `Bearer ${token}` } });
	return { usernameNextChangeAt: res.ok ? ((await res.json()).nextChangeAt as string | null) : null };
};

export const actions: Actions = {
	// O core encerra as sessões antigas e devolve um token novo (o token
	// carrega o username) — grava no cookie igual ao login.
	changeUsername: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const username = String((await request.formData()).get('username') ?? '').trim();
		if (username.length < 3) return fail(400, { usernameError: 'O nome precisa ter pelo menos 3 caracteres.' });

		const res = await apiFetch(fetch, '/users/me/username', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ username })
		});
		const json = await res.json().catch(() => ({}));
		if (!res.ok) return fail(res.status, { usernameError: json.error ?? 'Não foi possível trocar o nome.' });

		cookies.set('token', json.token, {
			path:     '/',
			httpOnly: true,
			sameSite: 'lax',
			secure:   true,
			maxAge:   60 * 60 * 24 * 7
		});
		redirect(302, `/settings?section=account&username_changed=${encodeURIComponent(json.username)}`);
	}
};
