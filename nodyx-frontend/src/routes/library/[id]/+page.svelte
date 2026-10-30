<script lang="ts">
	import type { PageData } from './$types'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { p2pManager, p2pAssetPeers } from '$lib/p2p'
	import { t, locale } from '$lib/i18n'
	import { browser } from '$app/environment'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()
	const asset = $derived(data.asset)
	const me    = $derived((page.data as any).user)

	const TYPE_ICONS: Record<string, string> = {
		frame: '🖼️', banner: '🎨', badge: '🏅', sticker: '⭐',
		font: '🔤', theme: '🎭', emoji: '😀', sound: '🔊',
	}

	// Emoji : raccourci texte (:shortcode:) — perso (metadata) sinon dérivé du nom
	const emojiShortcode = $derived(
		asset.asset_type === 'emoji'
			? ((asset.metadata as { shortcode?: string } | null)?.shortcode
				|| asset.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
			: ''
	)
	let copiedCode = $state(false)
	function copyShortcode() {
		navigator.clipboard?.writeText(`:${emojiShortcode}:`).then(() => {
			copiedCode = true
			setTimeout(() => (copiedCode = false), 1200)
		}).catch(() => {})
	}
	// Token from layout data (HttpOnly cookie — not accessible via document.cookie)
	const token = $derived((page.data as any).token as string | null)

	let downloadSource = $state<'server' | 'p2p' | null>(null)

	const p2pAvailable = $derived(browser && $p2pAssetPeers.has(asset.id))

	function fileUrl(path: string) {
		return `${PUBLIC_API_URL.replace('/api/v1', '')}/uploads/${path}`
	}

	function formatDate(d: string) {
		return new Intl.DateTimeFormat($locale, { dateStyle: 'long' }).format(new Date(d))
	}

	async function downloadAsset() {
		const filename = asset.original_filename ?? `${asset.name}.${asset.mime_type?.split('/')[1] ?? 'webp'}`
		let buffer: ArrayBuffer | null = null

		// Try P2P first if a peer has it
		if (p2pAvailable) {
			buffer = await p2pManager.requestAsset(asset.id)
			if (buffer) downloadSource = 'p2p'
		}

		// Fallback: fetch from server, then announce to peers
		if (!buffer) {
			const res = await fetch(fileUrl(asset.file_path))
			buffer = await res.arrayBuffer()
			downloadSource = 'server'
			p2pManager.announceAsset(asset.id, buffer)
		}

		const blob = new Blob([buffer], { type: asset.mime_type ?? 'application/octet-stream' })
		const url  = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href     = url
		link.download = filename
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 10_000)
		setTimeout(() => { downloadSource = null }, 4000)
	}

	let whispering = $state(false)

	async function startWhisper() {
		if (!me || !token) { goto('/auth/login'); return }
		whispering = true
		const res = await fetch(`${PUBLIC_API_URL}/api/v1/whispers`, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body:    JSON.stringify({
				context_type:  'asset',
				context_id:    asset.id,
				context_label: asset.name,
				name:          `🤫 ${asset.name}`,
			}),
		})
		whispering = false
		if (res.ok) {
			const { room } = await res.json()
			goto(`/whisper/${room.id}`)
		}
	}
</script>

<svelte:head>
	<title>{tFn('library.detail_title', { name: asset.name })}</title>
</svelte:head>

<div class="max-w-3xl mx-auto px-4 py-8">
	<a href="/library" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 mb-6 transition-colors">
		{tFn('library.back_to')}
	</a>

	<div class="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
		<!-- Preview -->
		{#if asset.mime_type?.startsWith('image/')}
			<div class="bg-gray-950 flex items-center justify-center min-h-40 p-8">
				<img src={fileUrl(asset.file_path)} alt={asset.name}
					class="max-h-64 max-w-full rounded-lg shadow-xl" />
			</div>
		{:else if asset.mime_type?.startsWith('audio/')}
			<div class="bg-gray-950 p-6">
				<nodyx-audio-player
					src={fileUrl(asset.file_path)}
					track-title={asset.name}
					download="1"
				></nodyx-audio-player>
			</div>
		{:else}
			<div class="bg-gray-950 flex items-center justify-center min-h-40 text-5xl">
				{TYPE_ICONS[asset.asset_type] ?? '📦'}
			</div>
		{/if}

		<!-- Info -->
		<div class="p-6">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h1 class="text-xl font-bold text-white">{asset.name}</h1>
					<p class="text-sm text-gray-500 mt-0.5">
						{TYPE_ICONS[asset.asset_type]} {asset.asset_type}
						&nbsp;·&nbsp; {(asset.file_size / 1024).toFixed(1)} Ko
						&nbsp;·&nbsp; {asset.downloads !== 1 ? tFn('library.downloads_many', { count: asset.downloads }) : tFn('library.downloads_one', { count: asset.downloads })}
					</p>
					{#if emojiShortcode}
						<button onclick={copyShortcode} title={copiedCode ? tFn('library.copied') : tFn('library.copy_shortcode')}
							class="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm bg-white/[0.06] border border-white/10 hover:border-white/25 transition-colors">
							<span class="font-mono" style="color: var(--nx-accent-soft)">:{emojiShortcode}:</span>
							<span style="color: {copiedCode ? '#4ade80' : '#6b7280'}">{copiedCode ? '✓' : '⧉'}</span>
						</button>
					{/if}
				</div>
				<div class="flex gap-2 shrink-0">
					<button
						onclick={downloadAsset}
						class="relative px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors
						       {p2pAvailable ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-indigo-600 hover:bg-indigo-500'}"
						title={p2pAvailable ? tFn('library.p2p_available') : tFn('library.download_server')}
					>
						{#if p2pAvailable}⚡{/if} {tFn('library.download')}
						{#if downloadSource === 'p2p'}
							<span class="absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full bg-yellow-400 text-yellow-900 text-[9px] font-black leading-none">P2P</span>
						{:else if downloadSource === 'server'}
							<span class="absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full bg-gray-600 text-gray-300 text-[9px] font-black leading-none">srv</span>
						{/if}
					</button>
				</div>
			</div>

			{#if asset.description}
				<p class="mt-4 text-sm text-gray-300 leading-relaxed">{asset.description}</p>
			{/if}

			{#if asset.tags?.length}
				<div class="mt-4 flex flex-wrap gap-1.5">
					{#each asset.tags as tag}
						<span class="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-400">#{tag}</span>
					{/each}
				</div>
			{/if}

			<p class="mt-4 text-xs text-gray-600">{tFn('library.shared_on', { date: formatDate(asset.created_at) })}</p>
		</div>
	</div>
</div>
