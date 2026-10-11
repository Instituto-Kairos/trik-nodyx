<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation'
	import { apiFetch } from '$lib/api'
	import { t, locale } from '$lib/i18n'
	import { fmtDate, fmtTime } from '$lib/datetime'
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte'

	const tFn = $derived($t)

	let { data } = $props()

	interface Album { id: string; name: string }

	interface Imagem {
		id: string
		album_id: string | null
		album_name: string | null
		title: string
		description: string | null   // HTML já sanitizado no servidor
		file_path: string
		width: number | null
		height: number | null
		tags: string[]
		uploader_id: string | null
		uploader_username: string | null
		created_at: string
	}

	interface Nota {
		id: string
		author_id: string | null
		author_username: string | null
		content: string   // HTML já sanitizado no servidor
		created_at: string
		updated_at: string
	}

	const img    = $derived(data.image as Imagem)
	const notas  = $derived(data.notes as Nota[])
	const albums = $derived(data.albums as Album[])
	const auth   = $derived({ Authorization: `Bearer ${data.token}` })

	// Espelha a autorização do backend só para decidir o que aparece; quem
	// decide de verdade continua sendo o servidor.
	const ehAdmin = $derived(data.user?.role === 'owner' || data.user?.role === 'admin')
	const ehDono  = $derived(!!data.user && !!img.uploader_id && img.uploader_id === data.user.id)
	const podeEditar = $derived(ehDono || ehAdmin)

	// Caminho relativo, não API_URL: ver o comentário em ../+page.svelte.
	const urlCheia = $derived(`/uploads/${img.file_path}`)

	const quando = (iso: string) => `${fmtDate(iso, $locale)} · ${fmtTime(iso, $locale)}`

	// ── Edição do post ────────────────────────────────────────────────────────
	let editando    = $state(false)
	let edTitulo    = $state('')
	let edDescricao = $state('')
	let edAlbum     = $state('')
	let edTags      = $state('')
	let salvando    = $state(false)
	let erroEdicao  = $state('')

	function abrirEdicao() {
		edTitulo    = img.title
		edDescricao = img.description ?? ''
		edAlbum     = img.album_id ?? ''
		edTags      = img.tags.join(', ')
		erroEdicao  = ''
		editando    = true
	}

	async function salvarEdicao() {
		if (!edTitulo.trim() || salvando) return
		salvando   = true
		erroEdicao = ''
		try {
			const res = await apiFetch(fetch, `/galeria/images/${img.id}`, {
				method: 'PATCH',
				headers: auth,
				body: JSON.stringify({
					title:       edTitulo.trim(),
					description: edDescricao.trim() ? edDescricao : null,
					album_id:    edAlbum || null,
					tags:        edTags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12),
				}),
			})
			if (!res.ok) {
				const j = await res.json().catch(() => ({}))
				throw new Error(j.error ?? tFn('galeria.save_error'))
			}
			await invalidateAll()
			editando = false
		} catch (e) {
			erroEdicao = e instanceof Error ? e.message : tFn('galeria.save_error')
		} finally {
			salvando = false
		}
	}

	async function apagarImagem() {
		if (!confirm(tFn('galeria.delete_confirm'))) return
		const res = await apiFetch(fetch, `/galeria/images/${img.id}`, { method: 'DELETE', headers: auth })
		if (res.ok) goto('/galeria')
	}

	// ── Anotações ─────────────────────────────────────────────────────────────
	let novaNota     = $state('')
	let editorChave  = $state(0)   // trocar a chave remonta o editor vazio
	let enviandoNota = $state(false)
	let erroNota     = $state('')

	async function publicarNota() {
		if (!novaNota.trim() || enviandoNota) return
		enviandoNota = true
		erroNota     = ''
		try {
			const res = await apiFetch(fetch, `/galeria/images/${img.id}/notes`, {
				method: 'POST',
				headers: auth,
				body: JSON.stringify({ content: novaNota }),
			})
			if (!res.ok) {
				const j = await res.json().catch(() => ({}))
				throw new Error(j.error ?? tFn('galeria.save_error'))
			}
			novaNota = ''
			editorChave++
			await invalidateAll()
		} catch (e) {
			erroNota = e instanceof Error ? e.message : tFn('galeria.save_error')
		} finally {
			enviandoNota = false
		}
	}

	let notaEditando = $state<string | null>(null)
	let notaTexto    = $state('')
	let erroNotaEd   = $state('')

	function editarNota(n: Nota) {
		notaEditando = n.id
		notaTexto    = n.content
		erroNotaEd   = ''
	}

	async function salvarNota() {
		if (!notaEditando || !notaTexto.trim()) return
		const res = await apiFetch(fetch, `/galeria/notes/${notaEditando}`, {
			method: 'PATCH',
			headers: auth,
			body: JSON.stringify({ content: notaTexto }),
		})
		if (!res.ok) {
			const j = await res.json().catch(() => ({}))
			erroNotaEd = j.error ?? tFn('galeria.save_error')
			return
		}
		notaEditando = null
		await invalidateAll()
	}

	async function apagarNota(id: string) {
		if (!confirm(tFn('galeria.note_delete_confirm'))) return
		const res = await apiFetch(fetch, `/galeria/notes/${id}`, { method: 'DELETE', headers: auth })
		if (res.ok) await invalidateAll()
	}
</script>

<svelte:head>
	<title>{img.title} · {tFn('galeria.page_title')}</title>
</svelte:head>

<div class="gp-root">
	<a href="/galeria{img.album_id ? `?album=${img.album_id}` : ''}" class="gp-back">
		← {img.album_name ?? tFn('galeria.title')}
	</a>

	<!-- Desktop: imagem à esquerda (fixa ao rolar), post e anotações à direita.
	     Telefone: uma coluna só, anotações embaixo. -->
	<div class="gp-layout">
	<!-- ── Imagem ──────────────────────────────────────────────────────────── -->
	<figure class="gp-figure">
		<a href={urlCheia} target="_blank" rel="noopener" title={tFn('galeria.open_full')}>
			<img src={urlCheia} alt={img.title} class="gp-img"
			     width={img.width ?? undefined} height={img.height ?? undefined} />
		</a>
	</figure>

	<div class="gp-col">
		<!-- ── Cabeçalho do post ───────────────────────────────────────────── -->
		{#if editando}
			<section class="gp-card gp-stack">
				<input type="text" bind:value={edTitulo} maxlength="160"
				       placeholder={tFn('galeria.title_ph')} class="gp-input" />
				<div class="gp-editor">
					<NodyxEditor
						compact={true}
						initialContent={img.description ?? ''}
						placeholder={tFn('galeria.description_ph')}
						onchange={(v) => (edDescricao = v)}
					/>
				</div>
				<div class="gp-row">
					<select bind:value={edAlbum} class="gp-input">
						<option value="">{tFn('galeria.no_album')}</option>
						{#each albums as a}<option value={a.id}>{a.name}</option>{/each}
					</select>
					<input type="text" bind:value={edTags} placeholder={tFn('galeria.tags_ph')} class="gp-input" />
				</div>
				{#if erroEdicao}<p class="gp-error">{erroEdicao}</p>{/if}
				<div class="gp-row gp-row--end">
					<button type="button" class="gp-btn-ghost" onclick={() => (editando = false)}>{tFn('common.cancel')}</button>
					<button type="button" class="gp-btn-primary" disabled={!edTitulo.trim() || salvando} onclick={salvarEdicao}>
						{salvando ? tFn('galeria.saving') : tFn('common.save')}
					</button>
				</div>
			</section>
		{:else}
			<header class="gp-head">
				<h1 class="gp-title">{img.title}</h1>
				<p class="gp-meta">
					{img.uploader_username ?? '—'} · {quando(img.created_at)}
					{#if img.album_name}
						· <a href="/galeria?album={img.album_id}" class="gp-link">{img.album_name}</a>
					{/if}
				</p>
			</header>

			{#if img.description}
				<!-- HTML sanitizado no servidor com o mesmo sanitize do fórum. -->
				<div class="nodyx-prose gp-desc">{@html img.description}</div>
			{/if}

			{#if img.tags.length}
				<p class="gp-tags">
					{#each img.tags as tg}<a href="/galeria?tag={encodeURIComponent(tg)}" class="gp-tag">#{tg}</a>{/each}
				</p>
			{/if}

			{#if podeEditar}
				<div class="gp-row gp-actions">
					<button type="button" class="gp-btn-ghost" onclick={abrirEdicao}>{tFn('common.edit')}</button>
					<button type="button" class="gp-btn-danger" onclick={apagarImagem}>{tFn('common.delete')}</button>
				</div>
			{/if}
		{/if}

		<!-- ── Anotações ───────────────────────────────────────────────────── -->
		<section class="gp-notes">
			<h2 class="gp-notes-title">{tFn('galeria.notes_title')}</h2>

			{#if notas.length === 0}
				<p class="gp-notes-empty">
					{ehDono ? tFn('galeria.notes_empty_owner') : tFn('galeria.notes_empty')}
				</p>
			{:else}
				<ol class="gp-timeline">
					{#each notas as n (n.id)}
						<li class="gp-note">
							<span class="gp-dot" aria-hidden="true"></span>
							<p class="gp-note-when">
								{quando(n.created_at)}
								{#if n.updated_at !== n.created_at}<span class="gp-edited">· {tFn('galeria.note_edited')}</span>{/if}
							</p>
							{#if notaEditando === n.id}
								<div class="gp-editor">
									<NodyxEditor compact={true} initialContent={n.content} onchange={(v) => (notaTexto = v)} />
								</div>
								{#if erroNotaEd}<p class="gp-error">{erroNotaEd}</p>{/if}
								<div class="gp-row gp-row--end">
									<button type="button" class="gp-btn-ghost" onclick={() => (notaEditando = null)}>{tFn('common.cancel')}</button>
									<button type="button" class="gp-btn-primary" disabled={!notaTexto.trim()} onclick={salvarNota}>{tFn('common.save')}</button>
								</div>
							{:else}
								<div class="nodyx-prose gp-note-body">{@html n.content}</div>
								{#if (data.user && n.author_id === data.user.id) || ehAdmin}
									<div class="gp-note-actions">
										{#if data.user && n.author_id === data.user.id}
											<button type="button" class="gp-mini" onclick={() => editarNota(n)}>{tFn('common.edit')}</button>
										{/if}
										<button type="button" class="gp-mini gp-mini--danger" onclick={() => apagarNota(n.id)}>{tFn('common.delete')}</button>
									</div>
								{/if}
							{/if}
						</li>
					{/each}
				</ol>
			{/if}

			{#if ehDono}
				<div class="gp-compose">
					<div class="gp-editor">
						{#key editorChave}
							<NodyxEditor compact={true} placeholder={tFn('galeria.note_ph')} onchange={(v) => (novaNota = v)} />
						{/key}
					</div>
					{#if erroNota}<p class="gp-error">{erroNota}</p>{/if}
					<div class="gp-row gp-row--end">
						<button type="button" class="gp-btn-primary" disabled={!novaNota.trim() || enviandoNota} onclick={publicarNota}>
							{enviandoNota ? tFn('galeria.saving') : tFn('galeria.note_add')}
						</button>
					</div>
				</div>
			{/if}
		</section>
	</div>
	</div>
</div>

<style>
.gp-root { padding: 1.5rem; max-width: 1440px; margin: 0 auto; }
.gp-back { display: inline-block; font-size: 0.8125rem; color: rgba(255,255,255,0.5); text-decoration: none; margin-bottom: 1rem; }
.gp-back:hover { color: #fff; }

/* Duas colunas: a imagem fica com a maior parte e acompanha a rolagem
   (sticky), para continuar à vista enquanto se lê uma linha do tempo longa. */
.gp-layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(340px, 1fr); gap: 1.75rem; align-items: start; }

/* A imagem é o assunto: fundo escuro, sem cortar. */
.gp-figure {
	margin: 0; background: #000; border-radius: 0.875rem; overflow: hidden;
	display: flex; justify-content: center;
	position: sticky; top: 1rem;
}
.gp-img { display: block; max-width: 100%; max-height: calc(100vh - 6rem); width: auto; height: auto; object-fit: contain; cursor: zoom-in; }

.gp-col { min-width: 0; display: flex; flex-direction: column; gap: 1rem; }

.gp-title { font-size: 1.5rem; font-weight: 800; color: #fff; line-height: 1.25; }
.gp-meta  { font-size: 0.8125rem; color: rgba(255,255,255,0.45); margin-top: 0.25rem; }
.gp-link  { color: rgb(var(--nx-accent-rgb)); text-decoration: none; }
.gp-desc  { font-size: 0.9375rem; color: rgba(255,255,255,0.8); }
.gp-tags  { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.gp-tag   { font-size: 0.75rem; color: rgb(var(--nx-accent-rgb)); background: rgb(var(--nx-accent-rgb) / 0.12); border-radius: 9999px; padding: 0.125rem 0.5rem; text-decoration: none; }
.gp-actions { justify-content: flex-end; }

.gp-card  { border: 1px solid rgba(255,255,255,0.1); border-radius: 0.75rem; padding: 1rem; background: rgba(255,255,255,0.02); }
.gp-stack { display: flex; flex-direction: column; gap: 0.625rem; }
.gp-row   { display: flex; gap: 0.5rem; align-items: center; }
.gp-row--end { justify-content: flex-end; }
.gp-input {
	background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
	border-radius: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.8125rem; color: #fff; min-width: 0; flex: 1;
}
.gp-input:focus { outline: none; border-color: rgb(var(--nx-accent-rgb) / 0.6); }
.gp-editor { border: 1px solid rgba(255,255,255,0.1); border-radius: 0.5rem; overflow: hidden; }
.gp-error  { font-size: 0.75rem; color: rgb(248 113 113); }

.gp-btn-primary {
	background: rgb(var(--nx-accent-rgb) / 0.9); color: #fff; border: 0; border-radius: 0.5rem;
	padding: 0.5rem 1rem; font-size: 0.8125rem; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.gp-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.gp-btn-ghost  { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); border: 0; border-radius: 0.5rem; padding: 0.5rem 1rem; font-size: 0.8125rem; cursor: pointer; }
.gp-btn-danger { background: rgba(239,68,68,0.15); color: rgb(248 113 113); border: 0; border-radius: 0.5rem; padding: 0.5rem 1rem; font-size: 0.8125rem; cursor: pointer; }

/* ── Linha do tempo ──────────────────────────────────────────────────────── */
.gp-notes { margin-top: 1rem; padding-top: 1.25rem; border-top: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; gap: 1rem; }
.gp-notes-title { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.45); }
.gp-notes-empty { font-size: 0.8125rem; color: rgba(255,255,255,0.35); }

.gp-timeline { list-style: none; margin: 0; padding: 0 0 0 1.25rem; border-left: 2px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; gap: 1.5rem; }
.gp-note { position: relative; display: flex; flex-direction: column; gap: 0.375rem; }
.gp-dot {
	position: absolute; left: calc(-1.25rem - 6px); top: 0.25rem;
	width: 10px; height: 10px; border-radius: 9999px;
	background: rgb(var(--nx-accent-rgb)); box-shadow: 0 0 0 3px var(--p-bg, #0b0f19);
}
.gp-note-when { font-size: 0.6875rem; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; }
.gp-edited    { font-style: italic; }
.gp-note-body { font-size: 0.875rem; color: rgba(255,255,255,0.8); }
.gp-note-actions { display: flex; gap: 0.75rem; }
.gp-mini { background: none; border: 0; padding: 0; font-size: 0.6875rem; color: rgba(255,255,255,0.4); cursor: pointer; }
.gp-mini:hover { color: #fff; }
.gp-mini--danger:hover { color: rgb(248 113 113); }

.gp-compose { display: flex; flex-direction: column; gap: 0.5rem; }

@media (max-width: 860px) {
	.gp-root { padding: 1rem; }
	.gp-layout { grid-template-columns: 1fr; gap: 1.25rem; }
	.gp-figure { position: static; }
	.gp-figure { margin-left: -1rem; margin-right: -1rem; border-radius: 0; }
	.gp-img { max-height: 60vh; }
	.gp-row { flex-wrap: wrap; }
}
</style>
