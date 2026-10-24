<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { portal } from '$lib/actions/portal';

	// /interesse (Fase 3, trik_012): interesse primário (−2) e secundário (−1)
	// no requisito de uma categoria de arma ou matéria. O slot abre por nível;
	// depois de escolhido, troca uma vez por semana (domingo–sábado).

	interface Props {
		token: string;
		channelId: string;
		onclose: () => void;
	}

	let { token, channelId, onclose }: Props = $props();

	type Slot = 'primario' | 'secundario';
	type Kind = 'weapon' | 'knowledge';

	interface Interest {
		slot: Slot;
		kind: Kind;
		category: string;
		locked: boolean;
	}

	interface Entry {
		character: { id: string; name: string };
		unlocked: Record<Slot, boolean>;
		interests: Interest[];
	}

	const SLOTS: { value: Slot; label: string }[] = [
		{ value: 'primario', label: 'Interesse primário' },
		{ value: 'secundario', label: 'Interesse secundário' }
	];

	let loading = $state(true);
	let saving = $state<Slot | null>(null);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);
	let entries = $state<Entry[]>([]);
	let categories = $state<Record<Kind, string[]>>({ weapon: [], knowledge: [] });
	let reduction = $state<Record<Slot, number>>({ primario: 2, secundario: 1 });

	let selectedCharacterId = $state('');
	// Valor do select de cada slot: "weapon|Espadas" / "knowledge|Idiomas".
	let choice = $state<Record<Slot, string>>({ primario: '', secundario: '' });

	const selected = $derived(entries.find((e) => e.character.id === selectedCharacterId));
	const current = (slot: Slot) => selected?.interests.find((i) => i.slot === slot);

	function fillFromSelected() {
		for (const { value } of SLOTS) {
			const i = current(value);
			choice[value] = i ? `${i.kind}|${i.category}` : '';
		}
	}

	async function load() {
		loading = true;
		try {
			const res = await apiFetch(fetch, '/trik/interesses/state', {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (res.ok) {
				const data = await res.json();
				entries = data.characters ?? [];
				categories = data.categories ?? { weapon: [], knowledge: [] };
				if (data.reduction) reduction = data.reduction;
				if (!entries.some((e) => e.character.id === selectedCharacterId)) {
					selectedCharacterId = entries[0]?.character.id ?? '';
				}
				fillFromSelected();
			}
		} finally {
			loading = false;
		}
	}

	load();

	async function save(slot: Slot) {
		error = null;
		message = null;
		const [kind, ...rest] = choice[slot].split('|');
		const category = rest.join('|');
		if (!kind || !category) {
			error = 'Escolha uma categoria';
			return;
		}
		saving = slot;
		try {
			const res = await apiFetch(fetch, '/trik/interesse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ channelId, characterId: selectedCharacterId, slot, kind, category })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body.error ?? 'Erro ao salvar interesse';
				return;
			}
			message = 'Interesse salvo.';
			await load();
		} catch {
			error = 'Erro de rede ao salvar';
		} finally {
			saving = null;
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
	aria-label="Interesses"
	onkeydown={onOverlayKeydown}
>
	<div class="absolute inset-0" role="presentation" onclick={onclose}></div>

	<div
		class="relative w-full max-w-md rounded-2xl"
		style="background: #0a0a12; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 25px 60px rgba(0,0,0,0.6);"
	>
		<div
			class="flex items-center justify-between px-6 pt-6 pb-4"
			style="border-bottom: 1px solid rgba(255,255,255,0.05)"
		>
			<h2 class="text-sm font-bold text-white">Interesses</h2>
			<button
				onclick={onclose}
				class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white transition-colors"
				aria-label="Fechar"
			>
				×
			</button>
		</div>

		<div class="px-6 py-5 space-y-4">
			{#if loading && entries.length === 0}
				<p class="text-sm text-gray-500">Carregando…</p>
			{:else if entries.length === 0}
				<p class="text-sm text-gray-500">
					Nenhum personagem seu tem slot de interesse liberado ainda. Eles abrem ao subir de nível.
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
				{#if message}
					<p class="text-sm text-emerald-400">{message}</p>
				{/if}

				<div>
					<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
						Selecione seu personagem
					</p>
					<select
						bind:value={selectedCharacterId}
						onchange={fillFromSelected}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					>
						{#each entries as e (e.character.id)}
							<option value={e.character.id}>{e.character.name}</option>
						{/each}
					</select>
				</div>

				{#each SLOTS as s (s.value)}
					{@const interest = current(s.value)}
					<div>
						<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
							{s.label} (−{reduction[s.value]} no requisito)
						</p>
						{#if !selected?.unlocked[s.value]}
							<p class="text-sm text-gray-600">Ainda não liberado.</p>
						{:else if interest?.locked}
							<p class="text-sm text-gray-300">{interest.category}</p>
							<p class="text-xs text-amber-300 mt-1">Já trocado nesta semana — a próxima troca abre no domingo.</p>
						{:else}
							<div class="flex gap-2">
								<select
									bind:value={choice[s.value]}
									class="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
								>
									<option value="">Escolha uma categoria…</option>
									<optgroup label="Armas (treino)">
										{#each categories.weapon as c}
											<option value={`weapon|${c}`}>{c}</option>
										{/each}
									</optgroup>
									<optgroup label="Matérias (aula)">
										{#each categories.knowledge as c}
											<option value={`knowledge|${c}`}>{c}</option>
										{/each}
									</optgroup>
								</select>
								<button
									onclick={() => save(s.value)}
									disabled={saving !== null}
									class="px-4 rounded-lg font-semibold text-sm text-white"
									style="background: {saving === s.value ? 'rgba(55,65,81,1)' : 'rgb(79,70,229)'};"
								>
									{saving === s.value ? 'Salvando…' : 'Salvar'}
								</button>
							</div>
							{#if interest}
								<p class="text-xs text-gray-500 mt-1">
									Atual: {interest.category}. Trocar trava este slot até domingo.
								</p>
							{/if}
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
