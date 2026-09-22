<script lang="ts">
	/**
	 * Widget compacto pro bot "Trik" — foto, nome e descrição, sem os
	 * campos de MiniProfileCard.svelte (nível/XP/grade/tags) que não fazem
	 * sentido pra um usuário de sistema. Mesma lógica de posicionamento por
	 * anchorEl que o MiniProfileCard, deliberadamente sem "ver perfil
	 * completo" (bot não tem página de perfil navegável de verdade).
	 */
	import { onMount } from 'svelte'
	import { browser } from '$app/environment'

	interface Props {
		token: string
		anchorEl?: HTMLElement | null
		onclose: () => void
	}
	let { token, anchorEl = null, onclose }: Props = $props()

	type BotProfile = { username: string; avatarUrl: string | null; bio: string | null }

	let profile = $state<BotProfile | null>(null)
	let loading = $state(true)
	let cardEl  = $state<HTMLDivElement | null>(null)

	let cardStyle = $state('top:50%;left:50%;transform:translate(-50%,-50%)')

	function computePosition() {
		if (!browser || !cardEl) return
		if (!anchorEl) {
			cardStyle = 'top:50%;left:50%;transform:translate(-50%,-50%)'
			return
		}
		const rect = anchorEl.getBoundingClientRect()
		const vw   = window.innerWidth
		const vh   = window.innerHeight
		const CARD_W = 240
		const CARD_H = 140

		let left = rect.right + 8
		if (left + CARD_W > vw - 8) left = rect.left - CARD_W - 8
		if (left < 8) left = 8

		let top = rect.top
		if (top + CARD_H > vh - 8) top = vh - CARD_H - 8
		if (top < 8) top = 8

		cardStyle = `top:${top}px;left:${left}px`
	}

	onMount(async () => {
		if (!browser) return
		try {
			const { PUBLIC_API_URL } = await import('$env/static/public')
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/trik/bot`, {
				headers: { Authorization: `Bearer ${token}` }
			})
			if (res.ok) profile = (await res.json()).bot ?? null
		} catch { /* ignore */ } finally {
			loading = false
		}
		setTimeout(computePosition, 0)
	})

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose()
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-[200]" role="button" tabindex="-1" aria-label="Fechar" onclick={onclose}></div>

<div
	bind:this={cardEl}
	class="fixed z-[201] w-[240px] rounded-2xl border border-gray-700/80 bg-gray-900 shadow-2xl shadow-black/60 p-4"
	style={cardStyle}
	role="dialog"
	aria-modal="true"
	aria-label="Perfil do bot Trik"
>
	{#if loading}
		<div class="flex items-center gap-3 animate-pulse">
			<div class="w-12 h-12 rounded-full bg-gray-700 shrink-0"></div>
			<div class="flex-1 space-y-2">
				<div class="h-3 bg-gray-700 rounded w-3/4"></div>
				<div class="h-2 bg-gray-800 rounded w-1/2"></div>
			</div>
		</div>
	{:else if profile}
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-full overflow-hidden bg-indigo-700 shrink-0">
				{#if profile.avatarUrl}
					<img src={profile.avatarUrl} alt="" class="w-full h-full object-cover" />
				{:else}
					<div class="w-full h-full flex items-center justify-center text-white text-lg font-bold select-none">
						{profile.username.charAt(0).toUpperCase()}
					</div>
				{/if}
			</div>
			<div class="min-w-0">
				<p class="text-sm font-bold text-white truncate">{profile.username}</p>
				<p class="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">Bot</p>
			</div>
		</div>
		{#if profile.bio}
			<p class="mt-3 text-xs text-gray-400 leading-snug">{profile.bio}</p>
		{/if}
	{:else}
		<div class="text-center text-xs text-gray-600 py-2">Não encontrado</div>
	{/if}
</div>
