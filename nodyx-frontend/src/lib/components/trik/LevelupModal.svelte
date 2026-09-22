<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { portal } from '$lib/actions/portal';

	interface Props {
		token: string;
		channelId: string;
		onclose: () => void;
	}

	let { token, channelId, onclose }: Props = $props();

	type ConductKey = 'conductPresenca' | 'conductProposito' | 'conductSangue';
	type PrincipleKey = 'principlesMente' | 'principlesCoracao' | 'principlesCorpo';
	type Deltas = Record<ConductKey | PrincipleKey, number>;

	interface CatalogEntry {
		id: string;
		name: string;
	}

	interface CharacterState {
		character: { id: string; name: string };
		progress: { has_goal: boolean };
		bonuses: {
			first_preference_id: string | null;
			second_preference_id: string | null;
			goal_id: string | null;
		} | null;
		available: { conduct: number; principles: number; preferences: number };
	}

	const ZERO_DELTAS: Deltas = {
		conductPresenca: 0,
		conductProposito: 0,
		conductSangue: 0,
		principlesMente: 0,
		principlesCoracao: 0,
		principlesCorpo: 0
	};

	const CONDUCT_FIELDS: [ConductKey, string][] = [
		['conductPresenca', 'Presença'],
		['conductProposito', 'Propósito'],
		['conductSangue', 'Sangue']
	];
	const PRINCIPLE_FIELDS: [PrincipleKey, string][] = [
		['principlesMente', 'Mente'],
		['principlesCoracao', 'Coração'],
		['principlesCorpo', 'Corpo']
	];

	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let done = $state(false);

	let characters = $state<CharacterState[]>([]);
	let preferences = $state<CatalogEntry[]>([]);
	let goals = $state<CatalogEntry[]>([]);

	let selectedCharacterId = $state('');
	let deltas = $state<Deltas>({ ...ZERO_DELTAS });
	let preferenceId = $state('');
	let goalId = $state('');

	let selected = $derived(characters.find((c) => c.character.id === selectedCharacterId) ?? null);
	let conductSpent = $derived(deltas.conductPresenca + deltas.conductProposito + deltas.conductSangue);
	let principlesSpent = $derived(
		deltas.principlesMente + deltas.principlesCoracao + deltas.principlesCorpo
	);
	// Slots de preferência já preenchidos → não sobra onde escolher uma nova.
	let preferenceSlotsFull = $derived(
		!!selected?.bonuses?.first_preference_id && !!selected?.bonuses?.second_preference_id
	);
	let canPickGoal = $derived(!!selected?.progress.has_goal && !selected?.bonuses?.goal_id);

	function resetSelection() {
		deltas = { ...ZERO_DELTAS };
		preferenceId = '';
		goalId = '';
	}

	function selectCharacter(id: string) {
		selectedCharacterId = id;
		resetSelection();
	}

	function inc(key: ConductKey | PrincipleKey, pool: 'conduct' | 'principles') {
		if (!selected) return;
		const spent = pool === 'conduct' ? conductSpent : principlesSpent;
		const budget = pool === 'conduct' ? selected.available.conduct : selected.available.principles;
		if (spent >= budget) return;
		deltas = { ...deltas, [key]: deltas[key] + 1 };
	}

	function dec(key: ConductKey | PrincipleKey) {
		if (deltas[key] <= 0) return;
		deltas = { ...deltas, [key]: deltas[key] - 1 };
	}

	async function load() {
		loading = true;
		try {
			const res = await apiFetch(fetch, '/trik/levelup/state', {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (res.ok) {
				const data = await res.json();
				characters = data.characters ?? [];
				preferences = data.preferences ?? [];
				goals = data.goals ?? [];
				selectedCharacterId = characters[0]?.character.id ?? '';
			}
		} finally {
			loading = false;
		}
	}

	load();

	async function submit() {
		error = null;
		if (!selected) {
			error = 'Selecione um personagem';
			return;
		}
		if (conductSpent === 0 && principlesSpent === 0 && !preferenceId && !goalId) {
			error = 'Aloque algum ponto ou escolha uma preferência/objetivo antes de salvar';
			return;
		}
		saving = true;
		try {
			const res = await apiFetch(fetch, '/trik/levelup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					channelId,
					characterId: selected.character.id,
					deltas,
					preferenceId: preferenceId || undefined,
					goalId: goalId || undefined
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body.error ?? 'Erro ao salvar';
				return;
			}
			done = true;
		} catch {
			error = 'Erro de rede ao salvar';
		} finally {
			saving = false;
		}
	}

	function onOverlayKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<div
	use:portal
	class="fixed inset-0 z-[300] flex items-center justify-center p-4"
	style="background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);"
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	aria-label="Distribuir pontos de nível"
	onkeydown={onOverlayKeydown}
>
	<div class="absolute inset-0" role="presentation" onclick={onclose}></div>

	<div
		class="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl"
		style="background: #0a0a12; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 25px 60px rgba(0,0,0,0.6);"
	>
		<div
			class="flex items-center justify-between px-6 pt-6 pb-4"
			style="border-bottom: 1px solid rgba(255,255,255,0.05)"
		>
			<h2 class="text-sm font-bold text-white">Distribuir pontos de nível</h2>
			<button
				onclick={onclose}
				class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white transition-colors"
				aria-label="Fechar"
			>
				×
			</button>
		</div>

		<div class="px-6 py-5 space-y-5">
			{#if loading}
				<p class="text-sm text-gray-500">Carregando…</p>
			{:else if done}
				<p class="text-sm text-emerald-400">Pontos salvos com sucesso.</p>
				<button
					onclick={onclose}
					class="w-full py-2.5 rounded-xl font-semibold text-sm text-white"
					style="background: rgb(79,70,229);"
				>
					Fechar
				</button>
			{:else if characters.length === 0}
				<p class="text-sm text-gray-500">
					Nenhum dos seus personagens tem pontos disponíveis ou objetivo pra escolher agora.
				</p>
			{:else}
				{#if error}
					<div
						class="rounded-lg px-4 py-3 text-sm text-red-300"
						style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);"
					>
						{error}
					</div>
				{/if}

				<div>
					<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
						Selecione seu personagem
					</p>
					<select
						value={selectedCharacterId}
						onchange={(e) => selectCharacter(e.currentTarget.value)}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					>
						{#each characters as c (c.character.id)}
							<option value={c.character.id}>{c.character.name}</option>
						{/each}
					</select>
				</div>

				{#if selected}
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500">
								Conduta ({selected.available.conduct - conductSpent} disponíveis)
							</p>
							{#each CONDUCT_FIELDS as [key, label] (key)}
								<div class="flex items-center justify-between text-sm text-gray-300">
									<span>{label}</span>
									<div class="flex items-center gap-2">
										<button
											onclick={() => dec(key)}
											disabled={deltas[key] === 0}
											class="w-6 h-6 rounded-md bg-gray-800 border border-gray-700 text-white disabled:opacity-30"
										>
											−
										</button>
										<span class="w-4 text-center">{deltas[key]}</span>
										<button
											onclick={() => inc(key, 'conduct')}
											disabled={conductSpent >= selected.available.conduct}
											class="w-6 h-6 rounded-md bg-gray-800 border border-gray-700 text-white disabled:opacity-30"
										>
											+
										</button>
									</div>
								</div>
							{/each}
						</div>
						<div class="space-y-2">
							<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500">
								Princípios ({selected.available.principles - principlesSpent} disponíveis)
							</p>
							{#each PRINCIPLE_FIELDS as [key, label] (key)}
								<div class="flex items-center justify-between text-sm text-gray-300">
									<span>{label}</span>
									<div class="flex items-center gap-2">
										<button
											onclick={() => dec(key)}
											disabled={deltas[key] === 0}
											class="w-6 h-6 rounded-md bg-gray-800 border border-gray-700 text-white disabled:opacity-30"
										>
											−
										</button>
										<span class="w-4 text-center">{deltas[key]}</span>
										<button
											onclick={() => inc(key, 'principles')}
											disabled={principlesSpent >= selected.available.principles}
											class="w-6 h-6 rounded-md bg-gray-800 border border-gray-700 text-white disabled:opacity-30"
										>
											+
										</button>
									</div>
								</div>
							{/each}
						</div>
					</div>

					{#if selected.available.preferences > 0 && !preferenceSlotsFull}
						<div>
							<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
								Preferência ({selected.available.preferences} disponível)
							</p>
							<select
								bind:value={preferenceId}
								class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
							>
								<option value="">— Nenhuma por enquanto —</option>
								{#each preferences as p (p.id)}
									<option value={p.id}>{p.name}</option>
								{/each}
							</select>
						</div>
					{/if}

					{#if canPickGoal}
						<div>
							<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
								Objetivo
							</p>
							<select
								bind:value={goalId}
								class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
							>
								<option value="">— Nenhum por enquanto —</option>
								{#each goals as g (g.id)}
									<option value={g.id}>{g.name}</option>
								{/each}
							</select>
						</div>
					{/if}
				{/if}
			{/if}
		</div>

		{#if !loading && !done && characters.length > 0}
			<div class="px-6 pb-6">
				<button
					onclick={submit}
					disabled={saving}
					class="w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-all"
					style="background: {saving ? 'rgba(55,65,81,1)' : 'rgb(79,70,229)'};"
				>
					{saving ? 'Salvando…' : 'Salvar'}
				</button>
			</div>
		{/if}
	</div>
</div>
