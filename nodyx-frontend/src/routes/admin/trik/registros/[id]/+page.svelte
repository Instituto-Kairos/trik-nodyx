<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData, ActionData } from './$types';
	import { describeEffect, type TrikEffect, type CatalogItem } from '$lib/trik/effects';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	interface Item {
		id: string;
		name: string;
		category: string | null;
		effects: TrikEffect[];
	}
	interface Trait extends Item {
		kind: string;
		unlocked_at: string;
	}

	const sheet = $derived(data.sheet);
	const c = $derived(sheet.character as Record<string, any>);
	const progress = $derived(sheet.progress as Record<string, any> | null);
	const weapons = $derived((data.weapons ?? []) as CatalogItem[]);
	const knowledges = $derived((data.knowledges ?? []) as CatalogItem[]);
	const traits = $derived((sheet.traits ?? []) as Trait[]);
	const traitCatalog = $derived((data.traitCatalog ?? {}) as Record<string, { id: string; name: string }[]>);

	const describe = (e: TrikEffect) => describeEffect(e, weapons, knowledges);

	const TRAIT_LABEL: Record<string, string> = {
		disorder: 'Transtornos',
		disturbance: 'Distúrbios',
		unique_ability: 'Habilidades únicas',
		peculiarity: 'Peculiaridades'
	};
	const CONDUCT = [
		['Presença', 'conduct_presenca'],
		['Propósito', 'conduct_proposito'],
		['Sangue', 'conduct_sangue']
	];
	const PRINCIPLES = [
		['Mente', 'principles_mente'],
		['Coração', 'principles_coracao'],
		['Corpo', 'principles_corpo']
	];
	// [rótulo, pontos, gastos] — "disponíveis" = pontos − gastos.
	const POOLS = [
		['Conduta', 'points_conduct', 'spent_conduct'],
		['Princípios', 'points_principles', 'spent_principles'],
		['Preferências', 'points_preferences', 'spent_preferences'],
		['Aptidão natural', 'points_natural_aptitudes', 'spent_natural_aptitudes'],
		['Aptidão adquirida', 'points_acquired_aptitudes', 'spent_acquired_aptitudes']
	];

	const fmtDate = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
	const fmtDateTime = (d: string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
	const OUTCOME: Record<string, string> = {
		none: '',
		penalized: 'penalizada',
		forbidden: '🔴 proibida (passando mal)',
		zero: '🔴 sem efeito'
	};

	const keepOpen: SubmitFunction = () => async ({ update }) => update({ reset: false });
	const card = 'rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-2';
	const title = 'text-[10px] font-bold uppercase tracking-widest text-gray-500';
</script>

<svelte:head><title>RPG — {c.name}</title></svelte:head>

{#snippet effectList(effects: TrikEffect[])}
	{#if effects.length > 0}
		<ul class="flex flex-wrap gap-1 mt-1">
			{#each effects as e (e.id)}
				<li class="rounded-full bg-indigo-900/40 border border-indigo-800/60 px-2 py-0.5 text-[11px] text-indigo-200">{describe(e)}</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet slot(label: string, item: Item | null)}
	<div class="text-sm">
		<span class="text-gray-500">{label}:</span>
		{#if item}
			<span class="text-white">{item.name}</span>
			{#if item.category}<span class="text-[11px] text-gray-500">· {item.category}</span>{/if}
			{@render effectList(item.effects)}
		{:else}
			<span class="text-gray-600">vazio</span>
		{/if}
	</div>
{/snippet}

<div class="space-y-6">
	<div>
		<a href="/admin/trik/registros" class="text-xs text-gray-500 hover:text-gray-300">← Registros</a>
		<h1 class="text-2xl font-bold text-white mt-1">{c.name}</h1>
		<p class="text-sm text-gray-500">
			Jogador: {sheet.player.name} (@{sheet.player.username})
			{#if progress}
				· Nível {progress.level} · {Number(progress.progress_xp)}{sheet.goalXp !== null ? ` / ${sheet.goalXp}` : ''} XP
				{#if sheet.goalXp === null}(nível máx.){/if}
			{/if}
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">{form.error}</div>
	{/if}

	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		<section class={card}>
			<h2 class={title}>Registro</h2>
			<p class="text-sm text-gray-300">Pronomes: {c.pronouns ?? '—'} · Nascimento: {fmtDate(c.birth_date)}</p>
			<p class="text-sm text-gray-300">
				Faceclaim: {c.faceclaim_name ?? '—'}
				{#if c.faceclaim_birth_date}({fmtDate(c.faceclaim_birth_date)}){/if}
			</p>
			<p class="text-sm text-gray-300">Dádiva: {c.divine_gift ?? '—'}</p>
			{#if c.ficha_link}
				<a href={c.ficha_link} target="_blank" rel="noopener noreferrer" class="text-sm text-indigo-400 hover:text-indigo-300">Ficha ↗</a>
			{/if}
		</section>

		<section class={card}>
			<h2 class={title}>Atributos</h2>
			<div class="grid grid-cols-2 gap-x-4 text-sm">
				<div>
					{#each CONDUCT as [label, key] (key)}<p class="text-gray-400">{label}: <span class="text-white">{c[key]}</span></p>{/each}
				</div>
				<div>
					{#each PRINCIPLES as [label, key] (key)}<p class="text-gray-400">{label}: <span class="text-white">{c[key]}</span></p>{/each}
				</div>
			</div>
		</section>

		<section class={card}>
			<h2 class={title}>Pontos de nível</h2>
			{#if progress}
				{#each POOLS as [label, points, spent] (points)}
					<p class="text-sm text-gray-400">
						{label}: <span class="text-white">{(progress[points] ?? 0) - (progress[spent] ?? 0)}</span> disponível
						<span class="text-gray-600">({progress[spent] ?? 0} de {progress[points] ?? 0} usados)</span>
					</p>
				{/each}
				<p class="text-sm text-gray-400">Objetivo: {progress.has_goal ? 'desbloqueado' : 'bloqueado'}</p>
			{:else}
				<p class="text-sm text-gray-600">Ainda sem progresso.</p>
			{/if}
		</section>

		<section class={card}>
			<h2 class={title}>Aptidões</h2>
			{@render slot('Natural 1', sheet.slots.naturalAptitudes[0])}
			{@render slot('Natural 2', sheet.slots.naturalAptitudes[1])}
			{@render slot('Adquirida 1', sheet.slots.acquiredAptitudes[0])}
			{@render slot('Adquirida 2', sheet.slots.acquiredAptitudes[1])}
		</section>

		<section class={card}>
			<h2 class={title}>Preferências e objetivo</h2>
			{@render slot('Preferência 1', sheet.slots.preferences[0])}
			{@render slot('Preferência 2', sheet.slots.preferences[1])}
			{@render slot('Objetivo', sheet.slots.goal)}
		</section>

		<section class={card}>
			<h2 class={title}>Vínculo divino</h2>
			{@render slot('Panteão', sheet.pantheon ? { ...sheet.pantheon, category: null } : null)}
			{@render slot('Divindade', sheet.deity ? { ...sheet.deity, category: null } : null)}
			{#if !sheet.pantheon && c.pantheon}
				<p class="text-xs text-gray-500">Registro antigo em texto: {c.pantheon}{c.divine_bond ? ` · ${c.divine_bond}` : ''}</p>
			{/if}
		</section>
	</div>

	<section class={card}>
		<h2 class={title}>Desbloqueios</h2>
		{#each Object.entries(TRAIT_LABEL) as [kind, label] (kind)}
			{@const items = traits.filter((t) => t.kind === kind)}
			{#if items.length > 0}
				<div class="text-sm">
					<span class="text-gray-500">{label}:</span>
					<div class="mt-1 space-y-1.5">
						{#each items as t (t.id)}
							<div class="rounded-lg bg-gray-800/50 px-3 py-1.5">
								<form method="POST" action="?/removeTrait" use:enhance={keepOpen} class="flex items-center gap-2">
									<input type="hidden" name="kind" value={kind} />
									<input type="hidden" name="itemId" value={t.id} />
									<span class="text-white">{t.name}</span>
									{#if t.category}<span class="text-[11px] text-gray-500">· {t.category}</span>{/if}
									<span class="text-[11px] text-gray-600">desde {fmtDateTime(t.unlocked_at)}</span>
									<button type="submit" aria-label="Remover {t.name}" class="ml-auto text-xs text-gray-500 hover:text-red-400">Remover</button>
								</form>
								{@render effectList(t.effects)}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
		{#if traits.length === 0}<p class="text-sm text-gray-600">Nenhum ainda.</p>{/if}
		<form method="POST" action="?/unlockTrait" use:enhance={keepOpen} class="flex gap-2 pt-1">
			<select name="trait" required aria-label="Desbloquear" class="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white">
				<option value="">Desbloquear…</option>
				{#each Object.entries(TRAIT_LABEL) as [kind, label] (kind)}
					<optgroup {label}>
						{#each (traitCatalog[kind] ?? []).filter((i) => !traits.some((t) => t.kind === kind && t.id === i.id)) as i (i.id)}
							<option value="{kind}:{i.id}">{i.name}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
			<button type="submit" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs text-white">Desbloquear</button>
		</form>
	</section>

	<div class="grid gap-4 md:grid-cols-2">
		{#each [['Maestria de armas (#treino)', sheet.mastery.weapons], ['Matérias (#aula)', sheet.mastery.knowledges]] as [label, list] (label)}
			<section class={card}>
				<h2 class={title}>{label}</h2>
				{#each list as any[] as m (m.id)}
					<p class="text-sm text-gray-300">
						{m.name}
						{#if m.category}<span class="text-[11px] text-gray-500">· {m.category}</span>{/if}
						— nível <span class="text-white">{m.level}</span>
						<span class="text-gray-500">({Number(m.progress)} unid.)</span>
					</p>
				{:else}
					<p class="text-sm text-gray-600">Nenhum ainda.</p>
				{/each}
			</section>
		{/each}
	</div>

	<section class={card}>
		<h2 class={title}>Últimas cenas</h2>
		{#if sheet.recentScenes.length === 0}
			<p class="text-sm text-gray-600">Nenhuma cena contada ainda.</p>
		{:else}
			<table class="w-full text-xs">
				<thead>
					<tr class="text-left text-gray-500">
						<th class="py-1 pr-3">Quando</th>
						<th class="py-1 pr-3">Data in-game</th>
						<th class="py-1 pr-3">XP</th>
						<th class="py-1 pr-3">Treino/aula</th>
						<th class="py-1">Bônus</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800">
					{#each sheet.recentScenes as s (s.post_id)}
						{@const d = (s.bonus_detail ?? null) as Record<string, any> | null}
						<tr class="text-gray-300">
							<td class="py-1 pr-3 whitespace-nowrap">{fmtDateTime(s.created_at)}</td>
							<td class="py-1 pr-3">{fmtDate(s.game_date)}</td>
							<td class="py-1 pr-3">{s.xp_awarded}</td>
							<td class="py-1 pr-3">
								{#if s.mastery_kind}{s.item_name ?? 'item removido'} · {Number(s.mastery_awarded)} unid.{:else}—{/if}
							</td>
							<td class="py-1 text-gray-400">
								{#if d}
									{d.rawUnits} brutas × {d.multiplier}{d.penalty !== 1 ? ` × ${d.penalty}` : ''}
									{#if d.climate}· {d.climate}{/if}
									{#if d.period}· {d.period}{/if}
									{#if OUTCOME[d.outcome]}· {OUTCOME[d.outcome]}{/if}
									{#if d.mirroredFrom}· espelho{/if}
								{:else}—{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
</div>
