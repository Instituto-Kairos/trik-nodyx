<script lang="ts">
	import { t } from '$lib/i18n'
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';
	import { unreadCountStore } from '$lib/socket';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { POSTS_PER_PAGE } from '$lib/forumPagination';

	const tFn = $derived($t)

	// O `Authorization` não é opcional aqui. requireAuth (core) lê SÓ o header
	// Bearer — não há repli por cookie —, então esta chamada saía sem
	// credencial e voltava 401. E o erro era invisível duas vezes: `fetch` não
	// rejeita num 401 (o `.catch` nunca disparava) e o contador já tinha sido
	// decrementado na tela. A notificação seguia não-lida no servidor e o
	// número voltava no carregamento seguinte. O ✓ ao lado nunca teve o
	// problema: passa pela form action, que roda no servidor com o cookie.
	async function markReadAndNavigate(notif: any) {
		if (!notif.is_read) {
			unreadCountStore.update(n => Math.max(0, n - 1))
			const n = notifications.find((x: any) => x.id === notif.id)
			if (n) n.is_read = true
			fetch(`/api/v1/notifications/${notif.id}/read`, {
				method:  'PATCH',
				headers: { Authorization: `Bearer ${data.token}` },
			}).catch(() => {})
		}
		goto(notifLink(notif))
	}

	let { data }: { data: PageData } = $props();

	let notifications = $state(untrack(() => (data.notifications ?? []).map((n: any) => ({ ...n }))));
	const unread = $derived(notifications.filter((n: any) => !n.is_read).length);
	const readCount = $derived(notifications.filter((n: any) => n.is_read).length);

	// `wave` faltava nos dois mapas, e os replis abaixo (`?? '🔔'` e
	// `?? notif.type`) são silenciosos: um aceno aparecia para o usuário como a
	// palavra crua « wave ». O tipo é criado desde sempre em routes/members.ts.
	const TYPE_ICON: Record<string, string> = {
		thread_reply: '💬',
		post_thanks:  '🙏',
		mention:      '@',
		wave:         '👋',
		canvas_access_request: '🎨',
		canvas_access_granted: '🎨',
	};

	const TYPE_LABEL = $derived<Record<string, string>>({
		thread_reply: tFn('notifications.thread_reply_label'),
		post_thanks:  tFn('notifications.post_thanks_label'),
		mention:      tFn('notifications.mention_label'),
		wave:         tFn('notifications.wave_label'),
		canvas_access_request: tFn('notifications.canvas_access_request_label'),
		canvas_access_granted: tFn('notifications.canvas_access_granted_label'),
	});

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			day: '2-digit', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit',
		});
	}

	// Link para a MENSAGEM que gerou a notificação, não para o topo do tópico.
	// Dois detalhes que faziam o "Ver" errar o alvo até 24/09:
	//
	//  · a âncora era `#<uuid>`, mas o elemento no DOM é `id="post-<uuid>"`
	//    (forum/[category]/[thread]/+page.svelte) — nunca casava, e o salto
	//    simplesmente não acontecia;
	//  · faltava a página. Um tópico é paginado de POSTS_PER_PAGE em
	//    POSTS_PER_PAGE, e o link caía sempre na primeira: a partir da 31ª
	//    mensagem o alvo nem estava renderizado, então não havia o que ancorar.
	//
	// `post_index` (quantos posts vêm antes, vindo do servidor) resolve a
	// página. Os slugs evitam o 301 que a página do tópico faz ao receber UUID.
	function notifLink(n: any): string {
		if (!n.category_id || !n.thread_id) return '#';

		const cat    = n.category_slug ?? n.category_id;
		const thread = n.thread_slug   ?? n.thread_id;
		let url      = `/forum/${cat}/${thread}`;

		if (typeof n.post_index === 'number') {
			const page = Math.floor(n.post_index / POSTS_PER_PAGE) + 1;
			if (page > 1) url += `?page=${page}`;
		}
		if (n.post_id) url += `#post-${n.post_id}`;
		return url;
	}
</script>

<svelte:head>
	<title>{tFn('nav.notifications')} · Nodyx</title>
</svelte:head>

<div class="max-w-2xl">
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-bold text-white">
			Notifications
			{#if unread > 0}
				<span class="ml-2 text-sm font-normal text-indigo-400">{tFn('notifications.unread_count', { n: String(unread), s: unread > 1 ? 's' : '' })}</span>
			{/if}
		</h1>
		<div class="flex items-center gap-2">
			{#if unread > 0}
				<form method="POST" action="?/markAllRead" use:enhance={() => {
					return async ({ update }) => {
						unreadCountStore.set(0)
						notifications = notifications.map((n: any) => ({ ...n, is_read: true }))
						await update({ reset: false })
					}
				}}>
					<button type="submit"
						class="px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
						Tout marquer comme lu
					</button>
				</form>
			{/if}
			{#if readCount > 0}
				<form method="POST" action="?/clearRead" use:enhance={() => {
					return async ({ update }) => {
						notifications = notifications.filter((n: any) => !n.is_read)
						await update({ reset: false })
					}
				}}>
					<button type="submit"
						class="px-3 py-1.5 rounded-lg border border-red-900/50 text-xs text-red-500/70 hover:text-red-400 hover:border-red-700 transition-colors">
						{tFn('notifications.clear_read')}
					</button>
				</form>
			{/if}
		</div>
	</div>

	<!-- Info purge automatique -->
	<p class="text-xs text-gray-600 mb-4">{tFn('notifications.auto_purge_info')}</p>

	{#if notifications.length === 0}
		<div class="rounded-xl border border-gray-800 bg-gray-900/50 px-6 py-12 text-center">
			<p class="text-gray-500">{tFn('notifications.empty_state')}</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each notifications as notif}
				<div class="flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors
					{notif.is_read
						? 'border-gray-800 bg-gray-900/30'
						: 'border-indigo-900/50 bg-indigo-950/20'}">

					<!-- Icon -->
					<div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base
						{notif.is_read ? 'bg-gray-800' : 'bg-indigo-900/40'}">
						{TYPE_ICON[notif.type] ?? '🔔'}
					</div>

					<!-- Content -->
					<div class="flex-1 min-w-0">
						<p class="text-sm text-gray-300">
							{#if notif.actor_username}
								<span class="font-semibold text-white">{notif.actor_username}</span>
							{/if}
							{TYPE_LABEL[notif.type] ?? notif.type}
							{#if notif.thread_title}
								<span class="text-gray-400"> « {notif.thread_title} »</span>
							{/if}
						</p>
						<p class="text-xs text-gray-600 mt-0.5">{formatDate(notif.created_at)}</p>
					</div>

					<!-- Actions -->
					<div class="flex items-center gap-2 shrink-0">
						{#if notif.category_id && notif.thread_id}
							<button
								onclick={() => markReadAndNavigate(notif)}
								class="text-xs text-indigo-400 hover:text-indigo-300">
								{tFn('notifications.view')}
							</button>
						{/if}
						{#if !notif.is_read}
							<form method="POST" action="?/markRead" use:enhance={() => {
								return async ({ update }) => {
									unreadCountStore.update(n => Math.max(0, n - 1))
									const n = notifications.find((x: any) => x.id === notif.id)
									if (n) n.is_read = true
									await update({ reset: false })
								}
							}}>
								<input type="hidden" name="id" value={notif.id} />
								<button type="submit" title={tFn('notifications.mark_read')}
									class="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-colors bg-gray-800 text-gray-500 hover:bg-indigo-900/40 hover:text-indigo-300">
									✓
								</button>
							</form>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
