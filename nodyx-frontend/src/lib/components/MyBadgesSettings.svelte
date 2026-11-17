<script lang="ts">
	// Configurações › Conta › Cargos exibidos.
	// A pessoa escolhe quais dos SEUS cargos aparecem ao lado do nome (posts, perfil,
	// painel de membros). Cargo secreto nunca aparece, e a pessoa só vê que o tem.
	// Cada mudança é salva na hora.
	import { onMount } from 'svelte'
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import { apiFetch } from '$lib/api'
	import { tagTextColor } from '$lib/tagStyle'

	interface MyGrade { id: string; name: string; color: string; is_secret: boolean; show_badge: boolean }

	const tFn = $derived($t)
	const token = $derived(((page.data as any)?.token ?? null) as string | null)
	const auth = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {})

	let grades = $state<MyGrade[]>([])
	let loaded = $state(false)
	let busy = $state(false)
	let error = $state('')
	let saved = $state(false)
	let savedTimer: ReturnType<typeof setTimeout> | null = null

	onMount(async () => {
		try {
			const r = await apiFetch(fetch, '/instance/me/grades', { headers: auth() })
			if (r.ok) grades = (await r.json()).grades ?? []
		} catch { /* sem cargos mostrados */ }
		loaded = true
	})

	async function toggle(g: MyGrade) {
		if (g.is_secret || busy) return
		const before = grades
		// Otimista : a tela muda já, e volta se o servidor recusar
		const next = grades.map(x => x.id === g.id ? { ...x, show_badge: !x.show_badge } : x)
		grades = next
		busy = true
		error = ''
		const r = await apiFetch(fetch, '/instance/me/grades/display', {
			method: 'PUT', headers: auth(),
			body: JSON.stringify({ grade_ids: next.filter(x => !x.is_secret && x.show_badge).map(x => x.id) }),
		}).catch(() => null)
		busy = false
		if (!r?.ok) { grades = before; error = tFn('mybadges.error'); return }
		grades = (await r.json()).grades ?? next
		saved = true
		if (savedTimer) clearTimeout(savedTimer)
		savedTimer = setTimeout(() => (saved = false), 1800)
	}
</script>

{#if loaded && grades.length > 0}
	<div class="s-card" style="margin-top:12px">
		<div class="s-row-title" style="margin-bottom:6px">{tFn('mybadges.title')}</div>
		<p class="s-hint-text" style="margin-bottom:12px">{tFn('mybadges.desc')}</p>

		<div class="mb-list" role="group" aria-label={tFn('mybadges.title')}>
			{#each grades as g (g.id)}
				<button type="button" class="mb-chip" class:mb-off={!g.is_secret && !g.show_badge} class:mb-secret={g.is_secret}
					aria-pressed={!g.is_secret && g.show_badge} disabled={g.is_secret || busy}
					title={g.is_secret ? tFn('mybadges.secret_tip') : undefined}
					style={g.is_secret || !g.show_badge ? '' : `background:${g.color}; border-color:${g.color}; color:${tagTextColor(g.color)}`}
					onclick={() => toggle(g)}>
					{#if g.is_secret}🔒{:else if g.show_badge}✓{/if}
					{g.name}
				</button>
			{/each}
		</div>

		<p class="s-hint-text" style="margin-top:10px" role="status">
			{#if saved}{tFn('mybadges.saved')}{:else if error}<span style="color:var(--nx-bad)">{error}</span>{:else}{tFn('mybadges.hint')}{/if}
		</p>
	</div>
{/if}

<style>
	.mb-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.mb-chip {
		display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.3rem 0.75rem;
		font-size: 0.8rem; font-weight: 600; cursor: pointer; border-radius: 999px;
		border: 1px solid var(--nx-border); background: transparent; color: var(--nx-text);
		transition: opacity 0.15s;
	}
	.mb-chip.mb-off { opacity: 0.55; text-decoration: line-through; }
	.mb-chip.mb-secret { opacity: 0.7; cursor: not-allowed; border-style: dashed; }
	.mb-chip:disabled:not(.mb-secret) { cursor: progress; }
</style>
