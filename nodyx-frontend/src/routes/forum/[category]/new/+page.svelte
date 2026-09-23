<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte';
	import PollCreator from '$lib/components/PollCreator.svelte';
	import { t } from '$lib/i18n';
	import { untrack } from 'svelte';

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tags = $derived(data.tags ?? []);
	let selectedTagIds = $state<string[]>([]);
	let submitting = $state(false);

	// ── Sélecteur catégorie / sous-catégorie ──────────────────────────────
	type CatNode = { id: string; slug?: string; name: string; post_min_role?: string; children: CatNode[] };

	// Rôle de l'utilisateur courant vs post_min_role de la catégorie. Un
	// non-membre vaut -1, donc en dessous de 'member' : le back tranche pour de
	// bon (routes/forums.ts), ceci ne fait qu'éviter d'afficher un choix voué au 403.
	const RANK: Record<string, number> = { member: 0, moderator: 1, admin: 2, owner: 3 };
	const userRank = $derived(RANK[(data.user as { role?: string } | null)?.role ?? ''] ?? -1);
	function canPostIn(cat: CatNode): boolean {
		return userRank >= (RANK[cat.post_min_role ?? 'member'] ?? 0);
	}

	// Chemin d'ids de la racine jusqu'à la catégorie ciblée, à n'importe quelle profondeur.
	// targetId vient de l'URL : c'est un slug (ou un UUID selon le lien).
	function findPath(cats: CatNode[], targetId: string): string[] | null {
		for (const cat of cats) {
			if (cat.id === targetId || cat.slug === targetId) return [cat.id];
			const sub = findPath(cat.children ?? [], targetId);
			if (sub) return [cat.id, ...sub];
		}
		return null;
	}

	// N'expose que les catégories où l'utilisateur peut réellement ouvrir un fil.
	function filterPostable(cats: CatNode[]): CatNode[] {
		return cats
			.filter(canPostIn)
			.map(c => ({ ...c, children: filterPostable(c.children ?? []) }));
	}

	const rootCategories = $derived(filterPostable((data.categories ?? []) as CatNode[]));
	const noCategory = $derived(rootCategories.length === 0);

	let categoryPath = $state<string[]>(untrack(() => {
		const roots = filterPostable((data.categories ?? []) as CatNode[]);
		return findPath(roots, data.currentCategoryId ?? '') ?? (roots[0] ? [roots[0].id] : []);
	}));

	// Un sélecteur par niveau : racines, puis enfants du choix précédent, tant qu'il y en a.
	const levels = $derived.by(() => {
		const out: CatNode[][] = [];
		let nodes = rootCategories;
		for (let i = 0; nodes.length > 0; i++) {
			out.push(nodes);
			nodes = nodes.find(n => n.id === categoryPath[i])?.children ?? [];
		}
		return out;
	});
	const finalCategoryId = $derived(categoryPath[categoryPath.length - 1] ?? '');

	function onLevelChange(level: number, e: Event) {
		const value = (e.currentTarget as HTMLSelectElement).value;
		categoryPath = value ? [...categoryPath.slice(0, level), value] : categoryPath.slice(0, level);
	}

	// ── Sondage optionnel ──────────────────────────────────────────────────
	let showPollSection = $state(false);
	let pollConfig      = $state<any>(null);
	let pollJson        = $derived(pollConfig ? JSON.stringify(pollConfig) : '');

	function toggleTag(id: string) {
		if (selectedTagIds.includes(id)) {
			selectedTagIds = selectedTagIds.filter(t => t !== id);
		} else if (selectedTagIds.length < 5) {
			selectedTagIds = [...selectedTagIds, id];
		}
	}
</script>

<svelte:head>
	<title>{tFn('forum.create_topic')} · Nodyx</title>
</svelte:head>

<div class="max-w-3xl">
	<a href="/forum/{finalCategoryId}" class="text-sm text-gray-500 hover:text-gray-300">{tFn('common.back')}</a>
	<h1 class="mt-2 text-2xl font-bold text-white mb-6">{tFn('forum.create_topic')}</h1>

	{#if form?.error}
		<p class="mb-4 bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
			{form.code === 'CATEGORY_RESTRICTED' ? tFn('forum.category_restricted') : form.error}
		</p>
	{/if}

	{#if noCategory}
		<p class="mb-4 bg-gray-800 border border-gray-700 px-4 py-3 text-sm text-gray-400">
			{tFn('forum.new_topic_no_category')}
		</p>
	{:else}
	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		class="space-y-5"
	>
		<!-- Sélecteur catégorie + sous-catégorie -->
		<div>
			<span class="block text-sm text-gray-400 mb-2">{tFn('forum.category')}</span>
			<div class="flex flex-wrap gap-2">
				{#each levels as options, level}
					<select
						onchange={(e) => onLevelChange(level, e)}
						class="flex-1 min-w-[180px]bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
					>
						{#if level > 0}
							<option value="">{tFn('forum.no_subcategory')}</option>
						{/if}
						{#each options as cat}
							<option value={cat.id} selected={cat.id === categoryPath[level]}>{cat.name}</option>
						{/each}
					</select>
				{/each}
			</div>
			<input type="hidden" name="category_id" value={finalCategoryId} />
		</div>

		<div>
			<label for="title" class="block text-sm text-gray-400 mb-1">
				{tFn('forum.title_label')} <span class="text-gray-600 text-xs">{tFn('forum.title_hint')}</span>
			</label>
			<input
				id="title"
				name="title"
				type="text"
				required
				minlength="3"
				maxlength="300"
				placeholder={tFn('forum.title_placeholder')}
				class="w-fullbg-gray-800 border border-gray-700 px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
			/>
		</div>

		<div>
			<span class="block text-sm text-gray-400 mb-2">{tFn('forum.message_label')}</span>
			<NodyxEditor mentions
				name="content"
				placeholder={tFn('forum.message_placeholder')}
			/>
		</div>

		<!-- Tags multi-select -->
		{#if tags.length > 0}
			<div>
				<span class="block text-sm text-gray-400 mb-2">
					Tags <span class="text-gray-600 text-xs">(optionnel, max 5)</span>
				</span>
				<div class="flex flex-wrap gap-2">
					{#each tags as tag}
						<button
							type="button"
							onclick={() => toggleTag(tag.id)}
							class="inline-flex items-center px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer"
							style="
								background-color: {selectedTagIds.includes(tag.id) ? tag.color + '33' : 'transparent'};
								color: {tag.color};
								border-color: {selectedTagIds.includes(tag.id) ? tag.color : tag.color + '55'};
							"
						>
							{#if selectedTagIds.includes(tag.id)}✓ {/if}{tag.name}
						</button>
					{/each}
				</div>
				<!-- Hidden inputs for selected tags -->
				{#each selectedTagIds as tagId}
					<input type="hidden" name="tag_ids" value={tagId} />
				{/each}
			</div>
		{/if}

		<!-- Sondage optionnel -->
		<div>
			{#if !showPollSection}
				<button
					type="button"
					onclick={() => showPollSection = true}
					class="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-700 text-sm text-gray-500 hover:text-indigo-400 hover:border-indigo-700 transition-colors"
				>
					<span>📊</span>
					<span>{tFn('forum.attach_poll')} <span class="text-gray-600 text-xs">{tFn('common.optional')}</span></span>
				</button>
			{:else}
				<div class="border border-indigo-900/50 bg-gray-900/50 p-4">
					<div class="flex items-center justify-between mb-3">
						<span class="text-sm font-medium text-indigo-300">{tFn('forum.poll_attached')}</span>
						{#if pollConfig}
							<div class="flex items-center gap-2">
								<span class="text-xs text-green-400">{tFn('forum.poll_configured')}</span>
								<button type="button" onclick={() => { pollConfig = null; showPollSection = false; }}
									class="text-xs text-gray-500 hover:text-red-400 transition-colors">Retirer</button>
							</div>
						{:else}
							<button type="button" onclick={() => showPollSection = false}
								class="text-xs text-gray-500 hover:text-gray-300 transition-colors">{tFn('common.cancel')}</button>
						{/if}
					</div>
					{#if !pollConfig}
						<PollCreator
							token={data.token}
							channelId={null}
							onCollect={(cfg) => { pollConfig = cfg; }}
							onClose={() => showPollSection = false}
						/>
					{:else}
						<div class="text-sm text-gray-400">
							<span class="font-medium text-white">{pollConfig.title}</span>
							<span class="ml-2 text-gray-600">·</span>
							<span class="ml-2">{tFn('forum.poll_n_options', { n: String(pollConfig.options.length) })}</span>
							<button type="button" onclick={() => pollConfig = null}
								class="ml-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">{tFn('common.edit')}</button>
						</div>
					{/if}
				</div>
				{#if pollConfig}
					<input type="hidden" name="poll_json" value={pollJson} />
				{/if}
			{/if}
		</div>

		<div class="flex items-center gap-3">
			<button
				type="submit"
				disabled={submitting}
				class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 text-sm font-semibold text-white transition-colors"
			>
				{submitting ? tFn('common.publishing') : tFn('forum.publish_topic')}
			</button>
			<a href="/forum/{finalCategoryId}" class="bg-red-900/50 hover:bg-red-800/60 border border-red-700/50 hover:border-red-600 px-5 py-2 text-sm font-semibold text-red-300 hover:text-red-200 transition-colors">{tFn('common.cancel')}</a>
		</div>
	</form>
	{/if}
</div>
