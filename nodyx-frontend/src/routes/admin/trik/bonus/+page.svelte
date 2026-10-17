<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData, ActionData } from './$types';
	import EffectsEditor from '$lib/components/trik/EffectsEditor.svelte';
	import type { TrikEffect, CatalogItem } from '$lib/trik/effects';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const KIND_TABS = [
		{ value: 'aptitude', label: 'Aptidões', hint: 'Escolhidas no /levelup (2 naturais + 2 adquiridas), definitivas.' },
		{ value: 'preference', label: 'Preferências', hint: 'Escolhidas no /levelup, definitivas.' },
		{ value: 'goal', label: 'Objetivos', hint: 'Objetivo do personagem.' },
		{ value: 'disorder', label: 'Transtornos', hint: 'Desbloqueados pelo admin/narrador na aba Registros.' },
		{ value: 'disturbance', label: 'Distúrbios', hint: 'Desbloqueados pelo admin/narrador na aba Registros.' },
		{ value: 'unique_ability', label: 'Habilidades únicas', hint: 'Desbloqueadas pelo admin/narrador na aba Registros.' },
		{ value: 'peculiarity', label: 'Peculiaridades', hint: 'Desbloqueadas pelo admin/narrador na aba Registros.' }
	];

	interface Item {
		id: string;
		name: string;
		category: string | null;
		effects: TrikEffect[];
	}

	const kind = $derived(data.kind);
	const tab = $derived(KIND_TABS.find((t) => t.value === kind) ?? KIND_TABS[0]);
	const items = $derived((data.items ?? []) as Item[]);
	const weapons = $derived((data.weapons ?? []) as CatalogItem[]);
	const knowledges = $derived((data.knowledges ?? []) as CatalogItem[]);
	const knownCategories = $derived(
		[...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
	);

	// Categoria: dropdown com as já cadastradas nesta lista + "Nova categoria…"
	// (mesmo padrão da aba Armas & Aulas). Obrigatória — é por ela que as
	// validações decidem o que gera desconto.
	const NEW_CATEGORY = '__new__';
	let newName = $state('');
	let categoryChoice = $state('');
	let newCategory = $state('');
	const creatingCategory = $derived(knownCategories.length === 0 || categoryChoice === NEW_CATEGORY);
	const categoryValue = $derived(
		creatingCategory ? newCategory.trim() : knownCategories.includes(categoryChoice) ? categoryChoice : ''
	);
	const canSubmit = $derived(!!newName.trim() && !!categoryValue);

	// Trocar de aba (outra lista) recomeça a escolha.
	$effect(() => {
		void kind;
		categoryChoice = '';
		newCategory = '';
	});

	const afterCreate: SubmitFunction = () => {
		const wasCreating = creatingCategory;
		const typed = newCategory.trim().toLowerCase();
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'success') return;
			newName = '';
			// Mantém a categoria (comum cadastrar vários da mesma); se era nova,
			// seleciona a que acabou de entrar na lista.
			if (wasCreating) {
				categoryChoice = knownCategories.find((c) => c.toLowerCase() === typed) ?? '';
				newCategory = '';
			}
		};
	};

	function submitOnChange(e: Event) {
		(e.currentTarget as HTMLSelectElement).form?.requestSubmit();
	}
	const confirmDelete = (name: string): SubmitFunction => ({ cancel }) => {
		const msg = ['aptitude', 'preference', 'goal'].includes(kind)
			? `Remover "${name}"? Os efeitos dele somem junto. Se algum personagem já escolheu, a remoção é recusada.`
			: `Remover "${name}"? Os efeitos dele somem junto, e quem tinha desbloqueado perde o item.`;
		if (!confirm(msg)) cancel();
	};
</script>

<svelte:head><title>RPG — Bônus</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Bônus</h1>
		<p class="text-sm text-gray-500">
			Itens que carregam efeitos no treino e na aula (motor da Fase 3). Cada item pode ter vários
			efeitos; panteão e divindade têm os seus na aba Panteões.
		</p>
	</div>

	<nav class="flex flex-wrap gap-1.5">
		{#each KIND_TABS as t (t.value)}
			<a
				href="?kind={t.value}"
				class="px-3 py-1.5 rounded-lg text-sm transition-colors {t.value === kind
					? 'bg-indigo-600 text-white'
					: 'bg-gray-800 text-gray-400 hover:text-white'}">{t.label}</a
			>
		{/each}
	</nav>
	<p class="text-xs text-gray-500 -mt-3">{tab.hint}</p>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">{form.error}</div>
	{/if}
	{#if form?.created}
		<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300">"{form.created}" cadastrado.</div>
	{/if}

	<form method="POST" action="?/create" use:enhance={afterCreate} class="flex flex-wrap items-end gap-3">
		<input type="hidden" name="kind" value={kind} />
		<input type="hidden" name="category" value={categoryValue} />
		<div class="space-y-1">
			<label for="itemName" class="block text-xs text-gray-500">Nome</label>
			<input
				id="itemName"
				name="name"
				bind:value={newName}
				required
				maxlength="100"
				autocomplete="off"
				class="w-64 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
			/>
		</div>
		<div class="space-y-1">
			<label for="itemCategory" class="block text-xs text-gray-500">Categoria</label>
			{#if knownCategories.length > 0}
				<select
					id="itemCategory"
					bind:value={categoryChoice}
					class="w-48 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
				>
					<option value="" disabled>Categoria…</option>
					{#each knownCategories as c (c)}<option value={c}>{c}</option>{/each}
					<option value={NEW_CATEGORY}>＋ Nova categoria…</option>
				</select>
			{/if}
			{#if creatingCategory}
				<input
					bind:value={newCategory}
					maxlength="50"
					placeholder="Nova categoria — ex.: Mental"
					aria-label="Nome da nova categoria"
					autocomplete="off"
					class="block w-48 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
				/>
			{/if}
		</div>
		<button
			type="submit"
			disabled={!canSubmit}
			class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white disabled:opacity-40"
		>
			Adicionar
		</button>
	</form>

	<div class="space-y-2">
		{#each items as item (item.id)}
			<div class="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 space-y-2">
				<div class="flex items-center gap-3">
					<span class="text-sm font-medium text-white">{item.name}</span>
					<form method="POST" action="?/setCategory" use:enhance={() => async ({ update }) => update({ reset: false })}>
						<input type="hidden" name="kind" value={kind} />
						<input type="hidden" name="id" value={item.id} />
						<select
							name="category"
							onchange={submitOnChange}
							aria-label="Categoria de {item.name}"
							class="rounded bg-gray-800 border border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-300"
						>
							{#if !item.category}<option value="" selected disabled>Sem categoria</option>{/if}
							{#each knownCategories as c (c)}
								<option value={c} selected={c === item.category}>{c}</option>
							{/each}
						</select>
					</form>
					<form method="POST" action="?/delete" use:enhance={confirmDelete(item.name)} class="ml-auto">
						<input type="hidden" name="kind" value={kind} />
						<input type="hidden" name="id" value={item.id} />
						<button type="submit" class="text-xs text-gray-500 hover:text-red-400">Remover</button>
					</form>
				</div>
				<EffectsEditor ownerKind={kind} ownerId={item.id} effects={item.effects} {weapons} {knowledges} />
			</div>
		{/each}
		{#if items.length === 0}
			<div class="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-500">
				Nada cadastrado ainda.
			</div>
		{/if}
	</div>
</div>
