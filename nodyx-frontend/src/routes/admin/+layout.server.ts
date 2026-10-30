import { redirect, error } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: LayoutServerLoad = async ({ fetch, cookies, url }) => {
	const token = cookies.get('token')
	if (!token) redirect(302, `/auth/login?redirectTo=${encodeURIComponent(url.pathname)}`)

	// Verify admin access by calling a protected endpoint
	const res = await apiFetch(fetch, '/admin/stats', {
		headers: { Authorization: `Bearer ${token}` },
	})

	if (res.status === 401) redirect(302, `/auth/login?redirectTo=${encodeURIComponent(url.pathname)}`)
	if (res.status === 403) {
		// Narrador de AU (trik_015) não é admin: entra só nesta aba, só leitura.
		if (url.pathname === '/admin/trik/au') {
			const panel = await apiFetch(fetch, '/trik/au-panel', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (panel.ok) return { token, stats: null, updateCheck: null, auNarrator: true }
		}
		redirect(302, '/')
	}
	if (!res.ok) error(503, 'Service temporairement indisponible')

	const stats = await res.json()

	const updateRes = await apiFetch(fetch, '/admin/update-check', {
		headers: { Authorization: `Bearer ${token}` },
	}).catch(() => null)
	const updateCheck = updateRes?.ok ? await updateRes.json().catch(() => null) : null

	return { token, stats, updateCheck, auNarrator: false }
}
