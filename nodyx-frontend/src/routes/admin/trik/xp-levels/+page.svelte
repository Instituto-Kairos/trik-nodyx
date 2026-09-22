<script lang="ts">
	import { enhance } from '$app/forms';
	import TabNav from '$lib/components/trik/TabNav.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type XpType = 'character' | 'knowledge' | 'weapon';

	const TYPE_TABS: { value: XpType; label: string; description: string }[] = [
		{
			value: 'character',
			label: 'Personagem',
			description: 'Nível geral do personagem — ganho por cena (Fase 2). Único que já aplica xp de verdade.'
		},
		{
			value: 'knowledge',
			label: 'Aulas',
			description: 'Progresso por matéria (#aula #nomedamateria). Cada linha diz quantas aulas (1.0 = cena de 500 caracteres) faltam pra sair daquele nível — 0 = nível máximo. As matérias em si são cadastradas em "Armas & Aulas".'
		},
		{
			value: 'weapon',
			label: 'Maestria',
			description: 'Maestria por arma (#treino #nomedaarma). Cada linha diz quantos treinos (1.0 = cena de 500 caracteres) faltam pra sair daquele nível — 0 = nível máximo. As armas em si são cadastradas em "Armas & Aulas".'
		}
	];

	const currentType = $derived((data.type ?? 'character') as XpType);
	const currentTab = $derived(TYPE_TABS.find((t) => t.value === currentType) ?? TYPE_TABS[0]);
	const isCharacter = $derived(currentType === 'character');
	// weapon/knowledge não usam "XP necessário": a exigência do nível é o número
	// de treinos/aulas (`requirement`, que vira reqMastery/reqEducation no
	// payload). goal_xp é NOT NULL no banco, então nesses dois tipos o payload
	// manda 1 (ver levelsJson).
	const requirementLabel = $derived(currentType === 'weapon' ? 'Treinos necessários' : 'Aulas necessárias');

	interface LevelRow {
		level: number;
		goalXp: number;
		rewardConduct: number;
		rewardPrinciples: number;
		rewardPreferences: number;
		rewardGoal: boolean;
		/** Treinos (weapon) ou aulas (knowledge) pra sair do nível; sem uso no 'character'. */
		requirement: number;
	}

	interface ApiLevel {
		level: number;
		goal_xp: string;
		reward_conduct: number;
		reward_principles: number;
		reward_preferences: number;
		reward_goal: boolean;
		req_mastery?: number;
		req_education?: number;
	}

	let rows = $state<LevelRow[]>([]);

	$effect(() => {
		const levels = (data.levels ?? []) as ApiLevel[];
		rows = levels
			.slice()
			.sort((a, b) => a.level - b.level)
			.map((l) => ({
				level: l.level,
				goalXp: Number(l.goal_xp),
				rewardConduct: l.reward_conduct,
				rewardPrinciples: l.reward_principles,
				rewardPreferences: l.reward_preferences,
				rewardGoal: l.reward_goal,
				requirement:
					currentType === 'weapon'
						? (l.req_mastery ?? 0)
						: currentType === 'knowledge'
							? (l.req_education ?? 0)
							: 0
			}));
	});

	function addRow() {
		const nextLevel = rows.length > 0 ? Math.max(...rows.map((r) => r.level)) + 1 : 1;
		rows = [
			...rows,
			{
				level: nextLevel,
				goalXp: 0,
				rewardConduct: 0,
				rewardPrinciples: 0,
				rewardPreferences: 0,
				rewardGoal: false,
				// Linha nova = um degrau novo; 0 significaria "nível máximo", que não é
				// o que quem clica em "+ Adicionar nível" espera.
				requirement: 5
			}
		];
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}

	const duplicateLevels = $derived.by(() => {
		const seen = new Set<number>();
		const dupes = new Set<number>();
		for (const r of rows) {
			if (seen.has(r.level)) dupes.add(r.level);
			seen.add(r.level);
		}
		return dupes;
	});

	// Só manda o campo que o tipo atual usa — pro 'character' nenhum dos dois.
	const levelsJson = $derived(
		JSON.stringify(
			rows.map(({ requirement, ...r }) => {
				if (currentType === 'weapon') return { ...r, goalXp: 1, reqMastery: requirement };
				if (currentType === 'knowledge') return { ...r, goalXp: 1, reqEducation: requirement };
				return r;
			})
		)
	);
</script>

<svelte:head><title>RPG — Curva de XP</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Curva de XP</h1>
		<p class="text-sm text-gray-500">
			trik_progression serve pros três tipos de progressão do jogo — cada um com sua própria curva
			de níveis, escolhida abaixo.
		</p>
	</div>

	<TabNav
		tabs={TYPE_TABS.map((t) => ({ href: `?type=${t.value}`, label: t.label, active: currentType === t.value }))}
	/>
	<p class="text-sm text-gray-500 -mt-3">{currentTab.description}</p>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}
	{#if form?.ok}
		<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300">
			Salvo.
		</div>
	{/if}
	{#if duplicateLevels.size > 0}
		<div class="rounded-lg border border-amber-800 bg-amber-900/30 px-4 py-3 text-sm text-amber-300">
			Nível repetido: {Array.from(duplicateLevels).join(', ')}. Corrija antes de salvar.
		</div>
	{/if}

	<form method="POST" action="?/save" use:enhance class="space-y-4">
		<input type="hidden" name="type" value={currentType} />
		<input type="hidden" name="levels" value={levelsJson} />

		<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
						<th class="px-4 py-3">Nível</th>
						<th class="px-4 py-3">{isCharacter ? 'XP necessário' : requirementLabel}</th>
						{#if isCharacter}
							<th class="px-4 py-3">+Conduta</th>
							<th class="px-4 py-3">+Princípios</th>
							<th class="px-4 py-3">+Preferências</th>
							<th class="px-4 py-3">Desbloqueia Objetivo</th>
						{/if}
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800">
					{#each rows as row, i}
						<tr class={duplicateLevels.has(row.level) ? 'bg-red-950/20' : ''}>
							<td class="px-4 py-2">
								<input
									type="number"
									min="1"
									bind:value={row.level}
									class="w-16 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-white"
								/>
							</td>
							<td class="px-4 py-2">
								{#if isCharacter}
									<input
										type="number"
										min="1"
										bind:value={row.goalXp}
										class="w-24 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-white"
									/>
								{:else}
									<input
										type="number"
										min="0"
										max="32767"
										bind:value={row.requirement}
										class="w-24 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-white"
									/>
								{/if}
							</td>
							{#if isCharacter}
								<td class="px-4 py-2">
									<input
										type="number"
										min="0"
										bind:value={row.rewardConduct}
										class="w-16 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-white"
									/>
								</td>
								<td class="px-4 py-2">
									<input
										type="number"
										min="0"
										bind:value={row.rewardPrinciples}
										class="w-16 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-white"
									/>
								</td>
								<td class="px-4 py-2">
									<input
										type="number"
										min="0"
										bind:value={row.rewardPreferences}
										class="w-16 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-white"
									/>
								</td>
								<td class="px-4 py-2">
									<input type="checkbox" bind:checked={row.rewardGoal} class="w-4 h-4" />
								</td>
							{/if}
							<td class="px-4 py-2">
								<button
									type="button"
									onclick={() => removeRow(i)}
									class="text-xs text-gray-500 hover:text-red-400 transition-colors"
								>
									Remover
								</button>
							</td>
						</tr>
					{/each}
					{#if rows.length === 0}
						<tr>
							<td colspan={isCharacter ? 7 : 3} class="px-4 py-6 text-center text-gray-500">
								Nenhum nível cadastrado ainda.
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>

		<div class="flex items-center gap-3">
			<button
				type="button"
				onclick={addRow}
				class="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-sm font-medium text-gray-300 transition-colors"
			>
				+ Adicionar nível
			</button>
			<button
				type="submit"
				disabled={duplicateLevels.size > 0}
				class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:hover:bg-indigo-600"
			>
				Salvar
			</button>
		</div>
	</form>
</div>
