<script lang="ts">
	// Editor de capítulos de uma página da biblioteca. A lista inteira vai no
	// campo oculto `chapters` (JSON) e o backend a regrava de uma vez; desligar
	// a divisão manda `[]`, o que apaga os capítulos existentes ao salvar.
	import { untrack } from 'svelte'
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { initial = [] }: { initial?: { title: string; content: string }[] } = $props()

	interface Capitulo { key: number; title: string; content: string }

	let seq = 0
	let ativo     = $state(untrack(() => initial.length > 0))
	let capitulos = $state<Capitulo[]>(untrack(() => initial.map((c) => ({ key: seq++, title: c.title, content: c.content }))))

	const json = $derived(JSON.stringify(
		ativo ? capitulos.map((c) => ({ title: c.title.trim(), content: c.content })) : []
	))

	function adicionar() {
		capitulos.push({ key: seq++, title: '', content: '' })
	}

	function remover(i: number) {
		if (!confirm(tFn('wiki_chapters.confirm_remove'))) return
		capitulos.splice(i, 1)
	}

	function mover(i: number, d: number) {
		const j = i + d
		if (j < 0 || j >= capitulos.length) return
		;[capitulos[i], capitulos[j]] = [capitulos[j], capitulos[i]]
	}

	function alternar() {
		if (ativo && capitulos.length === 0) adicionar()
	}
</script>

<input type="hidden" name="chapters" value={json} />

<div class="space-y-4">
	<label class="flex items-center gap-2.5 cursor-pointer select-none">
		<input type="checkbox" bind:checked={ativo} onchange={alternar}
		       class="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-violet-500" />
		<span class="text-sm text-gray-300">{tFn('wiki_chapters.toggle')}</span>
	</label>

	{#if ativo}
		<p class="text-xs text-gray-500">{tFn('wiki_chapters.hint')}</p>

		{#each capitulos as cap, i (cap.key)}
			<div class="rounded-xl border border-gray-700/60 bg-gray-900/40 p-4 space-y-3">
				<div class="flex items-center gap-2">
					<span class="text-xs font-semibold text-violet-400 shrink-0">
						{tFn('wiki_chapters.number', { n: i + 1 })}
					</span>
					<input
						bind:value={cap.title} required
						placeholder={tFn('wiki_chapters.title_ph')}
						class="flex-1 min-w-0 bg-gray-900/60 border border-gray-700/60 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-violet-500/60"
					/>
					<button type="button" disabled={i === 0} onclick={() => mover(i, -1)}
					        title={tFn('wiki_chapters.move_up')}
					        class="px-2 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs disabled:opacity-30">↑</button>
					<button type="button" disabled={i === capitulos.length - 1} onclick={() => mover(i, 1)}
					        title={tFn('wiki_chapters.move_down')}
					        class="px-2 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs disabled:opacity-30">↓</button>
					<button type="button" onclick={() => remover(i)}
					        title={tFn('wiki_chapters.remove')}
					        class="px-2 py-1.5 rounded-lg bg-gray-800 hover:bg-red-900/40 text-gray-500 hover:text-red-400 text-xs">✕</button>
				</div>
				<!-- name próprio por capítulo: o NodyxEditor cria um input oculto, e
				     não queremos que ele sobrescreva o `content` da introdução. -->
				<NodyxEditor name="chapter_{cap.key}" initialContent={cap.content}
				             placeholder={tFn('wiki_chapters.content_ph')}
				             onchange={(html) => (cap.content = html)} />
			</div>
		{/each}

		<button type="button" onclick={adicionar}
		        class="w-full py-2.5 rounded-xl border border-dashed border-gray-700 hover:border-violet-500/60 text-gray-400 hover:text-violet-300 text-sm transition-colors">
			+ {tFn('wiki_chapters.add')}
		</button>
	{/if}
</div>
