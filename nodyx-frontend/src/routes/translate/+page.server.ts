import type { PageServerLoad } from './$types'
import { getLocaleActivity }  from '$lib/localeActivity.server'

export const load: PageServerLoad = () => {
	return { activity: getLocaleActivity() }
}
