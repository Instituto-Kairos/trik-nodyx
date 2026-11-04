import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, url, parent }) => {
  const tab    = (url.searchParams.get('tab') ?? 'local') as 'local' | 'community'
  const q      = url.searchParams.get('q') ?? ''
  const type   = url.searchParams.get('type') ?? ''
  const offset = Number(url.searchParams.get('offset') ?? '0')

  const params = new URLSearchParams({ limit: '24', offset: String(offset) })
  if (q)    params.set('q', q)
  if (type) params.set('type', type)

  if (tab === 'community') {
    // Federated search across all directory instances
    const res = await apiFetch(fetch, `/directory/assets/search?${params}`)
    const json = res.ok ? await res.json() : { assets: [], total: 0 }
    return { tab, assets: json.assets ?? [], total: json.total ?? 0, q, type, offset }
  }

  // Bulk (privado, só o próprio) e Staff (só staff) não passam pela busca
  // pública: cada um tem a sua rota autenticada (trik_016 / trik_019).
  if (type === 'bulk' || type === 'staff') {
    const { token } = await parent()
    if (!token) return { tab, assets: [], total: null, q, type, offset }
    const res = await apiFetch(fetch, type === 'bulk' ? '/assets/mine/bulk' : '/assets/staff', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = res.ok ? await res.json() : { assets: [] }
    return { tab, assets: json.assets ?? [], total: null, q, type, offset }
  }

  // Local community library
  const res = await apiFetch(fetch, `/assets?${params}`)
  const json = res.ok ? await res.json() : { assets: [] }
  return { tab, assets: json.assets ?? [], total: null, q, type, offset }
}
