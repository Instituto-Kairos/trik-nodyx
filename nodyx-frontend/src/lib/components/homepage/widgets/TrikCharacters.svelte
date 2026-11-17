<script lang="ts">
	// Widget "Meus personagens" (módulo RPG/trik): um cartão por personagem do
	// jogador logado — nível, barra de xp, média das últimas cenas, maestrias e
	// pendências de level up. Dados: GET /api/v1/trik/characters/mine/summary.
	//
	// Responsivo ao ESPAÇO onde está (container queries), não à tela: o mesmo widget
	// numa coluna estreita, numa faixa larga ou numa grade se reorganiza sozinho.
	// Personalizável no editor: disposição, tamanho, o que mostrar e cor de destaque.
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

	type Layout = 'carousel' | 'list' | 'grid'
	type Size = 'compact' | 'normal' | 'large'

	const heading     = $derived((config.heading as string) ?? '')
	const showMastery = $derived((config.show_mastery as boolean) ?? true)
	const showPending = $derived((config.show_pending as boolean) ?? true)
	const showXp      = $derived((config.show_xp as boolean) ?? true)
	const showAvg     = $derived((config.show_avg as boolean) ?? true)
	const layout      = $derived((['carousel', 'list', 'grid'].includes(config.layout as string) ? config.layout : 'carousel') as Layout)
	const size        = $derived((['compact', 'normal', 'large'].includes(config.size as string) ? config.size : 'normal') as Size)
	// 0 = todas as maestrias/aulas; senão só as N primeiras de cada grupo
	const masteryLimit = $derived(Math.max(0, Math.floor(Number(config.mastery_limit) || 0)))
	const accent      = $derived(/^#[0-9a-f]{6}$/i.test(String(config.accent_color ?? '')) ? String(config.accent_color) : '')

	const SCALE: Record<Size, number> = { compact: 0.85, normal: 1, large: 1.2 }
	const rootStyle = $derived(`--tc-scale:${SCALE[size]};${accent ? `--tc-accent:${accent};` : ''}`)

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

	// Carrossel: só o personagem atual. Lista e grade: todos.
	const shown = $derived(layout === 'carousel' ? (characters[current] ? [characters[current]] : []) : characters)
	const pctOf = (c: Character) =>
		c.goalXp && c.goalXp > 0 ? Math.min(100, Math.max(0, (c.progressXp / c.goalXp) * 100)) : 100
	const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
	const go = (d: number) => { current = (current + d + characters.length) % characters.length }
	const groupsOf = (c: Character) =>
		[
			{ label: 'Maestrias', list: c.weapons },
			{ label: 'Aulas', list: c.knowledges }
		].filter((g) => g.list.length > 0)
	const limited = (list: Mastery[]) => (masteryLimit > 0 ? list.slice(0, masteryLimit) : list)
</script>

{#snippet card(char: Character, nav: boolean)}
	{@const pct = pctOf(char)}
	{@const groups = groupsOf(char)}
	<div class="tc-cell">
		<div class="tc-card">
			<div class="tc-main">
				<div class="tc-head">
					{#if nav && characters.length > 1}
						<button class="tc-nav" onclick={() => go(-1)} aria-label="Personagem anterior">‹</button>
					{/if}
					<div class="tc-name">
						<span class="tc-name-text">{char.name}</span>
						<span class="tc-level">nível {char.level}</span>
					</div>
					{#if nav && characters.length > 1}
						<span class="tc-count">{current + 1}/{characters.length}</span>
						<button class="tc-nav" onclick={() => go(1)} aria-label="Próximo personagem">›</button>
					{/if}
				</div>

				{#if showXp}
					<div class="tc-xp">
						<span class="tc-xp-num">{fmt(char.progressXp)}xp</span>
						<div class="tc-bar" role="progressbar" aria-label="Experiência de {char.name}" aria-valuenow={Math.round(pct)} aria-valuemin="0" aria-valuemax="100">
							<div class="tc-bar-fill" style="width:{pct}%"></div>
						</div>
						<span class="tc-xp-num tc-xp-goal">{char.goalXp ? `${fmt(char.goalXp)}xp` : 'máx.'}</span>
					</div>
				{/if}

				{#if showAvg}
					<div class="tc-line">
						<span>média de xp por cena</span>
						<strong>{char.avgSceneXp === null ? '—' : `${fmt(char.avgSceneXp)}xp`}</strong>
						{#if char.sceneCount > 0}
							<span class="tc-dim">(últimas {char.sceneCount})</span>
						{/if}
					</div>
				{/if}
				<a class="tc-sheet" href="/personagens/{char.id}" title="Ver a ficha de {char.name}">ver ficha →</a>
			</div>

			{#if (showPending && (char.requirements.length > 0 || char.unspent.length > 0)) || (showMastery && groups.length > 0)}
				<div class="tc-extra">
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
									{#each limited(g.list) as m (m.name)}
										<div class="tc-mastery">
											<span class="tc-mastery-name">{m.name}</span>
											<span class="tc-mastery-lv">nív. {m.level}</span>
											<span class="tc-dim">{fmt(m.progress)}{m.required ? `/${m.required}` : ''}</span>
										</div>
									{/each}
									{#if masteryLimit > 0 && g.list.length > masteryLimit}
										<div class="tc-dim">+{g.list.length - masteryLimit} {g.list.length - masteryLimit === 1 ? 'outra' : 'outras'}</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/snippet}

{#if !loading && shown.length > 0}
	<div class="tc-root tc-layout--{layout}" style={rootStyle}>
		{#if heading || title}
			<div class="tc-heading">{heading || title}</div>
		{/if}

		<div class="tc-list">
			{#each shown as c (c.id)}
				{@render card(c, layout === 'carousel')}
			{/each}
		</div>
	</div>
{/if}

<style>
	/* Tudo em `em`: a opção "tamanho" muda --tc-scale e o widget inteiro acompanha. */
	.tc-root { width: 100%; font-size: calc(1rem * var(--tc-scale, 1)); --tc-hl: var(--tc-accent, var(--primary, #a78bfa)); --tc-hl2: var(--tc-accent, var(--accent, #06b6d4)); }
	.tc-heading {
		font-size: .7em; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
		color: var(--text-secondary, #6b7280); margin-bottom: .5em;
	}

	/* Disposição dos cartões */
	.tc-list { display: flex; flex-direction: column; gap: .75em; }
	.tc-layout--grid .tc-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19em), 1fr)); align-items: start; }

	/* Cada cartão responde à LARGURA DELE (container query), seja numa coluna estreita,
	   numa faixa larga ou numa célula da grade. */
	.tc-cell { container-type: inline-size; min-width: 0; }
	.tc-card {
		display: flex; flex-direction: column; gap: .65em;
		padding: 1em 1.1em;
		background: var(--card-bg, rgba(255,255,255,.03));
		border: var(--border-width, 1px) solid var(--border-color, rgba(255,255,255,.08));
		border-radius: var(--border-radius, 0);
		color: var(--text-primary, #e2e8f0);
	}
	.tc-main, .tc-extra { display: flex; flex-direction: column; gap: .65em; min-width: 0; }
	.tc-head { display: flex; align-items: center; gap: .5em; }
	.tc-name { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: .5em; }
	.tc-name-text { font-weight: 700; font-size: 1.05em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tc-level { font-size: .75em; color: var(--text-secondary, #6b7280); white-space: nowrap; }
	.tc-count { font-size: .7em; color: var(--text-secondary, #6b7280); }
	.tc-sheet { align-self: flex-end; font-size: .8em; color: var(--primary, #a78bfa); text-decoration: none; }
	.tc-sheet:hover { text-decoration: underline; }
	.tc-nav {
		width: 1.8em; height: 1.8em; line-height: 1; font-size: 1.2em; cursor: pointer;
		background: transparent; color: inherit;
		border: 1px solid var(--border-color, rgba(255,255,255,.12)); border-radius: var(--border-radius, 0);
	}
	.tc-nav:hover { border-color: var(--tc-hl); color: var(--tc-hl); }
	.tc-xp { display: flex; align-items: center; gap: .6em; font-variant-numeric: tabular-nums; }
	.tc-xp-num { font-size: .85em; white-space: nowrap; }
	.tc-bar {
		flex: 1; height: .6em; overflow: hidden;
		background: rgba(255,255,255,.08); border-radius: var(--border-radius, 0);
	}
	.tc-bar-fill {
		height: 100%; background: var(--tc-hl); transition: width .4s ease;
		border-radius: var(--border-radius, 0);
	}
	.tc-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: .4em; font-size: .85em; }
	.tc-line strong { color: var(--tc-hl2); }
	.tc-dim { color: var(--text-secondary, #6b7280); font-size: .75em; }
	.tc-section { display: flex; flex-direction: column; gap: .25em; font-size: .8em; }
	.tc-label { font-size: .65em; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--text-secondary, #6b7280); }
	.tc-req { color: #f87171; }
	.tc-req--met { color: #4ade80; }
	.tc-pending { color: var(--tc-hl2); }
	.tc-masteries { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12em), 1fr)); gap: .75em; }
	.tc-mastery { display: flex; align-items: baseline; gap: .5em; }
	.tc-mastery-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tc-mastery-lv { color: var(--tc-hl); font-size: .75em; white-space: nowrap; }

	/* ── Espaço estreito: a barra de xp vai para a linha de baixo, tudo mais compacto ── */
	@container (max-width: 21em) {
		.tc-card { padding: .75em; gap: .5em; }
		.tc-main, .tc-extra { gap: .5em; }
		.tc-name { flex-wrap: wrap; row-gap: 0; }
		.tc-xp { flex-wrap: wrap; row-gap: .3em; }
		.tc-bar { order: 3; flex: 1 1 100%; }
		.tc-xp-goal { margin-left: auto; }
		.tc-masteries { grid-template-columns: 1fr; gap: .5em; }
	}

	/* ── Espaço largo: dados do personagem de um lado, pendências e maestrias do outro ── */
	@container (min-width: 36em) {
		.tc-card { flex-direction: row; align-items: flex-start; gap: 1.5em; padding: 1.1em 1.3em; }
		.tc-main { flex: 0 1 18em; }
		.tc-extra { flex: 1 1 0; border-left: 1px solid var(--border-color, rgba(255,255,255,.08)); padding-left: 1.5em; }
	}
</style>
