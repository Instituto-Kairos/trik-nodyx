<script lang="ts">
	import { enhance } from '$app/forms';
	import TabNav from '$lib/components/trik/TabNav.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type CatalogType = 'weapon' | 'knowledge';

	const TYPE_TABS: {
		value: CatalogType;
		label: string;
		tag: string;
		description: string;
		placeholder: string;
		removeWarning: string;
	}[] = [
		{
			value: 'weapon',
			label: 'Armas (treino)',
			tag: '#treino',
			description:
				'Armas que contam maestria quando a cena termina com "#treino #nomedaarma". Só o que estiver aqui conta — hashtag sem cadastro é ignorada.',
			placeholder: 'Ex.: Espada Longa',
			removeWarning: 'a maestria de todos os personagens nessa arma'
		},
		{
			value: 'knowledge',
			label: 'Matérias (aula)',
			tag: '#aula',
			description:
				'Matérias que contam progresso quando a cena termina com "#aula #nomedamateria". Só o que estiver aqui conta — hashtag sem cadastro é ignorada.',
			placeholder: 'Ex.: História',
			removeWarning: 'o progresso de todos os personagens nessa matéria'
		}
	];

	const currentType = $derived((data.type ?? 'weapon') as CatalogType);
	const currentTab = $derived(TYPE_TABS.find((t) => t.value === currentType) ?? TYPE_TABS[0]);

	interface CatalogEntry {
		id: string;
		name: string;
		category?: string;
	}

	const entries = $derived((data.entries ?? []) as CatalogEntry[]);
	const hasCategory = $derived(currentType === 'weapon');
	// Categorias já cadastradas: alimentam o dropdown. Uma nova só nasce junto
	// com a primeira arma que a usa (o backend também reaproveita a grafia
	// existente se o texto digitado bater com uma delas).
	const knownCategories = $derived(
		[...new Set(entries.map((e) => e.category).filter((c): c is string => !!c))].sort((a, b) =>
			a.localeCompare(b, 'pt-BR')
		)
	);

	// Mesma normalização do backend (normalizeCatalogName): minúsculo, sem
	// acento, só letras e dígitos.
	function normalizeKey(name: string): string {
		return name
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '');
	}

	// Hashtag não tem espaço nem acento/maiúscula: é assim que o nome cadastrado
	// vai ser escrito na cena.
	const hashtagPreview = (name: string) => '#' + normalizeKey(name);

	const NEW_CATEGORY = '__new__';

	let newName = $state('');
	// '' = ainda não escolheu; NEW_CATEGORY = "Nova categoria…"; senão, o nome de uma existente.
	let categoryChoice = $state('');
	let newCategory = $state('');
	// Sem nenhuma categoria cadastrada não há o que escolher: vai direto pro campo de texto.
	const creatingCategory = $derived(knownCategories.length === 0 || categoryChoice === NEW_CATEGORY);
	// Valor que vai no POST (o <select> em si não tem `name`).
	// A escolha some se a categoria deixou de existir (ex.: removeu a única arma dela).
	const categoryValue = $derived(
		creatingCategory ? newCategory.trim() : knownCategories.includes(categoryChoice) ? categoryChoice : ''
	);
	const canSubmit = $derived(!!newName.trim() && (!hasCategory || !!normalizeKey(categoryValue)));
</script>

<svelte:head><title>RPG — Armas &amp; Aulas</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Armas &amp; Aulas</h1>
		<p class="text-sm text-gray-500">
			Catálogo de cadastro rápido usado pelas hashtags <code class="text-gray-400">#treino</code>
			e <code class="text-gray-400">#aula</code> no rodapé das cenas.
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
			// Estado do momento do envio: depois do update() a lista de categorias já foi
			// recarregada e `creatingCategory` pode ter mudado.
			const wasCreating = creatingCategory;
			const typedCategory = newCategory;
			return async ({ result, update }) => {
				await update();
				// Só limpa se cadastrou — em erro (ex.: nome duplicado) mantém o que foi digitado.
				if (result.type === 'success') {
					newName = '';
					// Mantém a categoria selecionada (comum cadastrar várias armas da mesma).
					// Se acabou de criar uma nova, ela já está na lista recarregada: seleciona-a.
					if (wasCreating) {
						const created = knownCategories.find((c) => normalizeKey(c) === normalizeKey(typedCategory));
						categoryChoice = created ?? '';
						newCategory = '';
					}
				}
			};
		}}
		class="flex flex-wrap items-start gap-3"
	>
		<input type="hidden" name="type" value={currentType} />
		<div class="space-y-1">
			<input
				type="text"
				name="name"
				bind:value={newName}
				maxlength="60"
				placeholder={currentTab.placeholder}
				autocomplete="off"
				class="w-72 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
			/>
			{#if newName.trim()}
				<p class="text-xs text-gray-500">
					Na cena: <code class="text-gray-400">{currentTab.tag} {hashtagPreview(newName)}</code>
				</p>
			{/if}
		</div>
		{#if hasCategory}
			<div class="space-y-1">
				<input type="hidden" name="category" value={categoryValue} />
				{#if knownCategories.length > 0}
					<select
						bind:value={categoryChoice}
						aria-label="Categoria da arma"
						class="w-56 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					>
						<option value="" disabled>Categoria…</option>
						{#each knownCategories as category (category)}
							<option value={category}>{category}</option>
						{/each}
						<option value={NEW_CATEGORY}>＋ Nova categoria…</option>
					</select>
				{/if}
				{#if creatingCategory}
					<input
						type="text"
						bind:value={newCategory}
						maxlength="60"
						placeholder="Nova categoria — ex.: Espadas"
						aria-label="Nome da nova categoria"
						autocomplete="off"
						class="block w-56 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
					/>
				{/if}
				<p class="text-xs text-gray-500">Só registro interno (bônus por categoria) — não vira hashtag.</p>
			</div>
		{/if}
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
					<th class="px-4 py-3">Nome</th>
					<th class="px-4 py-3">Hashtag na cena</th>
					{#if hasCategory}<th class="px-4 py-3">Categoria</th>{/if}
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-800">
				{#each entries as entry (entry.id)}
					<tr>
						<td class="px-4 py-2 text-white">{entry.name}</td>
						<td class="px-4 py-2 text-gray-500">
							<code>{currentTab.tag} {hashtagPreview(entry.name)}</code>
						</td>
						{#if hasCategory}<td class="px-4 py-2 text-gray-300">{entry.category ?? '—'}</td>{/if}
						<td class="px-4 py-2 text-right">
							<form
								method="POST"
								action="?/delete"
								use:enhance={({ cancel }) => {
									// Apagar do catálogo leva o progresso junto (ON DELETE CASCADE nas tabelas
									// de progresso) — não é só "desfazer erro de digitação" se já houve cenas.
									if (
										!confirm(
											`Remover "${entry.name}"? Isso também apaga ${currentTab.removeWarning}.`
										)
									) {
										cancel();
									}
								}}
							>
								<input type="hidden" name="type" value={currentType} />
								<input type="hidden" name="id" value={entry.id} />
								<button
									type="submit"
									class="text-xs text-gray-500 hover:text-red-400 transition-colors"
								>
									Remover
								</button>
							</form>
						</td>
					</tr>
				{/each}
				{#if entries.length === 0}
					<tr>
						<td colspan={hasCategory ? 4 : 3} class="px-4 py-6 text-center text-gray-500">
							Nada cadastrado ainda.
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>
