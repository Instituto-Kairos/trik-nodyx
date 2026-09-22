<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	interface BonusEntry {
		id: string;
		bonus_type: string;
		bonus_value: string;
		is_category: boolean;
	}

	const entries = $derived((data.entries ?? []) as BonusEntry[]);

	let bonusType = $state('');
	let bonusValue = $state('');
	let isCategory = $state(false);
	const canSubmit = $derived(!!bonusType.trim() && !!bonusValue.trim());
</script>

<svelte:head><title>RPG — Bônus</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Tipos de Bônus</h1>
		<p class="text-sm text-gray-500">
			Catálogo de tipos de bônus consumido por Aptidões, Preferências e Objetivos do /levelup
			(motor de buff da Fase 3). "Categórico" marca um bônus que vale pra uma categoria inteira
			(ex.: todas as armas de "Espadas") em vez de um item específico.
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}
	{#if form?.created}
		<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300">
			"{form.created}" cadastrado.
		</div>
	{/if}
	{#if form?.removed}
		<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300">
			Removido.
		</div>
	{/if}

	<form
		method="POST"
		action="?/create"
		use:enhance={() => {
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					bonusType = '';
					bonusValue = '';
					isCategory = false;
				}
			};
		}}
		class="flex flex-wrap items-end gap-3"
	>
		<div class="space-y-1">
			<label for="bonusType" class="block text-xs text-gray-500">Tipo</label>
			<input
				id="bonusType"
				type="text"
				name="bonusType"
				bind:value={bonusType}
				maxlength="42"
				placeholder="Ex.: Redução de treinos"
				autocomplete="off"
				class="w-64 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
			/>
		</div>
		<div class="space-y-1">
			<label for="bonusValue" class="block text-xs text-gray-500">Valor</label>
			<input
				id="bonusValue"
				type="text"
				name="bonusValue"
				bind:value={bonusValue}
				maxlength="3"
				placeholder="Ex.: +1"
				autocomplete="off"
				class="w-20 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
			/>
		</div>
		<label class="flex items-center gap-2 pb-2 text-sm text-gray-300">
			<input type="checkbox" name="isCategory" bind:checked={isCategory} class="rounded border-gray-700 bg-gray-800" />
			Categórico
		</label>
		<button
			type="submit"
			disabled={!canSubmit}
			class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:hover:bg-indigo-600"
		>
			Adicionar
		</button>
	</form>

	<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
					<th class="px-4 py-3">Tipo</th>
					<th class="px-4 py-3">Valor</th>
					<th class="px-4 py-3">Categórico</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-800">
				{#each entries as entry (entry.id)}
					<tr>
						<td class="px-4 py-2 text-white">{entry.bonus_type}</td>
						<td class="px-4 py-2 text-gray-300">{entry.bonus_value}</td>
						<td class="px-4 py-2 text-gray-300">{entry.is_category ? 'Sim' : 'Não'}</td>
						<td class="px-4 py-2 text-right">
							<form
								method="POST"
								action="?/delete"
								use:enhance={({ cancel }) => {
									if (!confirm(`Remover "${entry.bonus_type}"?`)) cancel();
								}}
							>
								<input type="hidden" name="id" value={entry.id} />
								<button type="submit" class="text-xs text-gray-500 hover:text-red-400 transition-colors">
									Remover
								</button>
							</form>
						</td>
					</tr>
				{/each}
				{#if entries.length === 0}
					<tr>
						<td colspan="4" class="px-4 py-6 text-center text-gray-500"> Nada cadastrado ainda. </td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>
