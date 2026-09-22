<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let avatarUrl  = $state((data.bot as any)?.avatarUrl ?? '');
	let bio        = $state((data.bot as any)?.bio ?? '');
	let uploading  = $state(false);
	let uploadError = $state<string | null>(null);

	async function handleAvatarFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const token = (page.data as any).token as string | null;
		if (!token) return;

		uploading   = true;
		uploadError = null;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch('/api/v1/admin/trik/bot/avatar', {
				method:  'POST',
				headers: { Authorization: `Bearer ${token}` },
				body:    fd,
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				uploadError = body.error ?? 'Erro ao enviar imagem';
				return;
			}
			avatarUrl = (await res.json()).url;
		} finally {
			uploading = false;
		}
	}
</script>

<svelte:head><title>RPG — Bot</title></svelte:head>

<div>
	<h1 class="text-2xl font-bold text-white mb-1">Módulo RPG — Bot</h1>
	<p class="text-sm text-gray-500 mb-6">
		Personalize o avatar e a descrição do bot "Trik" — é ele que posta as confirmações de
		/registro e /plaquinha no chat.
	</p>

	{#if form?.error}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300 mb-4">
			{form.error}
		</div>
	{/if}
	{#if form?.ok}
		<div class="rounded-lg border border-emerald-800 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300 mb-4">
			Salvo.
		</div>
	{/if}
	{#if uploadError}
		<div class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300 mb-4">
			{uploadError}
		</div>
	{/if}

	<form method="POST" action="?/save" use:enhance class="space-y-5 max-w-lg">
		<input type="hidden" name="avatarUrl" value={avatarUrl} />

		<div class="flex items-center gap-4">
			{#if avatarUrl}
				<img src={avatarUrl} alt="" class="w-16 h-16 rounded-full object-cover border border-gray-700" />
			{:else}
				<div class="w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-xl font-bold">
					T
				</div>
			{/if}
			<label
				class="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white cursor-pointer hover:bg-gray-700 transition-colors"
			>
				{uploading ? 'Enviando…' : 'Trocar avatar'}
				<input
					type="file"
					accept="image/jpeg,image/png,image/webp,image/gif"
					class="hidden"
					onchange={handleAvatarFile}
					disabled={uploading}
				/>
			</label>
		</div>

		<div>
			<p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">Descrição</p>
			<textarea
				name="bio"
				bind:value={bio}
				maxlength="500"
				rows="3"
				placeholder="Bot do módulo RPG. Confirma /registro e /plaquinha no canal."
				class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
			></textarea>
		</div>

		<button
			type="submit"
			disabled={uploading}
			class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium text-white transition-colors"
		>
			Salvar
		</button>
	</form>
</div>
