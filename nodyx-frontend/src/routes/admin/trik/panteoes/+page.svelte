<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	interface Deity {
		id: string;
		name: string;
		bonus_id: string | null;
	}
	interface Pantheon {
		id: string;
		name: string;
		bonus_id: string | null;
		deities: Deity[];
	}
	interface Bonus {
		id: string;
		bonus_type: string;
		bonus_value: string;
	}

	const pantheons = $derived((data.pantheons ?? []) as Pantheon[]);
	const bonuses = $derived((data.bonuses ?? []) as Bonus[]);
	const bonusLabel = (b: Bonus) => `${b.bonus_type} (${b.bonus_value})`;

	// Limpa o formulário que deu certo (panteão novo ou "+ divindade").
	const resetOnSuccess: SubmitFunction = ({ formElement }) => {
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') formElement.reset();
		};
	};

	function confirmDelete(message: string): SubmitFunction {
		return ({ cancel }) => {
			if (!confirm(message)) cancel();
		};
	}

	// Trocar o bônus de um item salva na hora.
	function submitOnChange(e: Event) {
		(e.currentTarget as HTMLSelectElement).form?.requestSubmit();
	}
</script>

<svelte:head><title>RPG — Panteões</title></svelte:head>

{#snippet bonusOptions(selected: string | null)}
	<option value="" selected={!selected}>Sem bônus</option>
	{#each bonuses as b (b.id)}
		<option value={b.id} selected={b.id === selected}>{bonusLabel(b)}</option>
	{/each}
{/snippet}

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Panteões e Divindades</h1>
		<p class="text-sm text-gray-500">
			Opções dos campos "Panteão" e "Vínculo divino" do /registro — o vínculo só lista as divindades
			do panteão escolhido. O bônus vem da aba Bônus (motor de buff da Fase 3). Remover daqui não
			apaga personagens, só tira o vínculo deles com o item.
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

	<form method="POST" action="?/createPantheon" use:enhance={resetOnSuccess} class="flex flex-wrap items-end gap-3">
		<div class="space-y-1">
			<label for="pantheonName" class="block text-xs text-gray-500">Novo panteão</label>
			<input
				id="pantheonName"
				type="text"
				name="name"
				required
				maxlength="100"
				placeholder="Ex.: Grego"
				autocomplete="off"
				class="w-56 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
			/>
		</div>
		<div class="space-y-1">
			<label for="pantheonBonus" class="block text-xs text-gray-500">Bônus</label>
			<select
				id="pantheonBonus"
				name="bonusId"
				class="w-56 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
			>
				{@render bonusOptions(null)}
			</select>
		</div>
		<button
			type="submit"
			class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors"
		>
			Adicionar
		</button>
	</form>

	{#if pantheons.length === 0}
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-500">
			Nada cadastrado ainda.
		</div>
	{/if}

	<div class="grid gap-4 md:grid-cols-2">
		{#each pantheons as p (p.id)}
			<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-3">
				<div class="flex items-center justify-between gap-3">
					<h2 class="text-base font-semibold text-white">{p.name}</h2>
					<form
						method="POST"
						action="?/deletePantheon"
						use:enhance={confirmDelete(`Remover o panteão "${p.name}" e todas as suas ${p.deities.length} divindade(s)?`)}
					>
						<input type="hidden" name="id" value={p.id} />
						<button type="submit" class="text-xs text-gray-500 hover:text-red-400 transition-colors">
							Remover panteão
						</button>
					</form>
				</div>

				<form method="POST" action="?/setPantheonBonus" use:enhance class="flex items-center gap-2 text-xs text-gray-500">
					<input type="hidden" name="id" value={p.id} />
					Bônus do panteão:
					<select
						name="bonusId"
						onchange={submitOnChange}
						aria-label="Bônus de {p.name}"
						class="rounded-lg bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white"
					>
						{@render bonusOptions(p.bonus_id)}
					</select>
				</form>

				<ul class="space-y-1.5">
					{#each p.deities as d (d.id)}
						<li class="flex items-center gap-2 rounded-lg bg-gray-800/60 px-3 py-1.5 text-sm text-gray-200">
							<span class="flex-1 min-w-0 truncate">{d.name}</span>
							<form method="POST" action="?/setDeityBonus" use:enhance>
								<input type="hidden" name="id" value={d.id} />
								<select
									name="bonusId"
									onchange={submitOnChange}
									aria-label="Bônus de {d.name}"
									class="max-w-40 rounded bg-gray-800 border border-gray-700 px-2 py-0.5 text-xs text-white"
								>
									{@render bonusOptions(d.bonus_id)}
								</select>
							</form>
							<form method="POST" action="?/deleteDeity" use:enhance={confirmDelete(`Remover "${d.name}"?`)}>
								<input type="hidden" name="id" value={d.id} />
								<button
									type="submit"
									aria-label="Remover {d.name}"
									class="w-5 h-5 flex items-center justify-center rounded-full text-gray-500 hover:text-red-400 transition-colors"
								>
									×
								</button>
							</form>
						</li>
					{/each}
					{#if p.deities.length === 0}
						<li class="text-xs text-gray-500">Nenhuma divindade ainda.</li>
					{/if}
				</ul>

				<form method="POST" action="?/createDeity" use:enhance={resetOnSuccess} class="flex gap-2">
					<input type="hidden" name="pantheonId" value={p.id} />
					<input
						type="text"
						name="name"
						required
						maxlength="100"
						placeholder="Nova divindade"
						aria-label="Nova divindade em {p.name}"
						autocomplete="off"
						class="flex-1 min-w-0 rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white placeholder-gray-600"
					/>
					<select
						name="bonusId"
						aria-label="Bônus da nova divindade"
						class="max-w-36 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white"
					>
						{@render bonusOptions(null)}
					</select>
					<button
						type="submit"
						class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
					>
						＋
					</button>
				</form>
			</div>
		{/each}
	</div>
</div>
