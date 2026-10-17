<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	interface Location {
		id: string;
		name: string;
		latitude: string;
		longitude: string;
	}
	interface Alert {
		kind: 'calor' | 'frio' | 'umidade';
		level: 'atencao' | 'laranja' | 'vermelho';
	}
	interface Day {
		location_id: string;
		game_date: string;
		climate: string | null;
		sunrise: string | null;
		sunset: string | null;
		temp_max: string | null;
		temp_min: string | null;
		humidity_min: number | null;
		rain_hours: string | null;
		alerts: Alert[];
	}

	const locations = $derived((data.locations ?? []) as Location[]);
	const weather = $derived((data.weather ?? []) as Day[]);
	const weekStart = $derived(data.weekStart);

	const CLIMATE: Record<string, string> = {
		sol: '☀️ Sol', nublado: '☁️ Nublado', neblina: '🌫️ Neblina', garoa: '🌦️ Garoa',
		chuva: '🌧️ Chuva', tempestade: '⛈️ Tempestade', neve: '❄️ Neve'
	};
	const LEVEL_ICON = { atencao: '🟡', laranja: '🟠', vermelho: '🔴' };
	const KIND_LABEL = { calor: 'Calor', frio: 'Frio', umidade: 'Ar seco' };
	const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

	function addDays(date: string, days: number): string {
		const d = new Date(`${date}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	}
	const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
	const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
	const deg = (v: string | null) => (v === null ? '?' : `${Math.round(Number(v))}°`);
	const hm = (t: string | null) => (t ? t.slice(0, 5) : '--:--');

	const daysOf = (locationId: string) => weather.filter((w) => w.location_id === locationId);

	let pickedDate = $state('');
	$effect(() => {
		pickedDate = weekStart ?? '2020-01-05';
	});

	const resetOnSuccess: SubmitFunction = ({ formElement }) => {
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') formElement.reset();
		};
	};
	const confirmDelete = (name: string): SubmitFunction => ({ cancel }) => {
		if (!confirm(`Remover "${name}"? Os tópicos dessa região ficam sem região (sem clima nem alertas).`)) cancel();
	};

	let syncing = $state(false);
	const syncWeek: SubmitFunction = () => {
		syncing = true;
		return async ({ update }) => {
			await update({ reset: false });
			syncing = false;
		};
	};

	const input = 'rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600';
</script>

<svelte:head><title>RPG — Clima</title></svelte:head>

<div class="space-y-8">
	<div>
		<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Clima</h1>
		<p class="text-sm text-gray-500">
			O jogo se passa em 2020. Ao selecionar a semana (domingo a sábado), o clima de cada região é
			buscado na Open-Meteo e o aviso vai pro canal de propósito Clima (aba Canais). Cenas de
			treino/aula com Data fora da semana são recusadas.
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">{form.error}</div>
	{/if}
	{#if form?.weekSet}
		<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300">
			Semana selecionada.
			{form.noticeSent ? 'Aviso enviado no canal Clima.' : 'Nenhum aviso enviado (sem canal Clima configurado ou sem regiões).'}
			{#if form.failed?.length}
				<span class="text-amber-300">Falhou a busca de: {form.failed.join(', ')} — selecione a semana de novo pra tentar.</span>
			{/if}
		</div>
	{/if}

	<section class="space-y-3">
		<h2 class="text-sm font-bold uppercase tracking-widest text-gray-400">Semana em jogo</h2>
		<div class="flex flex-wrap items-end gap-3">
			<form method="POST" action="?/setWeek" use:enhance={syncWeek} class="flex items-end gap-3">
				<div class="space-y-1">
					<label for="weekDate" class="block text-xs text-gray-500">Qualquer dia da semana</label>
					<input id="weekDate" type="date" name="date" bind:value={pickedDate} min="2020-01-01" max="2020-12-31" class={input} />
				</div>
				<button type="submit" disabled={syncing} class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white disabled:opacity-50">
					{syncing ? 'Buscando clima…' : 'Selecionar semana'}
				</button>
			</form>
			{#if weekStart}
				<form method="POST" action="?/setWeek" use:enhance={syncWeek}>
					<input type="hidden" name="date" value={addDays(weekStart, 7)} />
					<button type="submit" disabled={syncing} class="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white disabled:opacity-50">
						Próxima semana →
					</button>
				</form>
			{/if}
		</div>
		<p class="text-sm text-gray-300">
			{#if weekStart}
				Em jogo: <strong class="text-white">{ddmm(weekStart)} a {ddmm(addDays(weekStart, 6))}/{addDays(weekStart, 6).slice(0, 4)}</strong>
			{:else}
				Nenhuma semana selecionada — nenhuma cena é recusada por data.
			{/if}
		</p>

		{#if weekStart}
			{#each locations as loc (loc.id)}
				{@const days = daysOf(loc.id)}
				<div class="rounded-xl border border-gray-800 bg-gray-900/40 overflow-x-auto">
					<div class="px-4 py-2 text-sm font-semibold text-white border-b border-gray-800">📍 {loc.name}</div>
					{#if days.length === 0}
						<p class="px-4 py-3 text-xs text-gray-500">Sem dados dessa semana — selecione a semana de novo pra buscar.</p>
					{:else}
						<table class="w-full text-xs">
							<tbody class="divide-y divide-gray-800">
								{#each days as d (d.game_date)}
									<tr>
										<td class="px-4 py-1.5 text-gray-400 whitespace-nowrap">{weekday(d.game_date)} {ddmm(d.game_date)}</td>
										<td class="px-2 py-1.5 text-gray-200">
											{d.climate ? CLIMATE[d.climate] : '❔'}
											{#if d.rain_hours}<span class="text-gray-400">{d.rain_hours}</span>{/if}
										</td>
										<td class="px-2 py-1.5 text-gray-300 whitespace-nowrap">🌡️ {deg(d.temp_max)}/{deg(d.temp_min)}</td>
										<td class="px-2 py-1.5 text-gray-300 whitespace-nowrap">💧 {d.humidity_min ?? '?'}%</td>
										<td class="px-2 py-1.5 text-gray-400 whitespace-nowrap">🌅 {hm(d.sunrise)} · 🌇 {hm(d.sunset)}</td>
										<td class="px-4 py-1.5 text-gray-200 whitespace-nowrap">
											{#each d.alerts as a (a.kind)}
												<span class="mr-2">{LEVEL_ICON[a.level]} {KIND_LABEL[a.kind]}</span>
											{/each}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			{/each}
		{/if}
	</section>

	<section class="space-y-3">
		<h2 class="text-sm font-bold uppercase tracking-widest text-gray-400">Regiões</h2>
		<p class="text-xs text-gray-500">
			A região de cada tópico é escolhida no próprio tópico, junto do botão de XP. Tópico sem região
			não tem clima, horário nem alertas.
		</p>
		<form method="POST" action="?/createLocation" use:enhance={resetOnSuccess} class="flex flex-wrap items-end gap-3">
			<div class="space-y-1">
				<label for="locName" class="block text-xs text-gray-500">Nome</label>
				<input id="locName" name="name" required maxlength="100" placeholder="Ex.: Nova Orleans" autocomplete="off" class="{input} w-56" />
			</div>
			<div class="space-y-1">
				<label for="locLat" class="block text-xs text-gray-500">Latitude</label>
				<input id="locLat" name="latitude" required inputmode="decimal" placeholder="29.95107" autocomplete="off" class="{input} w-32" />
			</div>
			<div class="space-y-1">
				<label for="locLon" class="block text-xs text-gray-500">Longitude</label>
				<input id="locLon" name="longitude" required inputmode="decimal" placeholder="-90.07153" autocomplete="off" class="{input} w-32" />
			</div>
			<button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white">Adicionar</button>
		</form>

		<ul class="space-y-1.5">
			{#each locations as loc (loc.id)}
				<li class="flex items-center gap-3 rounded-lg bg-gray-800/60 px-3 py-1.5 text-sm text-gray-200">
					<span class="flex-1">{loc.name}</span>
					<span class="text-xs text-gray-500">{Number(loc.latitude)}, {Number(loc.longitude)}</span>
					<form method="POST" action="?/deleteLocation" use:enhance={confirmDelete(loc.name)}>
						<input type="hidden" name="id" value={loc.id} />
						<button type="submit" class="text-xs text-gray-500 hover:text-red-400">Remover</button>
					</form>
				</li>
			{/each}
			{#if locations.length === 0}
				<li class="text-xs text-gray-500">Nenhuma região cadastrada ainda.</li>
			{/if}
		</ul>
	</section>
</div>
