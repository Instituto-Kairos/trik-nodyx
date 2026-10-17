<!--
	Módulo RPG (trik) — Fase 3: efeitos de um dono (aptidão, preferência,
	objetivo, listas desbloqueáveis, panteão, divindade). Lista os efeitos como
	frases e abre um formulário compacto pra adicionar. Posta nas actions
	?/addEffect e ?/deleteEffect da página (lib/server/trikEffects.ts).
	Os campos que aparecem dependem do efeito — o core valida tudo de novo.
-->

<script lang="ts">
	import { enhance } from '$app/forms';
	import { describeEffect, type TrikEffect, type CatalogItem } from '$lib/trik/effects';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		ownerKind,
		ownerId,
		effects = [],
		weapons = [],
		knowledges = []
	}: {
		ownerKind: string;
		ownerId: string;
		effects?: TrikEffect[];
		weapons?: CatalogItem[];
		knowledges?: CatalogItem[];
	} = $props();

	const EFFECT_OPTIONS = [
		{ value: 'multiplica', label: 'Multiplica unidades (×)' },
		{ value: 'reduz_requisito', label: 'Reduz requisito de nível (−)' },
		{ value: 'limite_diario', label: 'Aumenta teto diário (+)' },
		{ value: 'anula_alerta', label: 'Anula alerta laranja' },
		{ value: 'sensibilidade', label: 'Sensibilidade a alerta' },
		{ value: 'espelho', label: 'Espelho' }
	];
	const NUMERIC = ['multiplica', 'reduz_requisito', 'limite_diario'];
	const ALERT = ['anula_alerta', 'sensibilidade'];
	const CLIMATES = ['sol', 'nublado', 'neblina', 'chuva', 'tempestade', 'neve'];
	const PLACEHOLDER: Record<string, string> = { multiplica: '1.5', reduz_requisito: '1', limite_diario: '1' };

	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	const describe = (e: TrikEffect) => describeEffect(e, weapons, knowledges);

	const categoriesOf = (list: CatalogItem[]) =>
		[...new Set(list.map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

	let open = $state(false);
	let effectType = $state('multiplica');
	let activity = $state('todas');
	let target = $state('');
	let alertKind = $state('calor');
	let conditionKind = $state('sempre');
	let conditionValue = $state('');
	let value = $state('');

	const isNumeric = $derived(NUMERIC.includes(effectType));
	const isAlert = $derived(ALERT.includes(effectType));
	const targetList = $derived(activity === 'treino' ? weapons : activity === 'aula' ? knowledges : []);
	const targetPrefix = $derived(activity === 'treino' ? 'weapon' : 'knowledge');

	// Trocar atividade/condição invalida o que dependia dela.
	$effect(() => {
		void activity;
		target = '';
	});
	$effect(() => {
		conditionValue = conditionKind === 'clima' ? 'chuva' : conditionKind === 'periodo' ? 'noite' : '';
	});

	const afterSave: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				value = '';
				open = false;
			}
		};
	};

	const confirmRemove = (e: TrikEffect): SubmitFunction => ({ cancel }) => {
		if (!confirm(`Remover "${describe(e)}"?`)) cancel();
	};

	const field = 'rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white';
</script>

<div class="space-y-1.5">
	{#if effects.length > 0}
		<ul class="flex flex-wrap gap-1.5">
			{#each effects as e (e.id)}
				<li class="flex items-center gap-1 rounded-full bg-indigo-900/40 border border-indigo-800/60 pl-2.5 pr-1 py-0.5 text-xs text-indigo-200">
					{describe(e)}
					<form method="POST" action="?/deleteEffect" use:enhance={confirmRemove(e)}>
						<input type="hidden" name="id" value={e.id} />
						<button type="submit" aria-label="Remover efeito" class="w-4 h-4 flex items-center justify-center rounded-full text-indigo-400 hover:text-red-400">×</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}

	{#if !open}
		<button type="button" onclick={() => (open = true)} class="text-xs text-indigo-400 hover:text-indigo-300">+ efeito</button>
	{:else}
		<form method="POST" action="?/addEffect" use:enhance={afterSave} class="flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-800/50 p-2">
			<input type="hidden" name="ownerKind" value={ownerKind} />
			<input type="hidden" name="ownerId" value={ownerId} />

			<select name="effect" bind:value={effectType} aria-label="Efeito" class={field}>
				{#each EFFECT_OPTIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
			</select>

			{#if isAlert}
				<select name="alertKind" bind:value={alertKind} aria-label="Tipo de alerta" class={field}>
					<option value="calor">Calor</option>
					<option value="frio">Frio</option>
					<option value="umidade">Ar seco (umidade)</option>
				</select>
			{:else if isNumeric}
				<input
					name="value"
					bind:value
					inputmode="decimal"
					required
					placeholder={PLACEHOLDER[effectType]}
					aria-label="Valor"
					class="{field} w-14"
				/>
				<select name="activity" bind:value={activity} aria-label="Atividade" class={field}>
					<option value="todas">Treino e aula</option>
					<option value="treino">Só treino</option>
					<option value="aula">Só aula</option>
				</select>
				{#if activity !== 'todas'}
					<select name="target" bind:value={target} aria-label="Alvo" class={field}>
						<option value="">Qualquer {activity === 'treino' ? 'arma' : 'matéria'}</option>
						<optgroup label="Categoria">
							{#each categoriesOf(targetList) as c (c)}<option value="{targetPrefix}Cat:{c}">{c}</option>{/each}
						</optgroup>
						<optgroup label={activity === 'treino' ? 'Arma' : 'Matéria'}>
							{#each targetList as i (i.id)}<option value="{targetPrefix}:{i.id}">{i.name}</option>{/each}
						</optgroup>
					</select>
				{/if}
				<select name="conditionKind" bind:value={conditionKind} aria-label="Condição" class={field}>
					<option value="sempre">Sempre</option>
					<option value="clima">Com clima…</option>
					<option value="periodo">No período…</option>
					<option value="companhia">Em companhia (#com)</option>
				</select>
				{#if conditionKind === 'clima'}
					<select name="conditionValue" bind:value={conditionValue} aria-label="Clima" class={field}>
						{#each CLIMATES as c (c)}<option value={c}>{cap(c)}</option>{/each}
					</select>
				{:else if conditionKind === 'periodo'}
					<select name="conditionValue" bind:value={conditionValue} aria-label="Período" class={field}>
						<option value="dia">Dia</option>
						<option value="noite">Noite</option>
					</select>
				{/if}
			{/if}

			<button type="submit" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white">Salvar</button>
			<button type="button" onclick={() => (open = false)} class="px-2 py-1 text-xs text-gray-500 hover:text-gray-300">Cancelar</button>
		</form>
	{/if}
</div>
