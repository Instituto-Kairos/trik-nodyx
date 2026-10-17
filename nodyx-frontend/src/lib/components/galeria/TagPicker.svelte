<script lang="ts">
	/**
	 * Seletor de tags da galeria: mostra as tags escolhidas como chips e oferece
	 * as do catálogo da comunidade para um clique, em vez de redigitar. Texto
	 * que não bate com nenhuma vira tag nova — o backend a cadastra no envio.
	 */
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let {
		value = $bindable<string[]>([]),
		catalogo = [] as string[],
		max = 12,
	}: { value?: string[]; catalogo?: string[]; max?: number } = $props()

	let texto = $state('')

	const escolhidas = $derived(new Set(value.map((v) => v.toLowerCase())))
	const sugestoes = $derived(
		catalogo.filter((c) => {
			if (escolhidas.has(c.toLowerCase())) return false
			const q = texto.trim().toLowerCase()
			return !q || c.toLowerCase().includes(q)
		}),
	)

	function adicionar(bruta: string) {
		const tag = bruta.replace(/,/g, ' ').trim().slice(0, 30)
		texto = ''
		if (!tag || value.length >= max || escolhidas.has(tag.toLowerCase())) return
		// Grafia do catálogo quando já existe: "Kaelen" digitado vira "kaelen".
		value = [...value, catalogo.find((c) => c.toLowerCase() === tag.toLowerCase()) ?? tag]
	}

	function remover(tag: string) {
		value = value.filter((v) => v !== tag)
	}

	function tecla(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault()
			adicionar(texto)
		} else if (e.key === 'Backspace' && !texto && value.length) {
			value = value.slice(0, -1)
		}
	}
</script>

<div class="tp">
	<div class="tp-box">
		{#each value as tag (tag)}
			<span class="tp-chip">
				#{tag}
				<button type="button" class="tp-x" aria-label="×" onclick={() => remover(tag)}>×</button>
			</span>
		{/each}
		{#if value.length < max}
			<input type="text" bind:value={texto} maxlength="30" class="tp-input"
			       placeholder={tFn('galeria.tags_pick_ph')}
			       onkeydown={tecla} onblur={() => texto.trim() && adicionar(texto)} />
		{/if}
	</div>
	{#if sugestoes.length && value.length < max}
		<div class="tp-sug">
			{#each sugestoes.slice(0, 24) as s (s)}
				<!-- mousedown, não click: o blur do input viria antes e engoliria o clique -->
				<button type="button" class="tp-sug-chip" onmousedown={(e) => { e.preventDefault(); adicionar(s) }}>
					+ {s}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
.tp { display: flex; flex-direction: column; gap: 0.375rem; flex: 1; min-width: 0; }
.tp-box {
	display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center;
	background: rgba(255,255,255,0.04);
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 0.5rem; padding: 0.3125rem 0.5rem;
}
.tp-box:focus-within { border-color: rgb(var(--nx-accent-rgb) / 0.6); }
.tp-chip {
	display: inline-flex; align-items: center; gap: 0.25rem;
	font-size: 0.75rem; color: rgb(var(--nx-accent-rgb));
	background: rgb(var(--nx-accent-rgb) / 0.12);
	border-radius: 9999px; padding: 0.125rem 0.25rem 0.125rem 0.5rem;
}
.tp-x { background: none; border: 0; color: inherit; cursor: pointer; opacity: 0.7; font-size: 0.875rem; line-height: 1; padding: 0 0.125rem; }
.tp-x:hover { opacity: 1; }
.tp-input { flex: 1; min-width: 6rem; background: none; border: 0; outline: none; color: #fff; font-size: 0.8125rem; padding: 0.1875rem 0; }
.tp-sug { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.tp-sug-chip {
	background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.6);
	border: 0; border-radius: 9999px; padding: 0.125rem 0.5rem;
	font-size: 0.6875rem; cursor: pointer;
}
.tp-sug-chip:hover { background: rgb(var(--nx-accent-rgb) / 0.2); color: #fff; }
</style>
