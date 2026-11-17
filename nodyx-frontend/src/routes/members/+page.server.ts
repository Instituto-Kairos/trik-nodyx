import type { PageServerLoad } from './$types'
import { apiFetch }            from '$lib/api'

export interface FullMember {
  user_id:      string
  username:     string
  avatar:       string | null
  display_name: string | null
  name_color:   string | null
  bio:          string | null
  role:         'owner' | 'admin' | 'moderator' | 'member' | string
  grade_id:     string | null
  grade_name:   string | null
  grade_color:  string | null
  grades?:      { id: string; name: string; color: string }[]
  points:       number
  joined_at:    string
  is_online:    boolean
}

export const load: PageServerLoad = async ({ fetch }) => {
  try {
    const res = await apiFetch(fetch, '/instance/members/full')
    if (!res.ok) {
      return { members: [] as FullMember[], error: `Backend returned ${res.status}` }
    }
    const { members } = await res.json() as { members: FullMember[] }
    return { members, error: null }
  } catch (err) {
    return {
      members: [] as FullMember[],
      error:   err instanceof Error ? err.message : 'Failed to load',
    }
  }
}
