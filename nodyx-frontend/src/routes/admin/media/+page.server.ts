import { fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

// Charge en parallèle les 3 types de médias : images, vidéos, audio. Chaque
// onglet est listé indépendamment côté frontend, l'utilisateur choisit lequel
// afficher via les tabs. Le upload se fait avec le type courant pré-rempli.
export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent()
	const auth = { headers: { Authorization: `Bearer ${token}` } }

	// Imagens (trik_019): o tipo genérico 'image' acabou. O admin envia como
	// 'staff' e vê também o próprio Bulk (onde as imagens antigas caíram).
	const [staffRes, bulkRes, vidRes, audRes] = await Promise.all([
		apiFetch(fetch, '/assets/staff', auth),
		apiFetch(fetch, '/assets/mine/bulk', auth),
		apiFetch(fetch, '/assets?type=video&limit=100', auth),
		apiFetch(fetch, '/assets?type=sound&limit=100', auth),
	])

	const images = [
		...(staffRes.ok ? (await staffRes.json()).assets ?? [] : []),
		...(bulkRes.ok ? (await bulkRes.json()).assets ?? [] : []),
	]
	const videos = vidRes.ok ? (await vidRes.json()).assets ?? [] : []
	const audios = audRes.ok ? (await audRes.json()).assets ?? [] : []

	return { images, videos, audios }
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
}
