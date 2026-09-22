import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const res = await apiFetch(fetch, '/admin/trik/registros', {
		headers: { Authorization: `Bearer ${token}` }
	});
	const players = res.ok ? ((await res.json()).players ?? []) : [];
	return { players, failed: !res.ok };
};
