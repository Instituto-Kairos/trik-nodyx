<script module lang="ts">
	export interface Crumb {
		label: string
		/** Ausente = degrau atual, renderizado como texto e não como link. */
		href?: string | null
	}
</script>

<script lang="ts">
	import { t } from '$lib/i18n'

	let { items }: { items: Crumb[] } = $props()
	const tFn = $derived($t)

	let expanded = $state(false)

	// As categorias aninham sem limite, então a trilha também. Em 390px de
	// largura, `Início › On › EUA › Nova Orleans › Instituto Kairos` transborda
	// — o mesmo estouro que já forçou a baixar o padding do cabeçalho de
	// categoria de `p-8` para `p-5`. Acima de três degraus o miolo colapsa num
	// `…` que o toque expande.
	//
	// O corte é puro CSS (`hidden sm:flex`): no desktop a trilha aparece
	// inteira sempre, sem depender de medir viewport no cliente — o que daria
	// divergência de hidratação entre o HTML do SSR e a primeira renderização.
	const collapsed = $derived(items.length > 3 && !expanded)
</script>

<nav class="flex items-center gap-2 min-w-0" aria-label={tFn('forum.breadcrumb_label')}>
	{#each items as item, i}
		{@const hidden = collapsed && i > 0 && i < items.length - 2}

		<div class="items-center gap-2 min-w-0 {hidden ? 'hidden sm:flex' : 'flex'}">
			{#if i > 0}
				<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
				</svg>
			{/if}

			{#if item.href}
				<a href={item.href} class="text-sm text-gray-500 hover:text-indigo-400 transition-colors truncate">{item.label}</a>
			{:else}
				<span class="text-sm font-medium text-indigo-400 truncate" aria-current="page">{item.label}</span>
			{/if}
		</div>

		{#if collapsed && i === 0}
			<div class="flex items-center gap-2 sm:hidden">
				<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
				</svg>
				<button
					type="button"
					onclick={() => (expanded = true)}
					aria-label={tFn('forum.breadcrumb_expand')}
					class="text-sm text-gray-500 hover:text-indigo-400 transition-colors px-1 leading-none"
				>…</button>
			</div>
		{/if}
	{/each}
</nav>
