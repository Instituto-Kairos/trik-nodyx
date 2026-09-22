<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface Character {
		id: string;
		name: string;
		pronouns: string | null;
		birth_date: string | null;
		faceclaim_name: string | null;
		faceclaim_birth_date: string | null;
		ficha_link: string;
		pantheon: string | null;
		divine_bond: string | null;
		divine_gift: string | null;
		conduct_presenca: number;
		conduct_proposito: number;
		conduct_sangue: number;
		principles_mente: number;
		principles_coracao: number;
		principles_corpo: number;
		template_name: string | null;
		template_signature: string | null;
		created_at: string;
		last_active_at: string;
		level: number;
		progress_xp: number;
		goal_xp: number | null;
	}

	interface Player {
		id: string;
		username: string;
		name: string;
		pronouns: string | null;
		birth_date: string | null;
		permit_active: boolean;
		created_at: string;
		characters: Character[];
	}

	// Uma linha por personagem; jogador sem personagem ainda aparece (character = null).
	interface Row {
		key: string;
		player: Player;
		character: Character | null;
	}

	const players = $derived((data.players ?? []) as Player[]);
	const rows = $derived(
		players.flatMap((player): Row[] =>
			player.characters.length
				? player.characters.map((character) => ({ key: character.id, player, character }))
				: [{ key: `player-${player.id}`, player, character: null }]
		)
	);

	// Busca sem acento/caixa nos campos que o admin costuma procurar.
	function norm(s: string | null | undefined): string {
		return (s ?? '')
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase();
	}

	let query = $state('');
	const filtered = $derived.by(() => {
		const q = norm(query.trim());
		if (!q) return rows;
		return rows.filter(({ player, character }) =>
			[player.name, player.username, character?.name, character?.faceclaim_name, character?.pantheon]
				.map(norm)
				.some((field) => field.includes(q))
		);
	});

	let expanded = $state<string | null>(null);
	const toggle = (key: string) => (expanded = expanded === key ? null : key);

	// DATE vem como 'YYYY-MM-DD' (texto): formata na mão pra não passar por Date e deslocar o dia.
	function fmtDate(d: string | null): string {
		if (!d) return '—';
		const [y, m, day] = d.slice(0, 10).split('-');
		return `${day}/${m}/${y}`;
	}
	function fmtDateTime(iso: string): string {
		return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
	}

	const CONDUCT = [
		['Presença', 'conduct_presenca'],
		['Propósito', 'conduct_proposito'],
		['Sangue', 'conduct_sangue']
	] as const;
	const PRINCIPLES = [
		['Mente', 'principles_mente'],
		['Coração', 'principles_coracao'],
		['Corpo', 'principles_corpo']
	] as const;

	const hasPlaquinha = (c: Character) => !!c.template_name && !!c.template_signature;

	// O link da ficha é digitado pelo jogador: só http(s) vira <a href> (o backend já
	// recusa outros esquemas, mas dado antigo ou vindo de outro caminho não passa daqui).
	const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);
</script>

<svelte:head><title>RPG — Registros</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Registros</h1>
		<p class="text-sm text-gray-500">
			Jogadores e personagens gravados por <code class="text-gray-400">/registro</code>, com a plaquinha
			de <code class="text-gray-400">/plaquinha</code> e o nível atual. Só leitura — clique numa linha
			para ver os detalhes.
		</p>
	</div>

	{#if data.failed}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			Não foi possível carregar os registros.
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-3">
		<input
			type="search"
			bind:value={query}
			placeholder="Buscar por jogador, personagem, faceclaim ou panteão…"
			autocomplete="off"
			class="w-96 max-w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
		/>
		<span class="text-xs text-gray-500">
			{players.length} jogador(es) · {players.reduce((n, p) => n + p.characters.length, 0)} personagem(ns)
			{#if query.trim()}· {filtered.length} na busca{/if}
		</span>
	</div>

	<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
					<th class="px-4 py-3">Personagem</th>
					<th class="px-4 py-3">Jogador</th>
					<th class="px-4 py-3">Panteão</th>
					<th class="px-4 py-3">Nível · XP</th>
					<th class="px-4 py-3">Plaquinha</th>
					<th class="px-4 py-3">Registrado em</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-800">
				{#each filtered as { key, player, character } (key)}
					<tr class="hover:bg-gray-800/40">
						<td class="px-4 py-2">
							<button
								type="button"
								onclick={() => toggle(key)}
								aria-expanded={expanded === key}
								class="text-left text-white hover:text-indigo-300 transition-colors"
							>
								<span class="text-gray-500 mr-1">{expanded === key ? '▾' : '▸'}</span>
								{character?.name ?? '— sem personagem —'}
							</button>
						</td>
						<td class="px-4 py-2 text-gray-300">
							{player.name} <span class="text-gray-600">@{player.username}</span>
						</td>
						<td class="px-4 py-2 text-gray-400">{character?.pantheon ?? '—'}</td>
						<td class="px-4 py-2 text-gray-300">
							{#if character}
								Nível {character.level}
								<span class="text-gray-500">
									· {character.progress_xp}{character.goal_xp !== null ? ` / ${character.goal_xp}` : ''} XP
									{#if character.goal_xp === null}(nível máx.){/if}
								</span>
							{:else}
								—
							{/if}
						</td>
						<td class="px-4 py-2">
							{#if character && hasPlaquinha(character)}
								<span class="text-emerald-400">✔ registrada</span>
							{:else}
								<span class="text-gray-600">—</span>
							{/if}
						</td>
						<td class="px-4 py-2 text-gray-500">
							{fmtDateTime(character?.created_at ?? player.created_at)}
						</td>
					</tr>

					{#if expanded === key}
						<tr class="bg-gray-900/70">
							<td colspan="6" class="px-6 py-4">
								<div class="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
									<dl class="space-y-1">
										<dt class="font-bold uppercase tracking-widest text-gray-500 text-[10px]">Jogador</dt>
										<dd class="text-gray-300">{player.name} <span class="text-gray-600">@{player.username}</span></dd>
										<dd class="text-gray-400">Pronomes: {player.pronouns ?? '—'}</dd>
										<dd class="text-gray-400">Nascimento: {fmtDate(player.birth_date)}</dd>
										<dd class="text-gray-400">Autorização: {player.permit_active ? 'ativa' : 'inativa'}</dd>
									</dl>

									{#if character}
										<dl class="space-y-1">
											<dt class="font-bold uppercase tracking-widest text-gray-500 text-[10px]">Personagem</dt>
											<dd class="text-gray-300">{character.name}</dd>
											<dd class="text-gray-400">Pronomes: {character.pronouns ?? '—'}</dd>
											<dd class="text-gray-400">Nascimento: {fmtDate(character.birth_date)}</dd>
											<dd class="text-gray-400">
												Faceclaim: {character.faceclaim_name ?? '—'}
												{#if character.faceclaim_birth_date}({fmtDate(character.faceclaim_birth_date)}){/if}
											</dd>
											<dd class="text-gray-400">
												Ficha:
												{#if isHttpUrl(character.ficha_link)}
													<a
														href={character.ficha_link}
														target="_blank"
														rel="noopener noreferrer"
														class="text-indigo-400 hover:text-indigo-300 break-all"
													>abrir ↗</a>
												{:else}
													<span class="text-red-400" title={character.ficha_link}>link inválido (não é http/https)</span>
												{/if}
											</dd>
											<dd class="text-gray-500">Última atividade: {fmtDateTime(character.last_active_at)}</dd>
										</dl>

										<dl class="space-y-1">
											<dt class="font-bold uppercase tracking-widest text-gray-500 text-[10px]">Divindade</dt>
											<dd class="text-gray-400">Panteão: {character.pantheon ?? '—'}</dd>
											<dd class="text-gray-400">Vínculo: {character.divine_bond ?? '—'}</dd>
											<dd class="text-gray-400">Dádiva: {character.divine_gift ?? '—'}</dd>
										</dl>

										<dl class="space-y-1">
											<dt class="font-bold uppercase tracking-widest text-gray-500 text-[10px]">Conduta</dt>
											{#each CONDUCT as [label, field]}
												<dd class="text-gray-400">{label}: <span class="text-gray-200">{character[field]}</span></dd>
											{/each}
										</dl>

										<dl class="space-y-1">
											<dt class="font-bold uppercase tracking-widest text-gray-500 text-[10px]">Princípios</dt>
											{#each PRINCIPLES as [label, field]}
												<dd class="text-gray-400">{label}: <span class="text-gray-200">{character[field]}</span></dd>
											{/each}
										</dl>

										<dl class="space-y-1">
											<dt class="font-bold uppercase tracking-widest text-gray-500 text-[10px]">Plaquinha</dt>
											{#if hasPlaquinha(character)}
												<dd class="text-gray-300 break-words">{character.template_name}</dd>
												<dd class="text-gray-400 break-words" dir="auto">{character.template_signature}</dd>
											{:else}
												<dd class="text-gray-600">Ainda não registrada.</dd>
											{/if}
										</dl>
									{/if}
								</div>
							</td>
						</tr>
					{/if}
				{/each}

				{#if filtered.length === 0}
					<tr>
						<td colspan="6" class="px-4 py-6 text-center text-gray-500">
							{rows.length === 0 ? 'Nenhum registro ainda.' : 'Nada encontrado para essa busca.'}
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>
