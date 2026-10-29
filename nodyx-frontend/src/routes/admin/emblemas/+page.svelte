<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Badge = { id: string; name: string; file_path: string; thumbnail_path: string | null };
	type Member = {
		user_id: string;
		username: string;
		display_name: string | null;
		avatar: string | null;
		badge_asset_id: string | null;
	};

	const badges = $derived(data.badges as Badge[]);
	const members = $derived(data.members as Member[]);
	const badgeById = $derived(new Map(badges.map((b) => [b.id, b])));

	let search = $state('');
	let onlyWithBadge = $state(false);

	const filtered = $derived(
		members.filter((m) => {
			if (onlyWithBadge && !m.badge_asset_id) return false;
			const q = search.trim().toLowerCase();
			if (!q) return true;
			return m.username.toLowerCase().includes(q) || (m.display_name ?? '').toLowerCase().includes(q);
		})
	);

	let saving = $state<string | null>(null);

	function badgeSrc(b: Badge) {
		return `/uploads/${b.thumbnail_path ?? b.file_path}`;
	}
</script>

<svelte:head><title>Admin: Emblemas</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-xl font-bold text-white">Emblemas</h1>
		<p class="text-sm text-gray-400 mt-0.5">
			Emblemas aparecem ao lado do nome no perfil. Só o admin dá: o membro não equipa sozinho.
		</p>
	</div>

	<!-- Emblemas disponíveis -->
	<section class="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
		<div class="flex items-center justify-between gap-3 mb-3">
			<h2 class="text-sm font-semibold text-gray-300">Disponíveis ({badges.length})</h2>
			<a href="/library?type=badge" target="_blank" class="text-xs text-indigo-400 hover:underline">
				Subir emblema nos assets →
			</a>
		</div>
		{#if badges.length === 0}
			<p class="text-sm text-gray-500">
				Nenhum emblema ainda. Suba um nos assets escolhendo o tipo "Emblemas".
			</p>
		{:else}
			<div class="flex flex-wrap gap-3">
				{#each badges as b (b.id)}
					<div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/60">
						<img src={badgeSrc(b)} alt={b.name} class="w-6 h-6 object-contain" />
						<span class="text-xs text-gray-300">{b.name}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Membros -->
	<section class="space-y-3">
		<div class="flex flex-wrap items-center gap-3">
			<input
				type="search"
				bind:value={search}
				placeholder="Buscar membro…"
				class="flex-1 min-w-0 sm:max-w-xs px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
			/>
			<label class="flex items-center gap-2 text-sm text-gray-400">
				<input type="checkbox" bind:checked={onlyWithBadge} class="accent-indigo-500" />
				Só quem tem emblema
			</label>
		</div>

		{#if filtered.length === 0}
			<p class="text-sm text-gray-500">Nenhum membro encontrado.</p>
		{:else}
			<div class="rounded-xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
				{#each filtered as m (m.user_id)}
					{@const current = m.badge_asset_id ? badgeById.get(m.badge_asset_id) : null}
					<form
						method="POST"
						action="?/give"
						class="flex flex-wrap items-center gap-3 px-4 py-3 bg-gray-900/40"
						use:enhance={() => {
							saving = m.user_id;
							return async ({ update }) => {
								await update({ reset: false });
								saving = null;
							};
						}}
					>
						<input type="hidden" name="user_id" value={m.user_id} />

						<div class="flex items-center gap-3 flex-1 min-w-[10rem]">
							{#if m.avatar}
								<img src={m.avatar} alt="" class="w-8 h-8 rounded-full object-cover" />
							{:else}
								<div class="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-xs text-gray-400">
									{m.username.slice(0, 1).toUpperCase()}
								</div>
							{/if}
							<div class="min-w-0">
								<a href="/users/{m.username}" target="_blank" class="block text-sm text-white hover:text-indigo-300 truncate">
									{m.display_name ?? m.username}
								</a>
								<p class="text-xs text-gray-500 truncate">@{m.username}</p>
							</div>
							{#if current}
								<img src={badgeSrc(current)} alt={current.name} title={current.name} class="w-5 h-5 object-contain" />
							{/if}
						</div>

						<div class="flex items-center gap-2 w-full sm:w-auto">
							<select
								name="badge_asset_id"
								value={m.badge_asset_id ?? ''}
								class="flex-1 sm:w-48 px-2 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:border-indigo-500"
							>
								<option value="">Sem emblema</option>
								{#each badges as b (b.id)}
									<option value={b.id}>{b.name}</option>
								{/each}
							</select>
							<button
								type="submit"
								disabled={saving === m.user_id}
								class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
							>
								{saving === m.user_id ? '…' : 'Salvar'}
							</button>
						</div>

						{#if form?.userId === m.user_id}
							<p class="w-full text-xs {form?.ok ? 'text-green-400' : 'text-red-400'}">
								{form?.ok ? 'Salvo.' : form?.error}
							</p>
						{/if}
					</form>
				{/each}
			</div>
		{/if}
	</section>
</div>
