import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = cookies.get('token')
	if (!token) redirect(303, '/auth/login?redirectTo=/galeria')

	const headers = { Authorization: `Bearer ${token}` }

	const album = url.searchParams.get('album') ?? ''
	const q     = url.searchParams.get('q') ?? ''
	const tag   = url.searchParams.get('tag') ?? ''

	// `offset` vem da URL para a paginação sobreviver ao botão voltar e a um link
	// compartilhado. Saneado aqui: um offset negativo ou não-numérico produziria
	// SQL inválido do outro lado.
	const LIMITE = 40
	const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)

	const params = new URLSearchParams({ limit: String(LIMITE), offset: String(offset) })
	if (album) params.set('album', album)
	if (q)     params.set('q', q)
	if (tag)   params.set('tag', tag)

	const [resAlbums, resImages] = await Promise.all([
		apiFetch(fetch, '/galeria/albums', { headers }),
		apiFetch(fetch, `/galeria/images?${params}`, { headers }),
	])

	// 503 = módulo desligado nesta instância. A página diz isso em vez de
	// mostrar uma galeria vazia, que seria indistinguível de "ninguém enviou
	// nada ainda".
	const moduloDesligado = resAlbums.status === 503 || resImages.status === 503

	const albums = resAlbums.ok ? (await resAlbums.json()).albums ?? [] : []
	const dados  = resImages.ok ? await resImages.json() : { images: [], total: 0 }

	return {
		albums,
		images: dados.images ?? [],
		total:  dados.total ?? 0,
		album, q, tag,
		offset, limite: LIMITE,
		moduloDesligado,
		token,
	}
}
