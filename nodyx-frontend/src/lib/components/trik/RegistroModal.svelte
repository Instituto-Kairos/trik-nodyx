<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { portal } from '$lib/actions/portal';

	interface Props {
		token: string;
		channelId: string;
		onclose: () => void;
	}

	let { token, channelId, onclose }: Props = $props();

	type Principle = 'mente' | 'coracao' | 'corpo';
	type Conduct = 'presenca' | 'proposito' | 'sangue';

	let loading = $state(true);
	let isNewPlayer = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let done = $state(false);

	// Jogador (só usado/exibido se isNewPlayer)
	let playerName = $state('');
	let playerPronouns = $state('');
	let playerBirthDate = $state('');

	// Personagem
	let charName = $state('');
	let charPronouns = $state('');
	let charBirthDate = $state('');
	let faceclaimName = $state('');
	let faceclaimBirthDate = $state('');
	let fichaLink = $state('');
	let pantheon = $state('');
	let divineBond = $state('');
	let divineGift = $state('');

	let principlesPicked = $state<Principle[]>([]);
	let conductPicked = $state<Conduct[]>([]);

	function togglePrinciple(p: Principle) {
		if (principlesPicked.includes(p)) {
			principlesPicked = principlesPicked.filter((x) => x !== p);
		} else if (principlesPicked.length < 2) {
			principlesPicked = [...principlesPicked, p];
		}
	}

	function toggleConduct(c: Conduct) {
		if (conductPicked.includes(c)) {
			conductPicked = conductPicked.filter((x) => x !== c);
		} else if (conductPicked.length < 1) {
			conductPicked = [...conductPicked, c];
		}
	}

	async function load() {
		loading = true;
		try {
			const res = await apiFetch(fetch, '/trik/players/me', {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (res.ok) {
				const data = await res.json();
				isNewPlayer = !data.player;
			}
		} finally {
			loading = false;
		}
	}

	load();

	async function submit() {
		error = null;
		if (!fichaLink.trim()) {
			error = 'Link da ficha é obrigatório';
			return;
		}
		saving = true;
		try {
			const res = await apiFetch(fetch, '/trik/registro', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					channelId,
					...(isNewPlayer
						? {
								player: {
									name: playerName.trim(),
									pronouns: playerPronouns.trim() || undefined,
									birthDate: playerBirthDate || undefined
								}
							}
						: {}),
					character: {
						name: charName.trim(),
						pronouns: charPronouns.trim() || undefined,
						birthDate: charBirthDate || undefined,
						faceclaimName: faceclaimName.trim() || undefined,
						faceclaimBirthDate: faceclaimBirthDate || undefined,
						fichaLink: fichaLink.trim(),
						pantheon: pantheon.trim() || undefined,
						divineBond: divineBond.trim() || undefined,
						divineGift: divineGift.trim() || undefined,
						principlesPicked,
						conductPicked
					}
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body.error ?? 'Erro ao registrar';
				return;
			}
			done = true;
		} catch {
			error = 'Erro de rede ao registrar';
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
	aria-label="Registro de jogador"
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
			<h2 class="text-sm font-bold text-white">Registro de jogador</h2>
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
				<p class="text-sm text-emerald-400">Registro salvo com sucesso.</p>
				<button
					onclick={onclose}
					class="w-full py-2.5 rounded-xl font-semibold text-sm text-white"
					style="background: rgb(79,70,229);"
				>
					Fechar
				</button>
			{:else}
				{#if error}
					<div
						class="rounded-lg px-4 py-3 text-sm text-red-300"
						style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);"
					>
						{error}
					</div>
				{/if}

				{#if isNewPlayer}
					<div class="space-y-3">
						<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500">
							Dados de jogador
						</p>
						<div class="grid grid-cols-2 gap-3">
							<input
								placeholder="Nome"
								bind:value={playerName}
								class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
							/>
							<input
								type="date"
								placeholder="Data de nascimento"
								bind:value={playerBirthDate}
								class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
							/>
						</div>
						<input
							placeholder="Pronomes"
							bind:value={playerPronouns}
							class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
						/>
					</div>
					<div style="height: 1px; background: rgba(255,255,255,0.05)"></div>
				{/if}

				<div class="space-y-3">
					<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500">
						Dados do personagem
					</p>
					<div class="grid grid-cols-2 gap-3">
						<input
							placeholder="Nome do personagem"
							bind:value={charName}
							class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
						/>
						<input
							type="date"
							bind:value={charBirthDate}
							class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
						/>
					</div>
					<input
						placeholder="Pronomes do personagem"
						bind:value={charPronouns}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					/>
					<div class="grid grid-cols-2 gap-3">
						<input
							placeholder="Nome do avatar"
							bind:value={faceclaimName}
							class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
						/>
						<input
							type="date"
							bind:value={faceclaimBirthDate}
							class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
						/>
					</div>
					<input
						placeholder="Link da sua ficha"
						bind:value={fichaLink}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					/>
					<div class="grid grid-cols-2 gap-3">
						<input
							placeholder="Vínculo divino"
							bind:value={divineBond}
							class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
						/>
						<input
							placeholder="Panteão"
							bind:value={pantheon}
							class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
						/>
					</div>
					<input
						placeholder="Presente divino"
						bind:value={divineGift}
						maxlength="240"
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					/>
				</div>

				<div style="height: 1px; background: rgba(255,255,255,0.05)"></div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500">
							Escolha 2
						</p>
						{#each [['mente', 'Mente'], ['coracao', 'Coração'], ['corpo', 'Corpo']] as [value, label] (value)}
							<label class="flex items-center gap-2 text-sm text-gray-300">
								<input
									type="checkbox"
									checked={principlesPicked.includes(value as Principle)}
									disabled={!principlesPicked.includes(value as Principle) && principlesPicked.length >= 2}
									onchange={() => togglePrinciple(value as Principle)}
								/>
								{label}
							</label>
						{/each}
					</div>
					<div class="space-y-1.5">
						<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500">
							Escolha 1
						</p>
						{#each [['proposito', 'Propósito'], ['sangue', 'Sangue'], ['presenca', 'Presença']] as [value, label] (value)}
							<label class="flex items-center gap-2 text-sm text-gray-300">
								<input
									type="checkbox"
									checked={conductPicked.includes(value as Conduct)}
									disabled={!conductPicked.includes(value as Conduct) && conductPicked.length >= 1}
									onchange={() => toggleConduct(value as Conduct)}
								/>
								{label}
							</label>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if !loading && !done}
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
