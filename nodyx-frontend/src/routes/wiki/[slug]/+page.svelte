<script lang="ts">
	import type { PageData } from './$types'
	import { page } from '$app/state'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()

	const pg = $derived(data.wikiPage)
	const canEdit = $derived(
		data.user?.role === 'owner' ||
		data.user?.role === 'admin' ||
		data.user?.role === 'moderator' ||
		data.user?.username === pg?.author_username
	)

	// Capítulos: ?cap=N (1-based) abre o capítulo N; sem o parâmetro mostra a
	// introdução e o sumário. Fora do intervalo cai no sumário.
	const capitulos = $derived((pg?.chapters ?? []) as { id: string; title: string; content: string }[])
	const capAtual  = $derived.by(() => {
		const n = Number(page.url.searchParams.get('cap'))
		return Number.isInteger(n) && n >= 1 && n <= capitulos.length ? n : 0
	})
	const capitulo  = $derived(capAtual ? capitulos[capAtual - 1] : null)

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			day: 'numeric', month: 'long', year: 'numeric',
		})
	}

	async function deletePage() {
		if (!confirm(tFn('wiki_view.confirm_delete', { title: pg.title }))) return
		const token = page.data.token as string | null
		const res = await fetch(`/api/v1/wiki/${pg.slug}`, {
			method: 'DELETE',
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		})
		if (res.ok) window.location.href = '/wiki'
	}
</script>

<svelte:head>
	<title>{pg?.title ?? tFn('nav.wiki')} · {data.communityName}</title>
	<meta name="description" content={pg?.excerpt ?? ''} />
</svelte:head>

<div class="w-full max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto py-8 px-4 sm:px-6">

	<!-- Breadcrumb -->
	<div class="flex items-center gap-2 text-sm text-gray-500 mb-6">
		<a href="/wiki" class="hover:text-gray-300 transition-colors">{tFn('nav.wiki')}</a>
		{#if pg?.category}
			<span>/</span>
			<a href="/wiki?category={encodeURIComponent(pg.category)}"
			   class="hover:text-gray-300 transition-colors text-amber-500/70">{pg.category}</a>
		{/if}
		<span>/</span>
		<span class="text-gray-400 truncate">{pg?.title}</span>
	</div>

	<!-- Title + actions -->
	<div class="flex items-start justify-between gap-4 mb-6">
		<h1 class="text-2xl font-bold text-white leading-tight">{pg?.title}</h1>
		{#if canEdit}
			<div class="flex items-center gap-2 shrink-0">
				<a href="/wiki/{pg.slug}/edit"
				   class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
					</svg>
					{tFn('wiki_view.edit')}
				</a>
				{#if data.user?.role === 'owner' || data.user?.role === 'admin' || data.user?.role === 'moderator'}
					<button onclick={deletePage}
					        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-red-900/40 text-gray-500 hover:text-red-400 text-xs font-medium transition-colors">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
							      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
						</svg>
						{tFn('wiki_view.delete')}
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Meta bar -->
	<div class="flex items-center gap-4 text-xs text-gray-500 mb-8 pb-4 border-b border-gray-800">
		<div class="flex items-center gap-1.5">
			{#if pg?.author_avatar}
				<img src={pg.author_avatar} alt="" class="w-5 h-5 rounded-full object-cover" />
			{:else}
				<div class="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400">
					{(pg?.author_username ?? '?')[0].toUpperCase()}
				</div>
			{/if}
			<span>{pg?.author_username ?? tFn('wiki_view.unknown_author')}</span>
		</div>
		<span>{tFn('wiki_view.created', { date: formatDate(pg?.created_at) })}</span>
		{#if pg?.editor_username && pg.editor_username !== pg.author_username}
			<span>{tFn('wiki_view.edited_by', { name: pg.editor_username })}</span>
		{/if}
		<span class="flex items-center gap-1">
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
				      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
				      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
			</svg>
			{pg?.views !== 1 ? tFn('wiki_view.views_many', { count: pg?.views }) : tFn('wiki_view.views_one', { count: pg?.views })}
		</span>
		{#if pg?.is_public}
			<span class="px-2 py-0.5 rounded-full bg-green-900/30 text-green-500 border border-green-500/20">
				Public
			</span>
		{/if}
	</div>

	{#if capitulo}
		<!-- Capítulo aberto -->
		<a href="?" data-sveltekit-noscroll={false}
		   class="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mb-4">
			☰ {tFn('wiki_chapters.toc')}
		</a>
		<p class="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-1">
			{tFn('wiki_chapters.number', { n: capAtual })} / {capitulos.length}
		</p>
		<h2 class="text-xl font-bold text-white mb-6">{capitulo.title}</h2>
		<div class="nodyx-prose">
			{@html capitulo.content}
		</div>

		<nav class="mt-10 grid grid-cols-2 gap-3">
			{#if capAtual > 1}
				<a href="?cap={capAtual - 1}"
				   class="rounded-xl border border-gray-800 hover:border-violet-500/50 px-4 py-3 text-left">
					<span class="block text-[11px] text-gray-500">← {tFn('wiki_chapters.prev')}</span>
					<span class="block text-sm text-gray-200 truncate">{capitulos[capAtual - 2].title}</span>
				</a>
			{:else}
				<a href="?" class="rounded-xl border border-gray-800 hover:border-violet-500/50 px-4 py-3 text-left">
					<span class="block text-[11px] text-gray-500">← {tFn('wiki_chapters.toc')}</span>
					<span class="block text-sm text-gray-200 truncate">{pg.title}</span>
				</a>
			{/if}
			{#if capAtual < capitulos.length}
				<a href="?cap={capAtual + 1}"
				   class="col-start-2 rounded-xl border border-gray-800 hover:border-violet-500/50 px-4 py-3 text-right">
					<span class="block text-[11px] text-gray-500">{tFn('wiki_chapters.next')} →</span>
					<span class="block text-sm text-gray-200 truncate">{capitulos[capAtual].title}</span>
				</a>
			{/if}
		</nav>
	{:else}
		<!-- Content — rendered HTML from NodyxEditor (introdução quando há capítulos) -->
		<div class="nodyx-prose">
			{@html pg?.content ?? ''}
		</div>

		{#if capitulos.length}
			<!-- Sumário -->
			<section class="mt-8 rounded-xl border border-gray-800 bg-gray-900/40 p-5">
				<h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
					{tFn('wiki_chapters.toc')}
				</h2>
				<ol class="space-y-1">
					{#each capitulos as cap, i (cap.id)}
						<li>
							<a href="?cap={i + 1}"
							   class="flex items-baseline gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-800/60 text-gray-300 hover:text-white">
								<span class="text-xs text-violet-400 tabular-nums w-6 shrink-0">{i + 1}.</span>
								<span class="text-sm">{cap.title}</span>
							</a>
						</li>
					{/each}
				</ol>
				<a href="?cap=1"
				   class="mt-4 inline-block px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">
					{tFn('wiki_chapters.start')} →
				</a>
			</section>
		{/if}
	{/if}

	<!-- Back link -->
	<div class="mt-12 pt-6 border-t border-gray-800">
		<a href="/wiki" class="text-sm text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1.5">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
			</svg>
			{tFn('wiki_view.back')}
		</a>
	</div>
</div>

<style>
/* Largura de leitura. A coluna da página cresce com a tela (até 5xl em monitor
   grande) porque imagens, tabelas e a caixa de sumário (.toc, que flutua à
   direita) aproveitam esse espaço. O texto corrido, não: linha muito longa
   cansa e faz perder a próxima linha ao voltar. Então o parágrafo tem medida
   própria, ~72 caracteres, e só ele.
   :global porque o conteúdo vem de {@html} — o escopo do Svelte não alcança. */
.nodyx-prose :global(p),
.nodyx-prose :global(ul),
.nodyx-prose :global(ol),
.nodyx-prose :global(blockquote),
.nodyx-prose :global(h2),
.nodyx-prose :global(h3),
.nodyx-prose :global(h4) {
	max-width: 72ch;
}
</style>
