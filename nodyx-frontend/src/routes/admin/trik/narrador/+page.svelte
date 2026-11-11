<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	interface Balance {
		earned: number;
		distributed: number;
		available: number;
	}

	interface Narrator {
		user_id: string;
		username: string;
		tags: string[];
		is_main: boolean;
		available?: number;
	}

	interface Character {
		id: string;
		name: string;
		level: number;
		progress_xp: number;
		goal_xp: number | null;
	}

	interface AuCharacter {
		id: string;
		name: string;
		xp: number;
	}

	interface Award {
		post_id: string;
		xp_awarded: number;
		/** Tags do narrador usadas no post, sem '#'. Vazio = prêmio antigo não identificado. */
		tags?: string[];
		created_at: string;
		thread_id: string;
		thread_title: string;
		thread_slug: string | null;
		category_id: string;
		category_slug: string | null;
	}

	interface Distribution {
		id: string;
		xp: number;
		created_at: string;
		character_id: string | null;
		character_name: string | null;
		is_au: boolean;
	}

	interface Detail {
		narrator: Narrator;
		balance: Balance;
		characters: Character[];
		auCharacters: AuCharacter[];
		awards: Award[];
		distributions: Distribution[];
	}

	const narrators = $derived((data.narrators ?? []) as Narrator[]);
	const detail = $derived(data.detail as Detail | null);
	const narrator = $derived(detail?.narrator ?? null);
	const balance = $derived(detail?.balance ?? { earned: 0, distributed: 0, available: 0 });
	const characters = $derived(detail?.characters ?? []);
	const auCharacters = $derived(detail?.auCharacters ?? []);
	const awards = $derived(detail?.awards ?? []);
	const distributions = $derived(detail?.distributions ?? []);

	const tagList = (tags: string[]) => tags.map((t) => '#' + t).join(' ');
	const tagsLabel = $derived(narrator ? tagList(narrator.tags) : '');

	let showAdd = $state(false);
	let newTag = $state('');
	let character = $state('');
	let xp = $state<number | null>(null);
	// Trocar de narrador zera a escolha: o personagem de um não vale no outro.
	$effect(() => {
		data.selected;
		character = '';
		xp = null;
	});
	const canSubmit = $derived(
		!!character && !!xp && Number.isInteger(xp) && xp > 0 && xp <= balance.available
	);

	const threadHref = (a: Award) =>
		`/forum/${a.category_slug ?? a.category_id}/${a.thread_slug ?? a.thread_id}`;
	const fmtDate = (iso: string) =>
		new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
</script>

<svelte:head><title>RPG — Narradores</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Narradores</h1>
		<p class="text-sm text-gray-500">
			Cada narrador tem as suas tags (uma ou mais). Post do narrador com qualquer tag dele num tópico que vale XP rende 15 XP a
			cada 500 caracteres (proporcional, mínimo de 500). Esse XP não vai pra personagem nenhum: fica
			acumulado no pool do narrador e pode ser distribuído entre os personagens dele, do /registro ou do
			/registro-au. Editar ou apagar o post desfaz o prêmio.
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}

	<!-- ── Sub-abas: uma por narrador + adicionar ──────────────────────────── -->
	<div class="flex items-end gap-1 border-b border-gray-800 overflow-x-auto">
		{#each narrators as n (n.user_id)}
			<a
				href="?u={n.user_id}"
				class="px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors
				       {data.selected === n.user_id
					? 'border-indigo-400 text-white'
					: 'border-transparent text-gray-500 hover:text-gray-300'}"
			>
				@{n.username} <span class="text-gray-500">{tagList(n.tags)}</span>
				{#if (n.available ?? 0) !== 0}
					<span class="ml-1 text-xs {(n.available ?? 0) < 0 ? 'text-red-400' : 'text-emerald-400'}">{n.available}</span>
				{/if}
			</a>
		{/each}
		<button
			type="button"
			onclick={() => (showAdd = !showAdd)}
			class="px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px border-transparent text-indigo-400 hover:text-indigo-300"
		>
			+ Adicionar narrador
		</button>
	</div>

	{#if showAdd || form?.addError}
		<form method="POST" action="?/adicionar" use:enhance class="rounded-xl border border-gray-800 bg-gray-900/40 p-4 flex flex-wrap items-end gap-3">
			<div class="space-y-1">
				<label for="nar-user" class="block text-xs text-gray-500">Usuário</label>
				<input id="nar-user" name="username" required placeholder="ex.: fulano"
					class="w-56 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600" />
			</div>
			<div class="space-y-1">
				<label for="nar-tag" class="block text-xs text-gray-500">Tags</label>
				<input id="nar-tag" name="tag" required placeholder="ex.: au, evento" maxlength="300"
					class="w-56 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600" />
			</div>
			<button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white">
				Adicionar
			</button>
			{#if form?.addError}<p class="w-full text-sm text-red-400">{form.addError}</p>{/if}
			<p class="w-full text-xs text-gray-500">
				Uma ou mais tags, separadas por espaço ou vírgula (o <code>#</code> é opcional). Cada tag pertence a
				um narrador só; treino, aula, tarefa, trabalho e com são reservadas.
			</p>
		</form>
	{/if}

	{#if data.loadError}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			Não foi possível carregar os dados do narrador.
		</div>
	{:else if !narrator}
		<div class="rounded-lg border border-amber-800 bg-amber-900/30 px-4 py-3 text-sm text-amber-300">
			Nenhum narrador cadastrado. Use "+ Adicionar narrador".
		</div>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-gray-400">
				Posts de <strong class="text-white">@{narrator.username}</strong> com
				{narrator.tags.length > 1 ? 'qualquer uma das tags abaixo' : 'a tag abaixo'} rendem XP pra este pool.
			</p>
			{#if !narrator.is_main}
				<form method="POST" action="?/remover" use:enhance={({ cancel }) => {
					if (!confirm(`Remover @${narrator.username} dos narradores? O saldo fica guardado caso ele volte.`)) cancel();
				}}>
					<input type="hidden" name="userId" value={narrator.user_id} />
					<button type="submit" class="px-3 py-1.5 rounded-lg bg-red-900/40 text-red-400 hover:bg-red-800/60 text-xs font-medium">
						Remover narrador
					</button>
				</form>
			{/if}
		</div>

		<!-- ── Tags do narrador (trik_020) ─────────────────────────────────────── -->
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-3">
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mr-1">Tags</span>
				{#each narrator.tags as t (t)}
					{@const fixed = narrator.is_main && t.toLowerCase() === 'lore'}
					<span class="inline-flex items-center gap-1 rounded-full bg-gray-800 border border-gray-700 pl-3 {fixed || narrator.tags.length <= 1 ? 'pr-3' : 'pr-1'} py-1 text-sm text-gray-200">
						#{t}
						{#if !fixed && narrator.tags.length > 1}
							<form method="POST" action="?/removerTag" use:enhance class="inline">
								<input type="hidden" name="userId" value={narrator.user_id} />
								<input type="hidden" name="tag" value={t} />
								<button type="submit" title="Remover #{t}" aria-label="Remover #{t}"
									class="w-5 h-5 rounded-full text-gray-500 hover:text-red-400 hover:bg-red-900/40 leading-none">×</button>
							</form>
						{/if}
					</span>
				{/each}
			</div>
			<form
				method="POST"
				action="?/adicionarTag"
				use:enhance={() => {
					return async ({ result, update }) => {
						await update({ reset: false });
						if (result.type === 'success') newTag = '';
					};
				}}
				class="flex flex-wrap items-center gap-2"
			>
				<input type="hidden" name="userId" value={narrator.user_id} />
				<input name="tag" bind:value={newTag} placeholder="nova tag (ex.: evento)" maxlength="300"
					class="w-56 rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white placeholder-gray-600" />
				<button type="submit" disabled={!newTag.trim()}
					class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white disabled:opacity-40 disabled:hover:bg-indigo-600">
					+ Adicionar tag
				</button>
				{#if form?.tagError}<p class="w-full text-sm text-red-400">{form.tagError}</p>{/if}
			</form>
		</div>

		{#if form?.distributed}
			<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300">
				{form.distributed.xp} XP distribuídos pra {form.distributed.characterName}{form.distributed
					.leveledUp
					? ' — subiu de nível!'
					: '.'}
			</div>
		{/if}

		<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
			<div class="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
				<div class="text-[10px] font-bold uppercase tracking-widest text-gray-500">Disponível</div>
				<div class="text-2xl font-bold {balance.available < 0 ? 'text-red-400' : 'text-white'}">
					{balance.available} XP
				</div>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
				<div class="text-[10px] font-bold uppercase tracking-widest text-gray-500">Ganho com {tagsLabel}</div>
				<div class="text-2xl font-bold text-gray-300">{balance.earned} XP</div>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
				<div class="text-[10px] font-bold uppercase tracking-widest text-gray-500">Já distribuído</div>
				<div class="text-2xl font-bold text-gray-300">{balance.distributed} XP</div>
			</div>
		</div>
		{#if balance.available < 0}
			<p class="text-xs text-red-400">
				Saldo negativo: um post premiado foi editado ou apagado depois de o XP já ter sido
				distribuído. Os próximos posts com {tagsLabel} pagam essa diferença primeiro.
			</p>
		{/if}

		<section class="space-y-3">
			<h2 class="text-sm font-semibold text-white">Distribuir XP</h2>
			{#if characters.length === 0 && auCharacters.length === 0}
				<p class="text-sm text-gray-500">
					@{narrator.username} ainda não tem personagens registrados (nem no /registro, nem no /registro-au).
				</p>
			{:else}
				<form
					method="POST"
					action="?/distribuir"
					use:enhance={() => {
						return async ({ result, update }) => {
							await update();
							if (result.type === 'success') xp = null;
						};
					}}
					class="flex flex-wrap items-end gap-3"
				>
					<input type="hidden" name="userId" value={narrator.user_id} />
					<div class="space-y-1">
						<label for="character" class="block text-xs text-gray-500">Personagem</label>
						<select
							id="character"
							name="character"
							bind:value={character}
							class="w-64 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
						>
							<option value="" disabled>Escolha…</option>
							{#if characters.length}
								<optgroup label="Universo principal">
									{#each characters as c (c.id)}
										<option value="main:{c.id}">{c.name} (nível {c.level})</option>
									{/each}
								</optgroup>
							{/if}
							{#if auCharacters.length}
								<optgroup label="AU">
									{#each auCharacters as c (c.id)}
										<option value="au:{c.id}">{c.name} ({c.xp} XP)</option>
									{/each}
								</optgroup>
							{/if}
						</select>
					</div>
					<div class="space-y-1">
						<label for="xp" class="block text-xs text-gray-500">XP</label>
						<input
							id="xp"
							type="number"
							name="xp"
							bind:value={xp}
							min="1"
							max={Math.max(balance.available, 1)}
							step="1"
							placeholder="Ex.: 30"
							class="w-28 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
						/>
					</div>
					<button
						type="submit"
						disabled={!canSubmit}
						class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:hover:bg-indigo-600"
					>
						Distribuir
					</button>
				</form>

				<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
					<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
									<th class="px-4 py-3">Universo principal</th>
									<th class="px-4 py-3">Nível</th>
									<th class="px-4 py-3">XP</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-800">
								{#each characters as c (c.id)}
									<tr>
										<td class="px-4 py-2 text-white">{c.name}</td>
										<td class="px-4 py-2 text-gray-300">{c.level}</td>
										<td class="px-4 py-2 text-gray-300">
											{c.progress_xp}{c.goal_xp !== null ? ` / ${c.goal_xp}` : ''}
											{#if c.goal_xp === null}<span class="text-gray-500">(nível máx.)</span>{/if}
										</td>
									</tr>
								{/each}
								{#if characters.length === 0}
									<tr><td colspan="3" class="px-4 py-6 text-center text-gray-500">Nenhum personagem no /registro.</td></tr>
								{/if}
							</tbody>
						</table>
					</div>
					<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
									<th class="px-4 py-3">AU</th>
									<th class="px-4 py-3">XP acumulado</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-800">
								{#each auCharacters as c (c.id)}
									<tr>
										<td class="px-4 py-2 text-white">{c.name}</td>
										<td class="px-4 py-2 text-gray-300">{c.xp}</td>
									</tr>
								{/each}
								{#if auCharacters.length === 0}
									<tr><td colspan="2" class="px-4 py-6 text-center text-gray-500">Nenhum personagem no /registro-au.</td></tr>
								{/if}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		</section>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<section class="space-y-3">
				<h2 class="text-sm font-semibold text-white">Posts com {tagsLabel}</h2>
				<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
								<th class="px-4 py-3">Tópico</th>
								<th class="px-4 py-3">Tag</th>
								<th class="px-4 py-3">XP</th>
								<th class="px-4 py-3">Quando</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-800">
							{#each awards as a (a.post_id)}
								<tr>
									<td class="px-4 py-2">
										<a href={threadHref(a)} class="text-indigo-400 hover:text-indigo-300">{a.thread_title}</a>
									</td>
									<td class="px-4 py-2 whitespace-nowrap">
										{#if a.tags?.length}
											{#each a.tags as t (t)}
												<span class="mr-1 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-amber-300">#{t}</span>
											{/each}
										{:else}
											<span class="text-gray-600">—</span>
										{/if}
									</td>
									<td class="px-4 py-2 text-emerald-400">+{a.xp_awarded}</td>
									<td class="px-4 py-2 text-gray-500">{fmtDate(a.created_at)}</td>
								</tr>
							{/each}
							{#if awards.length === 0}
								<tr>
									<td colspan="4" class="px-4 py-6 text-center text-gray-500">Nenhum post com {tagsLabel} ainda.</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			</section>

			<section class="space-y-3">
				<h2 class="text-sm font-semibold text-white">Distribuições</h2>
				<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
								<th class="px-4 py-3">Personagem</th>
								<th class="px-4 py-3">XP</th>
								<th class="px-4 py-3">Quando</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-800">
							{#each distributions as d (d.id)}
								<tr>
									<td class="px-4 py-2 text-white">
										{d.character_name ?? 'personagem removido'}
										{#if d.is_au}<span class="ml-1 text-[10px] text-violet-300">AU</span>{/if}
									</td>
									<td class="px-4 py-2 text-gray-300">−{d.xp}</td>
									<td class="px-4 py-2 text-gray-500">{fmtDate(d.created_at)}</td>
								</tr>
							{/each}
							{#if distributions.length === 0}
								<tr>
									<td colspan="3" class="px-4 py-6 text-center text-gray-500">Nada distribuído ainda.</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	{/if}
</div>
