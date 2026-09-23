<script lang="ts">
	import { page as route } from '$app/state'
	import { t } from '$lib/i18n'
	import { pageItems } from '$lib/forumPagination'

	// `position` decide le bouton de saut : en haut on descend, en bas on remonte.
	// Le conteneur qui défile est <main> (pas window) : on saute par ancres
	// (scrollIntoView), qui marche quel que soit le conteneur.
	let { page, totalPages, position }: {
		page:       number
		totalPages: number
		position:   'top' | 'bottom'
	} = $props()

	const tFn   = $derived($t)
	const items = $derived(pageItems(page, totalPages))

	const href = (p: number) => (p <= 1 ? route.url.pathname : `${route.url.pathname}?page=${p}`)

	function jump() {
		const id = position === 'top' ? 'thread-end' : 'thread-top'
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: position === 'top' ? 'end' : 'start' })
	}

	const btn  = 'inline-flex items-center justify-center min-w-8 h-8 px-2 text-xs border transition-colors'
	const idle = 'border-gray-700 bg-gray-800/60 text-gray-300 hover:border-indigo-500 hover:text-white'
	const dead = 'border-gray-800 bg-gray-900/40 text-gray-600 pointer-events-none'
</script>

<nav aria-label={tFn('forum.pages_nav')} class="flex flex-wrap items-center justify-between gap-2 py-2">
	<div class="flex flex-wrap items-center gap-1">
		{#if totalPages > 1}
			<a href={href(1)} class="{btn} {page === 1 ? dead : idle}" aria-label={tFn('forum.page_first')} title={tFn('forum.page_first')} aria-disabled={page === 1}>«</a>
			<a href={href(page - 1)} class="{btn} {page === 1 ? dead : idle}" aria-disabled={page === 1} rel="prev">‹ {tFn('forum.page_prev')}</a>

			{#each items as item}
				{#if item === '…'}
					<span class="px-1 text-gray-600 text-xs select-none">…</span>
				{:else}
					<a href={href(item)}
						class="{btn} {item === page ? 'border-indigo-500 bg-indigo-600 text-white font-semibold' : idle}"
						aria-current={item === page ? 'page' : undefined}>{item}</a>
				{/if}
			{/each}

			<a href={href(page + 1)} class="{btn} {page === totalPages ? dead : idle}" aria-disabled={page === totalPages} rel="next">{tFn('forum.page_next')} ›</a>
			<a href={href(totalPages)} class="{btn} {page === totalPages ? dead : idle}" aria-label={tFn('forum.page_last')} title={tFn('forum.page_last')} aria-disabled={page === totalPages}>»</a>
		{/if}
	</div>

	<div class="flex items-center gap-3">
		{#if totalPages > 1}
			<span class="text-xs text-gray-500">{tFn('forum.page_of', { page: String(page), total: String(totalPages) })}</span>
		{/if}
		<button type="button" onclick={jump} class="{btn} {idle} gap-1">
			{#if position === 'top'}
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
				{tFn('forum.go_bottom')}
			{:else}
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>
				{tFn('forum.go_top')}
			{/if}
		</button>
	</div>
</nav>
