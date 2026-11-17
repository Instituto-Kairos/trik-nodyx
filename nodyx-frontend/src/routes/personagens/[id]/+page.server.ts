import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';
import { error, redirect } from '@sveltejs/kit';

// Ficha do personagem, só leitura, pro jogador dono. O core devolve 404 pro
// personagem de outro jogador — a edição continua só em /admin/trik/registros/:id.
export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
	const token = cookies.get('token');
	if (!token) redirect(303, '/auth/login');

	const res = await apiFetch(fetch, `/trik/characters/${encodeURIComponent(params.id)}/sheet`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.status === 404 || res.status === 400) error(404, 'Personagem não encontrado');
	if (!res.ok) error(500, 'Erro ao carregar a ficha');

	const { sheet, weapons, knowledges } = await res.json();
	return { sheet, weapons: weapons ?? [], knowledges: knowledges ?? [] };
};
