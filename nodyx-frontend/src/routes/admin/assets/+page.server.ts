import { fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent, url }) => {
	const { token } = await parent()
	// ?type= filtra por categoria (ex.: o Bulk de todos os usuários, trik_019).
	const type = url.searchParams.get('type') ?? ''
	const res = await apiFetch(fetch, `/assets/admin/all${type ? `?type=${encodeURIComponent(type)}` : ''}`, {
		headers: { Authorization: `Bearer ${token}` },
	})
	if (!res.ok) return { assets: [], type }
	const { assets } = await res.json()
	return { assets, type }
}

export const actions: Actions = {
	delete: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form  = await request.formData()
		const id    = form.get('id') as string
		const res = await apiFetch(fetch, `/assets/${id}/force`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
	},

	ban: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form  = await request.formData()
		const id    = form.get('id') as string
		const res = await apiFetch(fetch, `/assets/${id}/ban`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
	},
}
