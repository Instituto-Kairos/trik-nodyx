<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	interface Category {
		id: string;
		name: string;
		parent_id: string | null;
		position: number;
		enabled: boolean;
	}

	const categories = $derived((data.categories ?? []) as Category[]);

	// Categoria cujo pai não existe na lista também é raiz (parent_id aponta
	// para fora da comunidade ou ficou órfão) — senão ela sumiria da tela.
	const roots = $derived.by(() => {
		const ids = new Set(categories.map((c) => c.id));
		return categories.filter((c) => !c.parent_id || !ids.has(c.parent_id));
	});

	const childrenOf = $derived.by(() => {
		const map = new Map<string, Category[]>();
		for (const c of categories) {
			if (!c.parent_id) continue;
			const list = map.get(c.parent_id) ?? [];
			list.push(c);
			map.set(c.parent_id, list);
		}
		return map;
	});

	// Categoria + todas as descendentes, em ordem de árvore, com a profundidade
	// para indentar. `seen` corta ciclo de parent_id, se houver.
	function subtree(rootId: string): { cat: Category; depth: number }[] {
		const root = categories.find((c) => c.id === rootId);
		if (!root) return [];
		const out: { cat: Category; depth: number }[] = [];
		const seen = new Set<string>();
		const walk = (cat: Category, depth: number) => {
			if (seen.has(cat.id)) return;
			seen.add(cat.id);
			out.push({ cat, depth });
			for (const child of childrenOf.get(cat.id) ?? []) walk(child, depth + 1);
		};
		walk(root, 0);
		return out;
	}

	let selected = $state<Set<string>>(new Set());
	$effect(() => {
		selected = new Set(categories.filter((c) => c.enabled).map((c) => c.id));
	});

	let rootId = $state<string>('');
	$effect(() => {
		if (!rootId && roots.length > 0) rootId = roots[0].id;
	});

	const rows = $derived(rootId ? subtree(rootId) : []);

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function setAll(on: boolean) {
		const next = new Set(selected);
		for (const { cat } of rows) {
			if (on) next.add(cat.id);
			else next.delete(cat.id);
		}
		selected = next;
	}

	function countIn(id: string): number {
		return subtree(id).filter(({ cat }) => selected.has(cat.id)).length;
	}

	const nameById = $derived(new Map(categories.map((c) => [c.id, c.name])));
	const enabledList = $derived(
		categories.filter((c) => selected.has(c.id)).map((c) => {
			const parent = c.parent_id ? nameById.get(c.parent_id) : null;
			return parent ? `${parent} › ${c.name}` : c.name;
		})
	);

	const idsJson = $derived(JSON.stringify(Array.from(selected)));
</script>

<svelte:head><title>RPG — Notificações</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Notificações por categoria</h1>
		<p class="text-sm text-gray-500">
			Todo post (tópico novo ou resposta) numa categoria marcada notifica todos os membros da
			comunidade. Subcategorias não herdam: marque cada uma que também deve notificar. Várias
			respostas no mesmo tópico viram uma única notificação até o membro lê-la.
		</p>
	</div>

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

	{#if roots.length === 0}
		<p class="text-sm text-gray-500">Nenhuma categoria no fórum ainda.</p>
	{:else}
		<form method="POST" action="?/save" use:enhance class="space-y-4">
			<input type="hidden" name="categoryIds" value={idsJson} />

			<div class="flex flex-wrap items-end gap-3">
				<label class="flex flex-col gap-1 text-xs text-gray-400">
					Categoria
					<select
						bind:value={rootId}
						class="min-w-56 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
					>
						{#each roots as r (r.id)}
							{@const n = countIn(r.id)}
							<option value={r.id}>{r.name}{n ? ` (${n} ativa${n > 1 ? 's' : ''})` : ''}</option>
						{/each}
					</select>
				</label>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => setAll(true)}
						class="px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
					>
						Marcar todas
					</button>
					<button
						type="button"
						onclick={() => setAll(false)}
						class="px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
					>
						Desmarcar todas
					</button>
				</div>
			</div>

			<div class="rounded-xl border border-gray-800 bg-gray-900/40">
				<ul class="divide-y divide-gray-800">
					{#each rows as { cat, depth } (cat.id)}
						{@const checked = selected.has(cat.id)}
						<li
							class="flex items-center justify-between gap-4 px-5 py-3"
							style="padding-left: {1.25 + depth * 1.5}rem"
						>
							<span class="text-sm truncate {depth === 0 ? 'font-medium text-white' : 'text-gray-300'}">
								{#if depth > 0}<span class="text-gray-600 mr-1">↳</span>{/if}{cat.name}
							</span>
							<label class="relative inline-flex items-center shrink-0 cursor-pointer">
								<input
									type="checkbox"
									{checked}
									onchange={() => toggle(cat.id)}
									class="peer sr-only"
									aria-label="Notificar todos em {cat.name}"
								/>
								<span class="w-9 h-5 rounded-full bg-gray-700 transition-colors peer-checked:bg-indigo-600"></span>
								<span
									class="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4"
								></span>
							</label>
						</li>
					{/each}
				</ul>
			</div>

			<div class="text-xs text-gray-500">
				{#if enabledList.length === 0}
					Nenhuma categoria notificando.
				{:else}
					Notificando em: <span class="text-gray-300">{enabledList.join(', ')}</span>
				{/if}
			</div>

			<button
				type="submit"
				class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors"
			>
				Salvar
			</button>
		</form>
	{/if}
</div>
