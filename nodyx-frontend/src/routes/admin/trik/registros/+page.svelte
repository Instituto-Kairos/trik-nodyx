<script lang="ts">
	import { enhance } from '$app/forms';
	import DateInput from '$lib/components/DateInput.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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
		pantheon_id: string | null;
		divine_bond_id: string | null;
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

	interface Pantheon {
		id: string;
		name: string;
		deities: { id: string; name: string }[];
	}

	const players = $derived((data.players ?? []) as Player[]);
	const pantheons = $derived((data.pantheons ?? []) as Pantheon[]);

	// O payload vem aninhado (jogador → personagens), mas a tabela de
	// personagens é plana: cada linha carrega o jogador ao lado só para exibir
	// e filtrar. Sem isto a tela voltaria a misturar as duas entidades.
	const characters = $derived(
		players.flatMap((player) => player.characters.map((character) => ({ player, character })))
	);

	// Busca sem acento/caixa nos campos que o admin costuma procurar. A mesma
	// caixa filtra as duas tabelas: digitar o @ de um jogador deixa a tabela de
	// cima com ele e a de baixo com os personagens dele.
	function norm(s: string | null | undefined): string {
		return (s ?? '')
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase();
	}

	let query = $state('');
	const term = $derived(norm(query.trim()));
	const matches = (...fields: (string | null | undefined)[]) =>
		!term || fields.map(norm).some((f) => f.includes(term));

	const filteredPlayers = $derived(players.filter((p) => matches(p.name, p.username)));
	const filteredCharacters = $derived(
		characters.filter(({ player, character }) =>
			matches(character.name, character.faceclaim_name, character.pantheon, player.name, player.username)
		)
	);

	// Chaves prefixadas: as duas tabelas compartilham `expanded`/`editing`, e
	// um id de jogador nunca deve abrir a linha de um personagem.
	const pk = (id: string) => `p:${id}`;
	const ck = (id: string) => `c:${id}`;

	let expanded = $state<string | null>(null);
	const toggle = (key: string) => (expanded = expanded === key ? null : key);

	// Edição e detalhe ocupam a mesma linha extra: abrir um fecha o outro.
	let editing = $state<string | null>(null);
	function startEdit(key: string) {
		expanded = null;
		editing = key;
	}

	// Panteão/vínculo no "Editar" usam os dropdowns do catálogo, como o modal de
	// /registro. Registro antigo de texto livre (sem id no catálogo) aparece como
	// a opção LEGACY: deixá-la selecionada = não mexer. Só um formulário fica
	// aberto por vez, então um estado só basta.
	const LEGACY = '__legacy';
	let initialPantheon = $state('');
	let initialDeity = $state('');
	let editPantheon = $state('');
	let editDeity = $state('');
	const editDeities = $derived(pantheons.find((p) => p.id === editPantheon)?.deities ?? []);
	const divineChanged = $derived(editPantheon !== initialPantheon || editDeity !== initialDeity);

	function startEditCharacter(c: Character) {
		initialPantheon = editPantheon = c.pantheon_id ?? (c.pantheon ? LEGACY : '');
		initialDeity = editDeity = c.divine_bond_id ?? (c.divine_bond ? LEGACY : '');
		startEdit(ck(c.id));
	}
	function onPantheonChange() {
		editDeity = editPantheon === initialPantheon ? initialDeity : '';
	}

	// `update()` reaplica o resultado e recarrega o load, então a linha e o
	// Passe voltam já com o valor gravado. Só fecha o formulário se deu certo:
	// senão o erro apareceria com o formulário fechado e o que foi digitado
	// sumiria da tela.
	const onSave = () => async ({ update, result }: any) => {
		await update();
		if (result.type === 'success') editing = null;
	};

	// Exclusão não tem volta (progresso e XP saem junto no banco), então pede
	// confirmação nomeando o personagem antes de mandar o form.
	function confirmDelete(e: SubmitEvent, name: string) {
		const ok = confirm(
			`Excluir o personagem "${name}"?

Isso apaga também o nível, o XP, as maestrias e os bônus dele. Não dá para desfazer.`
		);
		if (!ok) e.preventDefault();
	}

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

<!-- Um campo do formulário de edição. Objeto único como parâmetro para não
     depender de ordem posicional com 5 argumentos. -->
{#snippet field(f: { label: string; name: string; value: string | null; type?: string; required?: boolean })}
	<label class="block">
		<span class="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{f.label}</span>
		{#if f.type === 'date'}
			<!-- Não é <input type="date">: o nativo segue o idioma do navegador
			     (mm/dd/yyyy num Chrome em inglês). DateInput é sempre dd/mm/aaaa
			     e manda AAAA-MM-DD no POST, pelo input escondido com `name`. -->
			<DateInput
				name={f.name}
				value={f.value ?? ''}
				required={f.required ?? false}
				placeholder="dd/mm/aaaa"
				class="w-full rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white placeholder-gray-600"
			/>
		{:else}
			<input
				name={f.name}
				type={f.type ?? 'text'}
				required={f.required ?? false}
				value={f.value ?? ''}
				autocomplete="off"
				class="w-full rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white placeholder-gray-600"
			/>
		{/if}
	</label>
{/snippet}

{#snippet selectLabel(text: string)}
	<span class="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{text}</span>
{/snippet}

{#snippet rowActions(key: string, onEdit: () => void = () => startEdit(key))}
	<button
		type="button"
		onclick={onEdit}
		class="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-300 hover:border-indigo-500 hover:text-indigo-300 transition-colors"
	>Editar</button>
{/snippet}

{#snippet formButtons()}
	<div class="flex items-center gap-2 pt-1">
		<button
			type="submit"
			class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
		>Salvar</button>
		<button
			type="button"
			onclick={() => (editing = null)}
			class="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
		>Cancelar</button>
	</div>
{/snippet}

{#snippet sectionTitle(title: string, shown: number, total: number, unit: string)}
	<div class="flex items-baseline gap-3">
		<h2 class="text-lg font-bold text-white">{title}</h2>
		<span class="text-xs text-gray-500">
			{#if term && shown !== total}{shown} de {total} {unit}{:else}{total} {unit}{/if}
		</span>
	</div>
{/snippet}

<div class="space-y-8">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Registros</h1>
		<p class="text-sm text-gray-500">
			O que o <code class="text-gray-400">/registro</code> e o <code class="text-gray-400">/plaquinha</code>
			gravaram, em duas tabelas: jogadores (identidade OOC, uma linha por pessoa) e personagens
			(uma linha cada, com a plaquinha e o nível). Clique numa linha para ver os detalhes, em
			<strong class="text-gray-400">Editar</strong> para corrigir ou em
			<strong class="text-gray-400">Excluir</strong> para apagar um personagem. Conduta, Princípios, plaquinha e XP
			não se editam aqui: são resultado do <code class="text-gray-400">/levelup</code> e do
			<code class="text-gray-400">/plaquinha</code>, que têm orçamento de pontos próprio.
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{:else if form && 'deleted' in form}
		<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300">
			Personagem “{form.deleted}” excluído.
		</div>
	{:else if form?.saved}
		<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300">
			{form.saved === 'personagem' ? 'Personagem atualizado.' : 'Jogador atualizado.'}
		</div>
	{/if}

	{#if data.failed}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			Não foi possível carregar os registros.
		</div>
	{/if}

	<input
		type="search"
		bind:value={query}
		placeholder="Buscar por jogador, personagem, faceclaim ou panteão…"
		autocomplete="off"
		class="w-96 max-w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600"
	/>

	<!-- ── Jogadores ─────────────────────────────────────────────────────── -->
	<section class="space-y-3">
		{@render sectionTitle('Jogadores', filteredPlayers.length, players.length, 'jogador(es)')}

		<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-800">
						<th class="px-4 py-3">Jogador</th>
						<th class="px-4 py-3">Pronomes</th>
						<th class="px-4 py-3">Nascimento</th>
						<th class="px-4 py-3">Personagens</th>
						<th class="px-4 py-3">Registrado em</th>
						<th class="px-4 py-3">Passe</th>
						<th class="px-4 py-3 text-right">Ações</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800">
					{#each filteredPlayers as player (player.id)}
						{@const key = pk(player.id)}
						<tr class="hover:bg-gray-800/40">
							<td class="px-4 py-2">
								<button
									type="button"
									onclick={() => toggle(key)}
									aria-expanded={expanded === key}
									class="text-left text-white hover:text-indigo-300 transition-colors"
								>
									<span class="text-gray-500 mr-1">{expanded === key ? '▾' : '▸'}</span>
									{player.name} <span class="text-gray-600">@{player.username}</span>
								</button>
							</td>
							<td class="px-4 py-2 text-gray-400">{player.pronouns ?? '—'}</td>
							<td class="px-4 py-2 text-gray-400">{fmtDate(player.birth_date)}</td>
							<td class="px-4 py-2">
								{#if player.characters.length}
									<!-- Atalho para a tabela de baixo: é o que substitui a coluna
									     "Jogador" repetida que existia quando era tudo uma tabela só. -->
									<button
										type="button"
										onclick={() => (query = player.username)}
										title="Filtrar os personagens de {player.name}"
										class="text-indigo-400 hover:text-indigo-300 transition-colors"
									>{player.characters.length} ↓</button>
								{:else}
									<span class="text-gray-600">nenhum</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-gray-500">{fmtDateTime(player.created_at)}</td>
							<td class="px-4 py-2">
								<form method="POST" action="?/togglePermit" use:enhance>
									<input type="hidden" name="playerId" value={player.id} />
									<input type="hidden" name="active" value={player.permit_active ? '0' : '1'} />
									<button
										type="submit"
										title="Clique para {player.permit_active ? 'desativar' : 'ativar'} o passe de {player.name}"
										class="rounded-lg border px-2.5 py-1 text-xs transition-colors {player.permit_active
											? 'border-emerald-700 bg-emerald-900/30 text-emerald-300 hover:border-emerald-500'
											: 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'}"
									>{player.permit_active ? 'ativo' : 'inativo'}</button>
								</form>
							</td>
							<td class="px-4 py-2">
								<div class="flex justify-end">{@render rowActions(key)}</div>
							</td>
						</tr>

						{#if editing === key}
							<tr class="bg-gray-900/70">
								<td colspan="7" class="px-6 py-4">
									<form method="POST" action="?/savePlayer" use:enhance={onSave} class="space-y-4">
										<input type="hidden" name="playerId" value={player.id} />
										<div class="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
											{@render field({ label: 'Nome', name: 'name', value: player.name, required: true })}
											{@render field({ label: 'Pronomes', name: 'pronouns', value: player.pronouns })}
											{@render field({ label: 'Nascimento', name: 'birthDate', value: player.birth_date, type: 'date' })}
										</div>
										{@render formButtons()}
									</form>
								</td>
							</tr>
						{:else if expanded === key}
							<tr class="bg-gray-900/70">
								<td colspan="7" class="px-6 py-4 text-xs">
									<dl class="space-y-1">
										<dt class="font-bold uppercase tracking-widest text-gray-500 text-[10px]">Jogador</dt>
										<dd class="text-gray-300">{player.name} <span class="text-gray-600">@{player.username}</span></dd>
										<dd class="text-gray-400">Pronomes: {player.pronouns ?? '—'}</dd>
										<dd class="text-gray-400">Nascimento: {fmtDate(player.birth_date)}</dd>
										<dd class="text-gray-400">Passe: {player.permit_active ? 'ativo' : 'inativo'}</dd>
										<dd class="text-gray-500">
											Personagens: {player.characters.map((c) => c.name).join(', ') || '—'}
										</dd>
									</dl>
								</td>
							</tr>
						{/if}
					{/each}

					{#if filteredPlayers.length === 0}
						<tr>
							<td colspan="7" class="px-4 py-6 text-center text-gray-500">
								{players.length === 0 ? 'Nenhum jogador ainda.' : 'Nada encontrado para essa busca.'}
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</section>

	<!-- ── Personagens ───────────────────────────────────────────────────── -->
	<section class="space-y-3">
		{@render sectionTitle('Personagens', filteredCharacters.length, characters.length, 'personagem(ns)')}

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
						<th class="px-4 py-3 text-right">Ações</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800">
					{#each filteredCharacters as { player, character } (character.id)}
						{@const key = ck(character.id)}
						<tr class="hover:bg-gray-800/40">
							<td class="px-4 py-2">
								<button
									type="button"
									onclick={() => toggle(key)}
									aria-expanded={expanded === key}
									class="text-left text-white hover:text-indigo-300 transition-colors"
								>
									<span class="text-gray-500 mr-1">{expanded === key ? '▾' : '▸'}</span>
									{character.name}
								</button>
							</td>
							<td class="px-4 py-2">
								<button
									type="button"
									onclick={() => (query = player.username)}
									title="Filtrar por {player.name}"
									class="text-gray-300 hover:text-indigo-300 transition-colors"
								>{player.name} <span class="text-gray-600">@{player.username}</span></button>
							</td>
							<td class="px-4 py-2 text-gray-400">{character.pantheon ?? '—'}</td>
							<td class="px-4 py-2 text-gray-300">
								Nível {character.level}
								<span class="text-gray-500">
									· {character.progress_xp}{character.goal_xp !== null ? ` / ${character.goal_xp}` : ''} XP
									{#if character.goal_xp === null}(nível máx.){/if}
								</span>
							</td>
							<td class="px-4 py-2">
								{#if hasPlaquinha(character)}
									<span class="text-emerald-400">✔ registrada</span>
								{:else}
									<span class="text-gray-600">—</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-gray-500">{fmtDateTime(character.created_at)}</td>
							<td class="px-4 py-2">
								<div class="flex justify-end gap-2">
									{@render rowActions(key, () => startEditCharacter(character))}
									<form
										method="POST"
										action="?/deleteCharacter"
										use:enhance
										onsubmit={(e) => confirmDelete(e, character.name)}
									>
										<input type="hidden" name="characterId" value={character.id} />
										<input type="hidden" name="name" value={character.name} />
										<button
											type="submit"
											class="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:border-red-600 hover:text-red-400 transition-colors"
										>Excluir</button>
									</form>
								</div>
							</td>
						</tr>

						{#if editing === key}
							<tr class="bg-gray-900/70">
								<td colspan="7" class="px-6 py-4">
									<form method="POST" action="?/saveCharacter" use:enhance={onSave} class="space-y-4">
										<input type="hidden" name="characterId" value={character.id} />
										<div class="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
											{@render field({ label: 'Nome', name: 'name', value: character.name, required: true })}
											{@render field({ label: 'Pronomes', name: 'pronouns', value: character.pronouns })}
											{@render field({ label: 'Nascimento', name: 'birthDate', value: character.birth_date, type: 'date' })}
											{@render field({ label: 'Faceclaim', name: 'faceclaimName', value: character.faceclaim_name })}
											{@render field({ label: 'Faceclaim — nascimento', name: 'faceclaimBirthDate', value: character.faceclaim_birth_date, type: 'date' })}
											{@render field({ label: 'Ficha (link)', name: 'fichaLink', value: character.ficha_link, type: 'url', required: true })}
											<!-- Valores pelos hidden: select desabilitado não entra no POST. -->
											<input type="hidden" name="divineChanged" value={divineChanged ? '1' : '0'} />
											<input type="hidden" name="pantheonId" value={editPantheon} />
											<input type="hidden" name="divineBondId" value={editDeity} />
											<label class="block">
												{@render selectLabel('Panteão')}
												<select
													bind:value={editPantheon}
													onchange={onPantheonChange}
													class="w-full rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white"
												>
													{#if initialPantheon === LEGACY}
														<option value={LEGACY}>{character.pantheon} (texto antigo)</option>
													{/if}
													<option value="">— nenhum —</option>
													{#each pantheons as p (p.id)}
														<option value={p.id}>{p.name}</option>
													{/each}
												</select>
											</label>
											<label class="block">
												{@render selectLabel('Vínculo divino')}
												<select
													bind:value={editDeity}
													disabled={editPantheon === '' || editPantheon === LEGACY}
													class="w-full rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white disabled:opacity-50"
												>
													{#if initialDeity === LEGACY && editPantheon === initialPantheon}
														<option value={LEGACY}>{character.divine_bond} (texto antigo)</option>
													{/if}
													<option value="">— nenhum —</option>
													{#each editDeities as d (d.id)}
														<option value={d.id}>{d.name}</option>
													{/each}
												</select>
											</label>
											{@render field({ label: 'Presente Divino', name: 'divineGift', value: character.divine_gift })}
										</div>
										{@render formButtons()}
									</form>
								</td>
							</tr>
						{:else if expanded === key}
							<tr class="bg-gray-900/70">
								<td colspan="7" class="px-6 py-4">
									<div class="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
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
											{#each CONDUCT as [label, campo]}
												<dd class="text-gray-400">{label}: <span class="text-gray-200">{character[campo]}</span></dd>
											{/each}
										</dl>

										<dl class="space-y-1">
											<dt class="font-bold uppercase tracking-widest text-gray-500 text-[10px]">Princípios</dt>
											{#each PRINCIPLES as [label, campo]}
												<dd class="text-gray-400">{label}: <span class="text-gray-200">{character[campo]}</span></dd>
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
									</div>
								</td>
							</tr>
						{/if}
					{/each}

					{#if filteredCharacters.length === 0}
						<tr>
							<td colspan="7" class="px-4 py-6 text-center text-gray-500">
								{characters.length === 0 ? 'Nenhum personagem ainda.' : 'Nada encontrado para essa busca.'}
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</section>
</div>
