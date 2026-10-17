import { error, redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ params, fetch, parent }) => {
	const { username } = params
	const { user, token } = await parent()

	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

	// Profile + initial posts in parallel
	const [profileRes, postsRes] = await Promise.all([
		apiFetch(fetch, `/users/${username}/profile`),
		apiFetch(fetch, `/social/${username}/posts?limit=10`),
	])

	if (profileRes.status === 404) {
		// Nome antigo de quem trocou (username_history): leva ao perfil atual,
		// pra links e menções antigas continuarem funcionando.
		const resolved = await apiFetch(fetch, `/users/resolve/${encodeURIComponent(username)}`)
		if (resolved.ok) redirect(301, `/users/${encodeURIComponent((await resolved.json()).username)}`)
		error(404, 'Utilisateur introuvable')
	}
	if (!profileRes.ok)            error(500, 'Erreur serveur')

	const profile = await profileRes.json()
	const posts   = postsRes.ok ? (await postsRes.json()).posts ?? [] : []

	// Check if viewer follows this user (only if logged in and not own profile)
	let isFollowing = false
	if (user && token && user.username.toLowerCase() !== username.toLowerCase()) {
		try {
			const r = await apiFetch(fetch, `/social/${username}/is-following`, { headers })
			if (r.ok) isFollowing = (await r.json()).following ?? false
		} catch { /* ignore */ }
	}

	return { profile, posts, isFollowing }
}
