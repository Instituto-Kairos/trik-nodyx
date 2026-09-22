<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { portal } from '$lib/actions/portal';

	interface Props {
		token: string;
		channelId: string;
		onclose: () => void;
	}

	let { token, channelId, onclose }: Props = $props();

	interface Character {
		id: string;
		name: string;
	}

	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let done = $state(false);
	let characters = $state<Character[]>([]);

	let selectedCharacterId = $state('');
	let templateName = $state('');
	let templateSignature = $state('');

	async function load() {
		loading = true;
		try {
			const res = await apiFetch(fetch, '/trik/characters/mine', {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (res.ok) {
				const data = await res.json();
				characters = data.characters ?? [];
				selectedCharacterId = characters[0]?.id ?? '';
			}
		} finally {
			loading = false;
		}
	}

	load();

	async function submit() {
		error = null;
		if (!selectedCharacterId) {
			error = 'Selecione um personagem';
			return;
		}
		if (!templateName.trim() || !templateSignature.trim()) {
			error = 'Preencha o nome e a assinatura da plaquinha';
			return;
		}
		saving = true;
		try {
			const res = await apiFetch(fetch, '/trik/plaquinha', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					channelId,
					characterId: selectedCharacterId,
					templateName: templateName.trim(),
					templateSignature: templateSignature.trim()
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body.error ?? 'Erro ao salvar plaquinha';
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
	aria-label="Registro de plaquinha"
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
			<h2 class="text-sm font-bold text-white">Registro de plaquinha</h2>
			<button
				onclick={onclose}
				class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white transition-colors"
				aria-label="Fechar"
			>
				×
			</button>
		</div>

		<div class="px-6 py-5 space-y-4">
			{#if loading}
				<p class="text-sm text-gray-500">Carregando…</p>
			{:else if done}
				<p class="text-sm text-emerald-400">Plaquinha salva com sucesso.</p>
			{:else if characters.length === 0}
				<p class="text-sm text-gray-500">
					Você ainda não tem nenhum personagem. Use /registro primeiro.
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
						bind:value={selectedCharacterId}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					>
						{#each characters as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</div>

				<div>
					<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
						Nome do personagem (mesma fonte que vai usar na plaquinha)
					</p>
					<input
						bind:value={templateName}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					/>
				</div>

				<div>
					<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
						Assinatura (frase/símbolos, exatamente como vai estar na plaquinha)
					</p>
					<textarea
						bind:value={templateSignature}
						rows="2"
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					></textarea>
				</div>
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
