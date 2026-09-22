<script lang="ts">
	import { page } from '$app/state'
	import TabNav from '$lib/components/trik/TabNav.svelte'

	let { children }: { children: any } = $props()

	const tabs = [
		{ href: '/admin/trik/registros', label: 'Registros' },
		{ href: '/admin/trik/channels',  label: 'Canais' },
		{ href: '/admin/trik/xp-levels', label: 'Curva de XP' },
		{ href: '/admin/trik/catalogo',  label: 'Armas & Aulas' },
		{ href: '/admin/trik/bonus',     label: 'Bônus' },
		{ href: '/admin/trik/bot',       label: 'Bot' },
	]
</script>

<div class="space-y-6">
	<TabNav tabs={tabs.map((t) => ({ ...t, active: page.url.pathname.startsWith(t.href) }))} />

	{@render children?.()}
</div>
