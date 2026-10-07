<!--
  Limita a altura de um post do fórum (padrão 510px). Passou disso, o fim do
  texto esmaece, e uma linha com "Leia mais" expande o post inteiro.

  O max-height vale desde o SSR (sem salto de layout ao hidratar); o
  esmaecimento e o botão só entram quando o JS mede que o conteúdo passou do
  limite. A medição usa ResizeObserver porque imagens carregam depois e
  aumentam a altura do post.
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { maxHeight = 510, children }: { maxHeight?: number; children: Snippet } = $props()

	let box: HTMLDivElement
	let inner: HTMLDivElement
	let overflowing = $state(false)
	let expanded = $state(false)

	$effect(() => {
		const ro = new ResizeObserver(() => {
			overflowing = inner.offsetHeight > maxHeight
		})
		ro.observe(inner)
		return () => ro.disconnect()
	})

	function toggle() {
		expanded = !expanded
		// Ao recolher um post longo, o leitor estaria lá embaixo, no meio do
		// post seguinte — volta pro começo deste.
		if (!expanded && box.getBoundingClientRect().top < 0) {
			box.scrollIntoView({ block: 'start' })
		}
	}
</script>

<div
	bind:this={box}
	class="cp"
	class:cp--clipped={!expanded}
	class:cp--faded={overflowing && !expanded}
	style="--cp-max: {maxHeight}px"
>
	<div bind:this={inner}>
		{@render children()}
	</div>
</div>

{#if overflowing}
	<div class="cp-more">
		<button type="button" onclick={toggle} aria-expanded={expanded}>
			{expanded ? tFn('forum.read_less') : tFn('forum.read_more')}
		</button>
	</div>
{/if}

<style>
	.cp--clipped {
		max-height: var(--cp-max);
		overflow: hidden;
	}
	.cp--faded {
		-webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 140px), transparent);
		mask-image: linear-gradient(to bottom, #000 calc(100% - 140px), transparent);
	}

	.cp-more {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 4px;
	}
	.cp-more::before,
	.cp-more::after {
		content: '';
		flex: 1;
		height: 1px;
		background: rgba(148, 163, 184, 0.25);
	}
	.cp-more button {
		font-size: 12px;
		font-weight: 600;
		color: #818cf8;
		padding: 2px 4px;
	}
	.cp-more button:hover {
		color: #a5b4fc;
	}
</style>
