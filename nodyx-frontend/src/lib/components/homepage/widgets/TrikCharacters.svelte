<script lang="ts">
	// Widget "Meus personagens" (módulo RPG/trik): carrossel com um cartão por
	// personagem do jogador logado — nível, barra de xp, média das últimas cenas,
	// maestrias e pendências de level up. Dados: GET /api/v1/trik/characters/mine/summary.
	import { page } from '$app/state'

	interface Mastery { name: string; category: string | null; level: number; progress: number; required: number | null }
	interface Character {
		id: string
		name: string
		level: number
		progressXp: number
		goalXp: number | null
		avgSceneXp: number | null
		sceneCount: number
		weapons: Mastery[]
		knowledges: Mastery[]
		unspent: { label: string; count: number }[]
		requirements: { label: string; met: boolean }[]
	}

	interface Props {
		config:    Record<string, unknown>
		instance?: Record<string, unknown>
		user?:     Record<string, unknown> | null
		title?:    string | null
	}

	let { config, user, title }: Props = $props()

	const heading     = $derived((config.heading as string) ?? '')
	const showMastery = $derived((config.show_mastery as boolean) ?? true)
	const showPending = $derived((config.show_pending as boolean) ?? true)

	const token = $derived((page.data as { token?: string | null }).token ?? null)

	let characters = $state<Character[]>([])
	let loading = $state(true)
	let current = $state(0)

	$effect(() => {
		if (!user || !token) { loading = false; return }
		let stale = false
		fetch('/api/v1/trik/characters/mine/summary', { headers: { Authorization: `Bearer ${token}` } })
			.then(res => res.ok ? res.json() as Promise<{ characters: Character[] }> : null)
			.then(data => { if (!stale && data) { characters = data.characters; current = 0 } })
			.catch(() => { /* sem resumo: o widget some */ })
			.finally(() => { if (!stale) loading = false })
		return () => { stale = true }
	})

	const char = $derived(characters[current] ?? null)
	const pct = $derived(
		char && char.goalXp && char.goalXp > 0
			? Math.min(100, Math.max(0, (char.progressXp / char.goalXp) * 100))
			: 100
	)
	const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
	const go = (d: number) => { current = (current + d + characters.length) % characters.length }
	const groups = $derived(
		char
			? [
					{ label: 'Maestrias', list: char.weapons },
					{ label: 'Aulas', list: char.knowledges }
				].filter((g) => g.list.length > 0)
			: []
	)
</script>

{#if !loading && char}
	<div class="tc-root">
		{#if heading || title}
			<div class="tc-heading">{heading || title}</div>
		{/if}

		<div class="tc-card">
			<div class="tc-head">
				{#if characters.length > 1}
					<button class="tc-nav" onclick={() => go(-1)} aria-label="Personagem anterior">‹</button>
				{/if}
				<div class="tc-name">
					<span class="tc-name-text">{char.name}</span>
					<span class="tc-level">nível {char.level}</span>
				</div>
				{#if characters.length > 1}
					<span class="tc-count">{current + 1}/{characters.length}</span>
					<button class="tc-nav" onclick={() => go(1)} aria-label="Próximo personagem">›</button>
				{/if}
			</div>

			<div class="tc-xp">
				<span class="tc-xp-num">{fmt(char.progressXp)}xp</span>
				<div class="tc-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin="0" aria-valuemax="100">
					<div class="tc-bar-fill" style="width:{pct}%"></div>
				</div>
				<span class="tc-xp-num">{char.goalXp ? `${fmt(char.goalXp)}xp` : 'máx.'}</span>
			</div>

			<div class="tc-line">
				<span>média de xp por cena</span>
				<strong>{char.avgSceneXp === null ? '—' : `${fmt(char.avgSceneXp)}xp`}</strong>
				{#if char.sceneCount > 0}
					<span class="tc-dim">(últimas {char.sceneCount})</span>
				{/if}
			</div>

			{#if showPending && (char.requirements.length > 0 || char.unspent.length > 0)}
				<div class="tc-section">
					{#each char.requirements as r}
						<div class="tc-req" class:tc-req--met={r.met}>{r.met ? '✔' : '✖'} {r.label}</div>
					{/each}
					{#if char.unspent.length > 0}
						<div class="tc-pending">
							Pontos para gastar no /levelup:
							{#each char.unspent as p, i}{i ? ', ' : ' '}{p.count} {p.label}{/each}
						</div>
					{/if}
				</div>
			{/if}

			{#if showMastery && groups.length > 0}
				<div class="tc-masteries">
					{#each groups as g (g.label)}
						<div class="tc-section">
							<div class="tc-label">{g.label}</div>
							{#each g.list as m (m.name)}
								<div class="tc-mastery">
									<span class="tc-mastery-name">{m.name}</span>
									<span class="tc-mastery-lv">nív. {m.level}</span>
									<span class="tc-dim">{fmt(m.progress)}{m.required ? `/${m.required}` : ''}</span>
								</div>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.tc-root { width: 100%; }
	.tc-heading {
		font-size: .7rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
		color: var(--text-secondary, #6b7280); margin-bottom: .5rem;
	}
	.tc-card {
		display: flex; flex-direction: column; gap: .65rem;
		padding: 1rem 1.1rem;
		background: var(--card-bg, rgba(255,255,255,.03));
		border: var(--border-width, 1px) solid var(--border-color, rgba(255,255,255,.08));
		border-radius: var(--border-radius, 0);
		color: var(--text-primary, #e2e8f0);
	}
	.tc-head { display: flex; align-items: center; gap: .5rem; }
	.tc-name { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: .5rem; }
	.tc-name-text { font-weight: 700; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tc-level { font-size: .75rem; color: var(--text-secondary, #6b7280); white-space: nowrap; }
	.tc-count { font-size: .7rem; color: var(--text-secondary, #6b7280); }
	.tc-nav {
		width: 1.8rem; height: 1.8rem; line-height: 1; font-size: 1.2rem; cursor: pointer;
		background: transparent; color: inherit;
		border: 1px solid var(--border-color, rgba(255,255,255,.12)); border-radius: var(--border-radius, 0);
	}
	.tc-nav:hover { border-color: var(--primary, #a78bfa); color: var(--primary, #a78bfa); }
	.tc-xp { display: flex; align-items: center; gap: .6rem; font-variant-numeric: tabular-nums; }
	.tc-xp-num { font-size: .85rem; white-space: nowrap; }
	.tc-bar {
		flex: 1; height: .6rem; overflow: hidden;
		background: rgba(255,255,255,.08); border-radius: var(--border-radius, 0);
	}
	.tc-bar-fill {
		height: 100%; background: var(--primary, #a78bfa); transition: width .4s ease;
		border-radius: var(--border-radius, 0);
	}
	.tc-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: .4rem; font-size: .85rem; }
	.tc-line strong { color: var(--accent, #06b6d4); }
	.tc-dim { color: var(--text-secondary, #6b7280); font-size: .75rem; }
	.tc-section { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; }
	.tc-label { font-size: .65rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--text-secondary, #6b7280); }
	.tc-req { color: #f87171; }
	.tc-req--met { color: #4ade80; }
	.tc-pending { color: var(--accent, #06b6d4); }
	.tc-masteries { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .75rem; }
	.tc-mastery { display: flex; align-items: baseline; gap: .5rem; }
	.tc-mastery-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tc-mastery-lv { color: var(--primary, #a78bfa); font-size: .75rem; white-space: nowrap; }
</style>
