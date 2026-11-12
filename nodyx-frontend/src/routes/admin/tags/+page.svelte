<script lang="ts">
    import { enhance } from '$app/forms';
    import { tick } from 'svelte';
    import { flip } from 'svelte/animate';
    import { dndzone } from 'svelte-dnd-action';

    import type { PageData, ActionData } from './$types';
    import { t } from '$lib/i18n';
    import { tagBadgeStyle } from '$lib/tagStyle';

    const tFn = $derived($t);

    let { data, form }: { data: PageData; form: ActionData } = $props();

    type Tag = NonNullable<PageData['tags']>[number];

	// Lista reativa usada pelo sistema de arrastar e soltar.
	let sortableTags = $state<Tag[]>([]);

	// Atualiza a lista quando os dados do servidor mudarem.
	$effect(() => {
		sortableTags = [...(data.tags ?? [])];
	});

    // Linha atualmente em edição.
    let editId = $state<string | null>(null);

    const flipDurationMs = 150;

    // Formulário oculto utilizado para salvar a nova ordem.
    let reorderForm: HTMLFormElement | undefined;

    // Atualiza a lista enquanto o usuário arrasta.
    function handleDndConsider(event: CustomEvent<{ items: Tag[] }>) {
        sortableTags = event.detail.items;
    }

    // Salva a nova ordem quando o usuário solta a linha.
    async function handleDndFinalize(event: CustomEvent<{ items: Tag[] }>) {
        sortableTags = event.detail.items;

        await tick();

        reorderForm?.requestSubmit();
    }
</script>

<svelte:head>
    <title>{tFn('atags.page_title')}</title>
</svelte:head>

<div>
    <h1 class="text-2xl font-bold text-white mb-6">
        {tFn('atags.title')}
    </h1>

    {#if form?.error}
        <p class="mb-4 rounded-lg bg-red-900/40 border border-red-800 px-4 py-2 text-sm text-red-300">
            {form.error}
        </p>
    {/if}

    <!-- Create form -->
    <details class="mb-6 rounded-xl border border-gray-800 bg-gray-900/50">
        <summary class="cursor-pointer px-5 py-3.5 text-sm font-semibold text-indigo-300 hover:text-indigo-200 select-none flex items-center gap-2">
            <span class="text-base">+</span>
            {tFn('atags.create_tag')}
        </summary>

        <form
            method="POST"
            action="?/create"
            use:enhance
            class="px-5 pb-5 pt-3 space-y-4 border-t border-gray-800"
        >
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label
                        for="tag-create-name"
                        class="block text-xs text-gray-400 mb-1"
                    >
                        {tFn('atags.name')}
                    </label>

                    <input
                        id="tag-create-name"
                        name="name"
                        type="text"
                        required
                        maxlength="50"
                        placeholder={tFn('atags.name_ph')}
                        class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                    />
                </div>

                <div>
                    <label
                        for="tag-create-color"
                        class="block text-xs text-gray-400 mb-1"
                    >
                        {tFn('atags.color')}
                    </label>

                    <input
                        id="tag-create-color"
                        name="color"
                        type="color"
                        value="#6366f1"
                        class="h-10 w-full rounded-lg bg-gray-800 border border-gray-700 px-1 cursor-pointer"
                    />
                </div>
            </div>

            <button
                type="submit"
                class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
                {tFn('atags.create')}
            </button>
        </form>
    </details>

    <!-- Hidden form: saves the complete tag order -->
    <form
        method="POST"
        action="?/reorder"
        use:enhance
        bind:this={reorderForm}
        class="hidden"
    >
        <input
            type="hidden"
            name="ids"
            value={JSON.stringify(sortableTags.map((tag) => tag.id))}
        />
    </form>

    <!-- Tags list -->
    {#if sortableTags.length === 0}
        <p class="text-sm text-gray-500">
            {tFn('atags.empty')}
        </p>
    {:else}
        <div class="rounded-xl border border-gray-800 overflow-x-auto">
            <table class="tableau-cartes w-full text-sm md:min-w-[480px]">
                <thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                    <tr>
                        <th class="px-4 py-3 text-left">
                            {tFn('atags.col_tag')}
                        </th>

                        <th class="px-4 py-3 text-left">
                            {tFn('atags.col_slug')}
                        </th>

                        <th class="px-4 py-3 text-right">
                            {tFn('atags.col_action')}
                        </th>
                    </tr>
                </thead>

                <tbody
                    class="divide-y divide-gray-800/60"
                    use:dndzone={{
                        items: sortableTags,
                        flipDurationMs,
                        dragDisabled: editId !== null
                    }}
					onconsider={handleDndConsider}
					onfinalize={handleDndFinalize}
                >
                    {#each sortableTags as tag (tag.id)}
                        <tr
                            animate:flip={{ duration: flipDurationMs }}
                            class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors"
                        >
                            {#if editId === tag.id}
                                <td class="px-4 py-3" colspan="3">
                                    <form
                                        method="POST"
                                        action="?/update"
                                        class="flex flex-wrap items-center gap-2"
                                        use:enhance={() => async ({ result, update }) => {
                                            await update({ reset: false });

                                            if (result.type === 'success') {
                                                editId = null;
                                            }
                                        }}
                                    >
                                        <input
                                            type="hidden"
                                            name="tag_id"
                                            value={tag.id}
                                        />

                                        <input
                                            name="name"
                                            type="text"
                                            required
                                            maxlength="50"
                                            value={tag.name}
                                            aria-label={tFn('atags.name')}
                                            class="flex-1 min-w-[10rem] rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                                        />

                                        <input
                                            name="color"
                                            type="color"
                                            value={tag.color}
                                            aria-label={tFn('atags.color')}
                                            class="h-9 w-14 rounded-lg bg-gray-800 border border-gray-700 px-1 cursor-pointer"
                                        />

                                        <button
                                            type="submit"
                                            class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white"
                                        >
                                            {tFn('common.save')}
                                        </button>

                                        <button
                                            type="button"
                                            onclick={() => (editId = null)}
                                            class="text-xs text-gray-400 hover:text-white"
                                        >
                                            {tFn('common.cancel')}
                                        </button>
                                    </form>
                                </td>
                            {:else}
                                <td
                                    class="px-4 py-3"
                                    data-label={tFn('atags.col_tag')}
                                >
                                    <span
                                        class="inline-block rounded-full px-3 py-1 text-xs font-semibold"
                                        style={tagBadgeStyle(tag.color)}
                                    >
                                        {tag.name}
                                    </span>
                                </td>

                                <td
                                    class="px-4 py-3 text-gray-400 font-mono text-xs"
                                    data-label={tFn('atags.col_slug')}
                                >
                                    {tag.slug}
                                </td>

                                <td class="px-4 py-3 text-right whitespace-nowrap">
                                    <!-- Drag indicator -->
                                    <span
                                        aria-hidden="true"
                                        title="Arraste para reorganizar"
                                        class="inline-block mr-3 px-1.5 text-lg text-gray-500 cursor-grab active:cursor-grabbing select-none touch-none"
                                    >
                                        ⠿
                                    </span>

                                    <!-- Edit -->
                                    <button
                                        type="button"
                                        onclick={() => (editId = tag.id)}
                                        class="text-xs text-indigo-400 hover:text-indigo-300 mr-3"
                                    >
                                        {tFn('common.edit')}
                                    </button>

                                    <!-- Delete -->
                                    <form
                                        method="POST"
                                        action="?/delete"
                                        use:enhance
                                        class="inline"
                                    >
                                        <input
                                            type="hidden"
                                            name="tag_id"
                                            value={tag.id}
                                        />

                                        <button
                                            type="submit"
                                            onclick={(e) => {
                                                if (!confirm(tFn('atags.confirm_delete', { name: tag.name }))) {
                                                    e.preventDefault();
                                                }
                                            }}
                                            class="text-xs text-red-500 hover:text-red-400"
                                        >
                                            {tFn('atags.delete')}
                                        </button>
                                    </form>
                                </td>
                            {/if}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>