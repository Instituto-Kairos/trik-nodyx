<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import type { ActionData, PageData } from './$types';
	import { t } from '$lib/i18n';
	import { luminance } from '$lib/shellTheme';

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Tag = { id: string; name: string; color: string };

	const thread   = $derived(data.thread);
	const tags     = $derived((data.tags ?? []) as Tag[]);
	const backHref = $derived(`/forum/${thread.category_slug ?? thread.category_id}/${thread.slug ?? thread.id}`);

	// Estado inicial vindo do tópico ; editado localmente até o envio.
	let title          = $state(untrack(() => data.thread.title as string));
	let selectedTagIds = $state<string[]>(untrack(() => ((data.thread.tags ?? []) as Tag[]).map(t => t.id)));
	let submitting     = $state(false);

	// A cor da tag não pode virar a cor do texto: uma tag escura some no fundo
	// escuro. Selecionada = fundo sólido na cor da tag com texto contrastante
	// (como em /admin/tags); não selecionada = texto neutro + ponto colorido.
	function tagTextColor(color: string): string {
		try { return luminance(color) > 0.5 ? '#111' : '#fff'; } catch { return '#fff'; }
	}

	// Mesmo teto de 5 tags da criação de tópico (CreateThreadBody em routes/forums.ts).
	function toggleTag(id: string) {
		if (selectedTagIds.includes(id)) {
			selectedTagIds = selectedTagIds.filter(t => t !== id);
		} else if (selectedTagIds.length < 5) {
			selectedTagIds = [...selectedTagIds, id];
		}
	}
</script>

<svelte:head>
	<title>Editar tópico · Nodyx</title>
</svelte:head>

<div class="max-w-3xl">
	<a href={backHref} class="text-sm text-gray-500 hover:text-gray-300">{tFn('common.back')}</a>
	<h1 class="mt-2 text-2xl font-bold text-white mb-6">Editar tópico</h1>

	{#if form?.error}
		<p class="mb-4 bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">{form.error}</p>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
		class="space-y-5"
	>
		<div>
			<label for="title" class="block text-sm text-gray-400 mb-1">{tFn('forum.title_label')}</label>
			<input
				id="title"
				name="title"
				type="text"
				required
				minlength="3"
				maxlength="300"
				bind:value={title}
				class="w-full bg-gray-800 border border-gray-700 px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
			/>
		</div>

		<div>
			<span class="block text-sm text-gray-400 mb-2">
				Tags <span class="text-gray-600 text-xs">(máx. 5)</span>
			</span>
			{#if tags.length === 0}
				<p class="text-sm text-gray-500">
					Nenhuma tag cadastrada. <a href="/admin/tags" class="text-indigo-400 hover:text-indigo-300">Criar tags</a>
				</p>
			{:else}
				<div class="flex flex-wrap gap-2">
					{#each tags as tag}
						<button
							type="button"
							onclick={() => toggleTag(tag.id)}
							aria-pressed={selectedTagIds.includes(tag.id)}
							class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer {selectedTagIds.includes(tag.id) ? '' : 'text-gray-200 hover:bg-gray-800'}"
							style={selectedTagIds.includes(tag.id)
								? `background-color: ${tag.color}; border-color: ${tag.color}; color: ${tagTextColor(tag.color)};`
								: `border-color: ${tag.color};`}
						>
							{#if selectedTagIds.includes(tag.id)}✓{:else}<span class="inline-block w-2 h-2 rounded-full" style="background-color: {tag.color}"></span>{/if}
							{tag.name}
						</button>
					{/each}
				</div>
			{/if}
			{#each selectedTagIds as tagId}
				<input type="hidden" name="tag_ids" value={tagId} />
			{/each}
		</div>

		<div class="flex items-center gap-3">
			<button
				type="submit"
				disabled={submitting}
				class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 text-sm font-semibold text-white transition-colors"
			>
				{submitting ? 'Salvando…' : 'Salvar'}
			</button>
			<a href={backHref} class="px-5 py-2 text-sm font-semibold text-gray-400 hover:text-gray-200 transition-colors">{tFn('common.cancel')}</a>
		</div>
	</form>
</div>
