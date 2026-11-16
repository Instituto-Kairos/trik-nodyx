<script lang="ts">
	// Escolha de cargos (grades) que podem ver um conteúdo — conteúdo privado por
	// cargo (trik_025). Nada marcado = sem restrição. Usado na criação de tópico,
	// no painel da equipe do tópico e na edição de categoria (admin).
	import { t } from '$lib/i18n';
	import { tagTextColor } from '$lib/tagStyle';

	type Grade = { id: string; name: string; color: string };

	let {
		grades,
		selected = $bindable([]),
		name = 'grade_ids',
		label,
		hint,
		id = 'grade-picker',
	}: {
		grades: Grade[];
		selected?: string[];
		/** Nome dos <input hidden> (um por cargo marcado); vazio = não gera inputs. */
		name?: string;
		label?: string;
		hint?: string;
		id?: string;
	} = $props();

	const tFn = $derived($t);

	function toggle(gid: string) {
		selected = selected.includes(gid) ? selected.filter(x => x !== gid) : [...selected, gid];
	}
</script>

<div>
	<span id="{id}-label" class="block text-sm text-[var(--nx-text-muted)] mb-1">
		🔒 {label ?? tFn('private.pick_label')}
	</span>
	<p class="text-xs text-[var(--nx-text-muted)] mb-2">
		{selected.length ? (hint ?? tFn('private.pick_hint_on')) : tFn('private.pick_hint_off')}
	</p>
	<div class="flex flex-wrap gap-2" role="group" aria-labelledby="{id}-label">
		{#each grades as g (g.id)}
			{@const on = selected.includes(g.id)}
			<button
				type="button"
				onclick={() => toggle(g.id)}
				aria-pressed={on}
				class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer {on ? '' : 'text-[var(--nx-text)] hover:bg-[var(--nx-surface-raised)]'}"
				style={on
					? `background-color: ${g.color}; border-color: ${g.color}; color: ${tagTextColor(g.color)};`
					: `border-color: ${g.color};`}
			>
				{#if on}✓{:else}<span class="inline-block w-2 h-2 rounded-full" style="background-color: {g.color}"></span>{/if}
				{g.name}
			</button>
		{/each}
	</div>
	{#if name}
		{#each selected as gid (gid)}
			<input type="hidden" {name} value={gid} />
		{/each}
	{/if}
</div>
