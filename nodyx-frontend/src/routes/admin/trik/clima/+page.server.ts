import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const headers = { Authorization: `Bearer ${cookies.get('token')}` };
	const [lRes, wRes] = await Promise.all([
		apiFetch(fetch, '/admin/trik/locations', { headers }),
		apiFetch(fetch, '/admin/trik/game-week', { headers })
	]);
	const locations = lRes.ok ? ((await lRes.json()).locations ?? []) : [];
	const week = wRes.ok ? await wRes.json() : { weekStart: null, weather: [] };
	return { locations, weekStart: week.weekStart as string | null, weather: week.weather ?? [] };
};

/** Domingo da semana que contém `date` (YYYY-MM-DD). */
function sundayOf(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - d.getUTCDay());
	return d.toISOString().slice(0, 10);
}

async function errorOf(res: Response, fallback: string) {
	const json = await res.json().catch(() => ({}));
	return json.error ?? fallback;
}

export const actions: Actions = {
	createLocation: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const latitude = Number(String(form.get('latitude') ?? '').replace(',', '.'));
		const longitude = Number(String(form.get('longitude') ?? '').replace(',', '.'));
		if (!name) return fail(400, { error: 'Digite o nome da região' });
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
			return fail(400, { error: 'Latitude e longitude precisam ser números (ex.: 29.95107 e -90.07153)' });
		}
		const res = await apiFetch(fetch, '/admin/trik/locations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cookies.get('token')}` },
			body: JSON.stringify({ name, latitude, longitude })
		});
		if (!res.ok) return fail(res.status, { error: await errorOf(res, 'Erro ao cadastrar') });
		return { ok: true, created: name };
	},

	deleteLocation: async ({ request, fetch, cookies }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'Região inválida' });
		const res = await apiFetch(fetch, `/admin/trik/locations/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${cookies.get('token')}` }
		});
		if (!res.ok) return fail(res.status, { error: await errorOf(res, 'Erro ao remover') });
		return { ok: true };
	},

	// Qualquer dia escolhido vira o domingo da semana dele.
	setWeek: async ({ request, fetch, cookies }) => {
		const date = String((await request.formData()).get('date') ?? '');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, { error: 'Escolha uma data' });
		const res = await apiFetch(fetch, '/admin/trik/game-week', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cookies.get('token')}` },
			body: JSON.stringify({ weekStart: sundayOf(date) })
		});
		if (!res.ok) return fail(res.status, { error: await errorOf(res, 'Erro ao selecionar a semana') });
		const json = await res.json();
		return { ok: true, weekSet: true, failed: (json.failed ?? []) as string[], noticeSent: json.noticeSent === true };
	}
};
