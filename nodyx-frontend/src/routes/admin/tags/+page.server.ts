import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch }) => {
	const res  = await apiFetch(fetch, '/instance/tags');
	const { tags } = res.ok ? await res.json() : { tags: [] };
	return { tags };
};

export const actions: Actions = {
	create: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const name  = (form.get('name')  as string).trim();
		const color = (form.get('color') as string) || '#6366f1';

		if (!name) return fail(400, { error: 'Le nom est obligatoire.' });

		const res = await apiFetch(fetch, '/instance/tags', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ name, color }),
		});
		if (!res.ok) return fail(res.status, { error: (await res.json()).error ?? 'Erreur création tag' });
	},

	update: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const tagId = form.get('tag_id') as string;
		const name  = (form.get('name') as string).trim();
		const color = form.get('color') as string;

		if (!name) return fail(400, { error: 'Le nom est obligatoire.' });

		const res = await apiFetch(fetch, `/instance/tags/${tagId}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ name, color }),
		});
		if (!res.ok) return fail(res.status, { error: (await res.json()).error ?? 'Erreur modification tag' });
		return { updated: tagId };
	},

	// Reordena uma tag uma posição para cima/baixo e grava a ordem completa.
	reorder: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form = await request.formData();

		// Recebe a sequência de IDs enviada pelo frontend.
		let ids: string[];

		try {
			ids = JSON.parse(String(form.get('ids') ?? ''));
		} catch {
			return fail(400, { error: 'Ordem de tags inválida.' });
		}

		if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
			return fail(400, { error: 'Ordem de tags inválida.' });
		}

		// Consulta a lista atual para validar os IDs recebidos.
		const list = await apiFetch(fetch, '/instance/tags');

		if (!list.ok) {
			return fail(list.status, { error: 'Não foi possível consultar as tags.' });
		}

		const { tags } = await list.json();
		const currentIds: string[] = tags.map((tag: { id: string }) => tag.id);

		// Impede IDs repetidos, ausentes ou desconhecidos.
		const isValid =
			ids.length === currentIds.length &&
			new Set(ids).size === currentIds.length &&
			ids.every((id) => currentIds.includes(id));

		if (!isValid) {
			return fail(400, { error: 'A lista de tags recebida é inválida.' });
		}

		// Persiste a nova ordem no backend.
		const res = await apiFetch(fetch, '/instance/tags/order', {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ ids }),
		});

		if (!res.ok) {
			const result = await res.json();
			return fail(res.status, {
				error: result.error ?? 'Erro ao reorganizar tags.',
			});
		}

		return { reordered: true };
	},

	delete: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!;
		const form  = await request.formData();
		const tagId = form.get('tag_id') as string;

		await apiFetch(fetch, `/instance/tags/${tagId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		});
	},
};
