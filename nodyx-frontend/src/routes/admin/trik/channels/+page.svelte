<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	interface Channel {
		id: string;
		name: string;
		purposes: string[];
	}

	const PURPOSES = [
		{
			value: 'registro',
			label: 'Registro',
			command: '/registro',
			description: 'Abre o modal de cadastro de jogador e personagem.'
		},
		{
			value: 'plaquinha',
			label: 'Plaquinha',
			command: '/plaquinha',
			description: 'Abre o modal de nome/assinatura de template do personagem.'
		},
		{
			value: 'levelup',
			label: 'Level up',
			command: '/levelup',
			description: 'Abre o modal de distribuição de pontos ao subir de nível (Fase 2).'
		},
		{
			value: 'anuncio',
			label: 'Anúncio',
			command: 'automático',
			description: 'Canal onde o bot Trik avisa quando um personagem sobe de nível (Fase 2). A contagem de XP em si é marcada por tópico do fórum, não aqui.'
		}
	];

	// channelId → Set de propósitos marcados (um canal pode atender mais de um comando)
	let selections = $state<Record<string, Set<string>>>({});
	$effect(() => {
		const channels = (data.channels ?? []) as Channel[];
		const initial: Record<string, Set<string>> = {};
		for (const ch of channels) {
			initial[ch.id] = new Set(ch.purposes);
		}
		selections = initial;
	});

	function togglePurpose(channelId: string, purpose: string) {
		const current = new Set(selections[channelId] ?? []);
		if (current.has(purpose)) current.delete(purpose);
		else current.add(purpose);
		selections = { ...selections, [channelId]: current };
	}

	let expandedId = $state<string | null>(null);
	function toggleExpanded(channelId: string) {
		expandedId = expandedId === channelId ? null : channelId;
	}

	function summary(channelId: string): string {
		const n = selections[channelId]?.size ?? 0;
		if (n === 0) return 'Nenhum comando';
		if (n === 1) return '1 comando';
		return `${n} comandos`;
	}

	const entriesJson = $derived(
		JSON.stringify(
			Object.entries(selections).flatMap(([channelId, purposes]) =>
				Array.from(purposes).map((purpose) => ({ channelId, purpose }))
			)
		)
	);
</script>

<svelte:head><title>RPG — Canais</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Canais</h1>
		<p class="text-sm text-gray-500">
			Defina quais comandos do módulo RPG cada canal atende (/registro, /plaquinha). Um canal
			pode atender mais de um comando; um canal sem nenhum marcado não abre nenhum modal.
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}
	{#if form?.ok}
		<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300">
			Salvo.
		</div>
	{/if}

	<form method="POST" action="?/save" use:enhance class="space-y-4">
		<input type="hidden" name="entries" value={entriesJson} />

		<div class="rounded-xl border border-gray-800 bg-gray-900/40">
			<ul class="divide-y divide-gray-800">
				{#each data.channels ?? [] as ch (ch.id)}
					<li>
						<button
							type="button"
							onclick={() => toggleExpanded(ch.id)}
							class="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-gray-800/30 transition-colors"
						>
							<span class="text-sm text-white truncate">{ch.name}</span>
							<span class="flex items-center gap-3 shrink-0">
								<span
									class="text-xs {selections[ch.id]?.size ? 'text-indigo-400' : 'text-gray-600'}"
								>
									{summary(ch.id)}
								</span>
								<span class="text-xs font-medium text-gray-400 hover:text-white transition-colors">
									Configurar comandos
								</span>
								<svg
									viewBox="0 0 20 20"
									class="w-4 h-4 text-gray-500 transition-transform {expandedId === ch.id ? 'rotate-180' : ''}"
									fill="currentColor"
								>
									<path
										fill-rule="evenodd"
										d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.27a.75.75 0 01.02-1.06z"
										clip-rule="evenodd"
									/>
								</svg>
							</span>
						</button>

						{#if expandedId === ch.id}
							<div class="px-5 pb-4 bg-gray-950/40 border-t border-gray-800">
								<ul class="divide-y divide-gray-800/60 mt-2">
									{#each PURPOSES as p (p.value)}
										{@const checked = selections[ch.id]?.has(p.value) ?? false}
										<li class="flex items-center justify-between gap-4 py-3">
											<div class="min-w-0">
												<p class="text-sm font-medium text-white">
													{p.label}
													<span class="ml-1.5 text-xs font-mono text-gray-500">{p.command}</span>
												</p>
												<p class="text-xs text-gray-500 mt-0.5">{p.description}</p>
											</div>
											<label class="relative inline-flex items-center shrink-0 cursor-pointer">
												<input
													type="checkbox"
													{checked}
													onchange={() => togglePurpose(ch.id, p.value)}
													class="peer sr-only"
												/>
												<span
													class="w-9 h-5 rounded-full bg-gray-700 transition-colors peer-checked:bg-indigo-600"
												></span>
												<span
													class="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4"
												></span>
											</label>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>

		<button
			type="submit"
			class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors"
		>
			Salvar
		</button>
	</form>
</div>
