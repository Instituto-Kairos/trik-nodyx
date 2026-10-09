<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	interface Balance {
		earned: number;
		distributed: number;
		available: number;
	}

	interface Character {
		id: string;
		name: string;
		level: number;
		progress_xp: number;
		goal_xp: number | null;
	}

	interface Award {
		post_id: string;
		xp_awarded: number;
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
	}

	interface Narrador {
		narrator: { userId: string; username: string } | null;
		username?: string;
		balance?: Balance;
		characters?: Character[];
		awards?: Award[];
		distributions?: Distribution[];
	}

	const narrador = $derived(data.narrador as Narrador | null);
	const balance = $derived(narrador?.balance ?? { earned: 0, distributed: 0, available: 0 });
	const characters = $derived(narrador?.characters ?? []);
	const awards = $derived(narrador?.awards ?? []);
	const distributions = $derived(narrador?.distributions ?? []);

	let characterId = $state('');
	let xp = $state<number | null>(null);
	const canSubmit = $derived(
		!!characterId && !!xp && Number.isInteger(xp) && xp > 0 && xp <= balance.available
	);

	const threadHref = (a: Award) =>
		`/forum/${a.category_slug ?? a.category_id}/${a.thread_slug ?? a.thread_id}`;
	const fmtDate = (iso: string) =>
		new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
</script>

<svelte:head><title>RPG — Narrador</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Narrador</h1>
		<p class="text-sm text-gray-500">
			Post do narrador com <code class="text-gray-300">#lore</code> num tópico que vale XP rende 15 XP a
			cada 500 caracteres (proporcional, mínimo de 500). Esse XP não vai pra personagem nenhum: fica
			acumulado aqui e pode ser distribuído entre os personagens do narrador. Editar ou apagar o post
			desfaz o prêmio.
		</p>
	</div>

	{#if data.loadError}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			Não foi possível carregar os dados do narrador.
		</div>
	{:else if !narrador?.narrator}
		<div class="rounded-lg border border-amber-800 bg-amber-900/30 px-4 py-3 text-sm text-amber-300">
			A conta do narrador (@{narrador?.username ?? 'oorpheas'}) não existe nesta instância.
		</div>
	{:else}
		{#if form?.error}
			<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
				{form.error}
			</div>
		{/if}
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
				<div class="text-[10px] font-bold uppercase tracking-widest text-gray-500">Ganho com #lore</div>
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
				distribuído. Os próximos posts com #lore pagam essa diferença primeiro.
			</p>
		{/if}

		<section class="space-y-3">
			<h2 class="text-sm font-semibold text-white">Distribuir XP</h2>
			{#if characters.length === 0}
				<p class="text-sm text-gray-500">
					@{narrador.narrator.username} ainda não tem personagens registrados.
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
					<div class="space-y-1">
						<label for="characterId" class="block text-xs text-gray-500">Personagem</label>
						<select
							id="characterId"
							name="characterId"
							bind:value={characterId}
							class="w-64 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
						>
							<option value="" disabled>Escolha…</option>
							{#each characters as c (c.id)}
								<option value={c.id}>{c.name} (nível {c.level})</option>
							{/each}
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

				<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
								<th class="px-4 py-3">Personagem</th>
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
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<section class="space-y-3">
				<h2 class="text-sm font-semibold text-white">Posts com #lore</h2>
				<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
								<th class="px-4 py-3">Tópico</th>
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
									<td class="px-4 py-2 text-emerald-400">+{a.xp_awarded}</td>
									<td class="px-4 py-2 text-gray-500">{fmtDate(a.created_at)}</td>
								</tr>
							{/each}
							{#if awards.length === 0}
								<tr>
									<td colspan="3" class="px-4 py-6 text-center text-gray-500">Nenhum post com #lore ainda.</td>
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
