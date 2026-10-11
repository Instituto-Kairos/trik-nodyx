import { error, redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
	const token = cookies.get('token')
	if (!token) redirect(303, `/auth/login?redirectTo=/galeria/${params.id}`)

	// Um id que não é UUID estouraria no Postgres do outro lado (500); aqui é
	// simplesmente uma página que não existe.
	if (!/^[0-9a-f-]{36}$/i.test(params.id)) error(404, 'Imagem não encontrada.')

	const headers = { Authorization: `Bearer ${token}` }
	const [resImg, resNotes, resAlbums] = await Promise.all([
		apiFetch(fetch, `/galeria/images/${params.id}`, { headers }),
		apiFetch(fetch, `/galeria/images/${params.id}/notes`, { headers }),
		apiFetch(fetch, '/galeria/albums', { headers }),
	])

	if (resImg.status === 503) error(503, 'O módulo Galeria está desativado.')
	if (!resImg.ok) error(404, 'Imagem não encontrada.')

	return {
		image:  (await resImg.json()).image,
		notes:  resNotes.ok ? (await resNotes.json()).notes ?? [] : [],
		albums: resAlbums.ok ? (await resAlbums.json()).albums ?? [] : [],
		token,
	}
}
