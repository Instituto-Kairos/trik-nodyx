<script lang="ts">
	// /registro-au (trik_014): personagem do Universo Alternativo — só nome e
	// link da ficha. Plaquinha pelo /plaquinha de sempre; xp acumula, sem nível.
	import { apiFetch } from '$lib/api';
	import { portal } from '$lib/actions/portal';

	interface Props {
		token: string;
		channelId: string;
		onclose: () => void;
	}

	let { token, channelId, onclose }: Props = $props();

	let saving = $state(false);
	let error = $state<string | null>(null);
	let done = $state(false);

	let name = $state('');
	let fichaLink = $state('');

	async function submit() {
		error = null;
		if (!name.trim() || !fichaLink.trim()) {
			error = 'Preencha o nome do personagem e o link da ficha';
			return;
		}
		if (/[\]\n]/.test(name)) {
			error = 'O nome não pode ter "]"';
			return;
		}
		saving = true;
		try {
			const res = await apiFetch(fetch, '/trik/registro-au', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ channelId, name: name.trim(), fichaLink: fichaLink.trim() })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body.code === 'VALIDATION_ERROR' ? 'Link da ficha inválido' : (body.error ?? 'Erro ao registrar');
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
	aria-label="Registro de personagem AU"
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
			<h2 class="text-sm font-bold text-white">Registro de personagem — Universo Alternativo</h2>
			<button
				onclick={onclose}
				class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white transition-colors"
				aria-label="Fechar"
			>
				×
			</button>
		</div>

		<div class="px-6 py-5 space-y-4">
			{#if done}
				<p class="text-sm text-emerald-400">
					Personagem registrado. Use /plaquinha para cadastrar a plaquinha dele.
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
						Nome do personagem
					</p>
					<input
						bind:value={name}
						maxlength="100"
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					/>
				</div>

				<div>
					<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
						Link da ficha
					</p>
					<input
						bind:value={fichaLink}
						type="url"
						maxlength="500"
						placeholder="https://"
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
					/>
				</div>
			{/if}
		</div>

		{#if !done}
			<div class="px-6 pb-6">
				<button
					onclick={submit}
					disabled={saving}
					class="w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-all"
					style="background: {saving ? 'rgba(55,65,81,1)' : 'rgb(79,70,229)'};"
				>
					{saving ? 'Salvando…' : 'Registrar'}
				</button>
			</div>
		{/if}
	</div>
</div>
