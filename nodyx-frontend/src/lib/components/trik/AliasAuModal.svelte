<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { portal } from '$lib/actions/portal';

	// /alias-au (trik_013): aliases do Universo Alternativo. Texto livre, sem
	// limite e sem ficha: só existem pra marcação, e só aparecem no `@` dentro
	// das categorias AU. Fora do AU quem aparece são os personagens.

	interface Props {
		token: string;
		onclose: () => void;
	}

	let { token, onclose }: Props = $props();

	interface AuAlias {
		id: string;
		name: string;
	}

	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let aliases = $state<AuAlias[]>([]);
	let name = $state('');

	const headers = () => ({ Authorization: `Bearer ${token}` });

	async function load() {
		loading = true;
		try {
			const res = await apiFetch(fetch, '/trik/au-aliases', { headers: headers() });
			if (res.ok) aliases = (await res.json()).aliases ?? [];
		} finally {
			loading = false;
		}
	}

	load();

	async function add() {
		const nome = name.trim();
		if (!nome || saving) return;
		error = null;
		saving = true;
		try {
			const res = await apiFetch(fetch, '/trik/au-aliases', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headers() },
				body: JSON.stringify({ name: nome })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body.error ?? 'Erro ao salvar alias';
				return;
			}
			name = '';
			await load();
		} catch {
			error = 'Erro de rede ao salvar';
		} finally {
			saving = false;
		}
	}

	async function remove(alias: AuAlias) {
		if (!confirm(`Apagar o alias "${alias.name}"? Marcações antigas continuam no texto.`)) return;
		error = null;
		const res = await apiFetch(fetch, `/trik/au-aliases/${alias.id}`, {
			method: 'DELETE',
			headers: headers()
		}).catch(() => null);
		if (!res?.ok) {
			error = 'Erro ao apagar alias';
			return;
		}
		aliases = aliases.filter((a) => a.id !== alias.id);
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
	aria-label="Aliases do AU"
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
			<h2 class="text-sm font-bold text-white">Aliases do AU</h2>
			<button
				onclick={onclose}
				class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white transition-colors"
				aria-label="Fechar"
			>
				×
			</button>
		</div>

		<div class="px-6 py-5 space-y-4">
			<p class="text-xs text-gray-500">
				Estes nomes aparecem na marcação com @ só dentro das categorias do Universo Alternativo.
			</p>

			{#if error}
				<div
					class="rounded-lg px-4 py-3 text-sm text-red-300"
					style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);"
				>
					{error}
				</div>
			{/if}

			<div class="flex gap-2">
				<input
					type="text"
					bind:value={name}
					maxlength="100"
					placeholder="Nome do alias no AU"
					onkeydown={(e) => e.key === 'Enter' && add()}
					class="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
				/>
				<button
					onclick={add}
					disabled={saving || !name.trim()}
					class="px-4 rounded-lg font-semibold text-sm text-white"
					style="background: {saving ? 'rgba(55,65,81,1)' : 'rgb(79,70,229)'};"
				>
					{saving ? 'Salvando…' : 'Adicionar'}
				</button>
			</div>

			{#if loading && aliases.length === 0}
				<p class="text-sm text-gray-500">Carregando…</p>
			{:else if aliases.length === 0}
				<p class="text-sm text-gray-500">Você ainda não tem aliases no AU.</p>
			{:else}
				<ul class="divide-y divide-gray-800 rounded-lg border border-gray-800">
					{#each aliases as a (a.id)}
						<li class="flex items-center justify-between gap-3 px-4 py-2">
							<span class="text-sm text-gray-200 truncate">{a.name}</span>
							<button
								onclick={() => remove(a)}
								class="text-xs text-gray-500 hover:text-red-400 transition-colors"
							>
								Apagar
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</div>
