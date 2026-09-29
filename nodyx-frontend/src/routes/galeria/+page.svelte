<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation'
	import { untrack } from 'svelte'
	// API_URL vem de $lib/api (que já resolve a base conforme SSR/browser), em vez
	// de importar $env/static/public aqui: é o helper padrão do repo.
	import { apiFetch, API_URL } from '$lib/api'
	import { t } from '$lib/i18n'
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte'

	const tFn = $derived($t)

	let { data } = $props()

	interface Album {
		id: string
		name: string
		slug: string
		description: string | null
		image_count: number
		cover_thumb: string | null
	}

	interface Imagem {
		id: string
		album_id: string | null
		album_name: string | null
		title: string
		description: string | null   // HTML já sanitizado no servidor
		file_path: string
		thumbnail_path: string | null
		width: number | null
		height: number | null
		tags: string[]
		uploader_username: string | null
		created_at: string
	}

	const albums = $derived(data.albums as Album[])
	const images = $derived(data.images as Imagem[])

	// O backend serve os arquivos estáticos em /uploads, fora do prefixo da API,
	// e tanto o Caddy (`handle /uploads/*`) quanto o proxy do Vite em dev mandam
	// esse caminho pro backend. Então o caminho RELATIVO é o que vale aqui.
	//
	// Não derive isto de API_URL: ele é resolvido no import e, em SSR, vale
	// `http://127.0.0.1:3000` (o backend local, endereço interno). Essas URLs
	// entram no HTML renderizado no servidor e o NAVEGADOR é que vai buscá-las —
	// resultado, em produção: "Mixed Content" na página HTTPS e bloqueio pela CSP
	// (`img-src 'self' data: blob: https:` recusa http:// num IP). As imagens da
	// galeria não carregavam nada. API_URL só serve para o próprio código buscar
	// a API; nunca para montar endereço que o navegador vai resolver.
	const urlThumb = (i: Imagem) => `/uploads/${i.thumbnail_path ?? i.file_path}`
	const urlCheia = (i: Imagem) => `/uploads/${i.file_path}`

	// Valor inicial do campo de busca: leitura deliberada, não deve reagir.
	let busca = $state(untrack(() => (data.q ?? '') as string))

	function navegar(patch: Record<string, string>) {
		const p = new URLSearchParams()
		const atual: Record<string, string> = {
			album: data.album ?? '', q: busca, tag: data.tag ?? '',
			offset: String(data.offset ?? 0), ...patch,
		}
		for (const [k, v] of Object.entries(atual)) {
			if (!v) continue
			if (k === 'offset' && v === '0') continue   // 1ª página → URL limpa
			p.set(k, v)
		}
		goto(`/galeria${p.toString() ? `?${p}` : ''}`, { keepFocus: true })
	}

	/**
	 * Trocar de álbum, de busca ou de tag SEMPRE volta à primeira página.
	 * Sem isto, filtrar estando na página 3 cairia num offset além do fim do novo
	 * resultado — uma galeria "vazia" que na verdade tem imagens.
	 */
	function aplicarFiltro(patch: Record<string, string>) {
		navegar({ ...patch, offset: '0' })
	}

	// ── Paginação ─────────────────────────────────────────────────────────────
	const limite  = $derived((data.limite ?? 40) as number)
	const offset  = $derived((data.offset ?? 0) as number)
	const total   = $derived((data.total ?? 0) as number)
	const temAnterior = $derived(offset > 0)
	const temProxima  = $derived(offset + images.length < total)
	// "41–80" — 1-based, porque nenhum humano conta imagens a partir do zero.
	const faixa = $derived(
		images.length ? `${offset + 1}–${offset + images.length}` : '0',
	)

	function paginar(delta: number) {
		navegar({ offset: String(Math.max(0, offset + delta * limite)) })
		// Uma nova página é um novo conjunto; manter o visualizador aberto
		// mostraria uma imagem que já não está na lista navegável por setas.
		fecharVisualizador()
	}

	// ── Visualizador ──────────────────────────────────────────────────────────
	let aberta = $state<Imagem | null>(null)

	function aoTeclar(e: KeyboardEvent) {
		if (!aberta) return
		// Editando, as setas movem o cursor nos campos — trocar de imagem aqui
		// jogaria fora o que foi digitado. Esc só fecha a edição.
		if (editando) { if (e.key === 'Escape') editando = false; return }
		if (e.key === 'Escape') { aberta = null; return }
		const i = images.findIndex((x) => x.id === aberta!.id)
		if (e.key === 'ArrowRight' && i < images.length - 1) aberta = images[i + 1]
		if (e.key === 'ArrowLeft'  && i > 0)                 aberta = images[i - 1]
	}

	// ── Envio ─────────────────────────────────────────────────────────────────
	let mostrarEnvio = $state(false)
	let arquivo      = $state<File | null>(null)
	let previa       = $state<string | null>(null)
	let titulo       = $state('')
	let descricao    = $state('')
	let albumAlvo    = $state('')
	let tags         = $state('')
	let enviando     = $state(false)
	let erro         = $state('')

	function escolherArquivo(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0] ?? null
		arquivo = f
		if (previa) URL.revokeObjectURL(previa)
		previa = f ? URL.createObjectURL(f) : null
		// Título sugerido pelo nome do arquivo, sem a extensão — quase sempre é
		// o que a pessoa ia digitar.
		if (f && !titulo) titulo = f.name.replace(/\.[^.]+$/, '').slice(0, 160)
	}

	function limparEnvio() {
		if (previa) URL.revokeObjectURL(previa)
		arquivo = null; previa = null; titulo = ''; descricao = ''
		tags = ''; erro = ''; mostrarEnvio = false
	}

	async function enviar() {
		if (!arquivo || !titulo.trim() || enviando) return
		enviando = true
		erro = ''
		try {
			const fd = new FormData()
			fd.append('title', titulo.trim())
			if (descricao.trim()) fd.append('description', descricao)
			if (albumAlvo)        fd.append('album_id', albumAlvo)
			if (tags.trim())      fd.append('tags', tags.trim())
			fd.append('file', arquivo)

			// FormData vai no fetch cru: apiFetch põe Content-Type JSON quando há
			// body, o que quebraria o boundary do multipart.
			const res = await fetch(`${API_URL}/galeria/images`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${data.token}` },
				body: fd,
			})
			if (!res.ok) {
				const j = await res.json().catch(() => ({}))
				throw new Error(j.error ?? tFn('galeria.upload_error'))
			}
			limparEnvio()
			await invalidateAll()
		} catch (e) {
			erro = e instanceof Error ? e.message : tFn('galeria.upload_error')
		} finally {
			enviando = false
		}
	}

	// ── Álbuns ────────────────────────────────────────────────────────────────
	let novoAlbum = $state('')
	let criando   = $state(false)

	async function criarAlbum() {
		const nome = novoAlbum.trim()
		if (!nome || criando) return
		criando = true
		try {
			const res = await apiFetch(fetch, '/galeria/albums', {
				method: 'POST',
				headers: { Authorization: `Bearer ${data.token}` },
				body: JSON.stringify({ name: nome }),
			})
			if (res.ok) { novoAlbum = ''; await invalidateAll() }
		} finally {
			criando = false
		}
	}

	async function apagarImagem(id: string) {
		const res = await apiFetch(fetch, `/galeria/images/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${data.token}` },
		})
		if (res.ok) { aberta = null; await invalidateAll() }
	}

	// ── Edição ────────────────────────────────────────────────────────────────
	// Título, descrição, álbum e tags; o arquivo em si não se troca (para isso,
	// apaga e envia de novo). Quem pode editar é decidido pelo backend — autor
	// ou admin/owner —, e um 403 aparece como erro no formulário.
	let editando    = $state(false)
	let edTitulo    = $state('')
	let edDescricao = $state('')
	let edAlbum     = $state('')
	let edTags      = $state('')
	let salvando    = $state(false)
	let erroEdicao  = $state('')

	function abrirEdicao() {
		if (!aberta) return
		edTitulo    = aberta.title
		edDescricao = aberta.description ?? ''
		edAlbum     = aberta.album_id ?? ''
		edTags      = aberta.tags.join(', ')
		erroEdicao  = ''
		editando    = true
	}

	function fecharVisualizador() {
		aberta = null
		editando = false
	}

	async function salvarEdicao() {
		if (!aberta || !edTitulo.trim() || salvando) return
		salvando   = true
		erroEdicao = ''
		const id = aberta.id
		try {
			const res = await apiFetch(fetch, `/galeria/images/${id}`, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${data.token}` },
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
			// Reaponta para a versão recarregada: ela já vem com o nome do álbum
			// e a descrição sanitizada pelo servidor.
			aberta   = images.find((x) => x.id === id) ?? null
			editando = false
		} catch (e) {
			erroEdicao = e instanceof Error ? e.message : tFn('galeria.save_error')
		} finally {
			salvando = false
		}
	}
</script>

<svelte:head>
	<title>{tFn('galeria.page_title')}</title>
</svelte:head>

<svelte:window onkeydown={aoTeclar} />

<div class="gal-root">
	<div class="gal-header">
		<div>
			<h1 class="gal-title">{tFn('galeria.title')}</h1>
			<p class="gal-sub">{tFn('galeria.subtitle')}</p>
		</div>
		{#if !data.moduloDesligado}
			<button type="button" class="gal-btn-primary" onclick={() => (mostrarEnvio = !mostrarEnvio)}>
				{mostrarEnvio ? tFn('common.cancel') : tFn('galeria.add_image')}
			</button>
		{/if}
	</div>

	{#if data.moduloDesligado}
		<div class="gal-empty">
			<p class="gal-empty-title">{tFn('galeria.module_off')}</p>
			<p class="gal-empty-sub">{tFn('galeria.module_off_hint')}</p>
		</div>
	{:else}
		<!-- ── Envio ──────────────────────────────────────────────────────── -->
		{#if mostrarEnvio}
			<div class="gal-upload">
				<div class="gal-upload-grid">
					<label class="gal-drop">
						{#if previa}
							<img src={previa} alt="" class="gal-drop-preview" />
						{:else}
							<span class="gal-drop-hint">{tFn('galeria.pick_file')}</span>
							<span class="gal-drop-types">JPG · PNG · WebP · GIF — 12 MB</span>
						{/if}
						<input type="file" accept="image/jpeg,image/png,image/webp,image/gif"
						       class="sr-only" onchange={escolherArquivo} />
					</label>

					<div class="gal-upload-fields">
						<input type="text" bind:value={titulo} maxlength="160"
						       placeholder={tFn('galeria.title_ph')} class="gal-input" />

						<!-- Descrição rica: é o que aproxima o cartão do "forum gallery"
						     do Discord — um corpo formatado, não só uma legenda. -->
						<div class="gal-editor">
							<NodyxEditor
								compact={true}
								placeholder={tFn('galeria.description_ph')}
								onchange={(v) => (descricao = v)}
							/>
						</div>

						<div class="gal-row">
							<select bind:value={albumAlvo} class="gal-input gal-select">
								<option value="">{tFn('galeria.no_album')}</option>
								{#each albums as a}
									<option value={a.id}>{a.name}</option>
								{/each}
							</select>
							<input type="text" bind:value={tags}
							       placeholder={tFn('galeria.tags_ph')} class="gal-input" />
						</div>

						{#if erro}<p class="gal-error">{erro}</p>{/if}

						<div class="gal-row gal-row--end">
							<button type="button" class="gal-btn-ghost" onclick={limparEnvio}>
								{tFn('common.cancel')}
							</button>
							<button type="button" class="gal-btn-primary"
							        disabled={!arquivo || !titulo.trim() || enviando}
							        onclick={enviar}>
								{enviando ? tFn('galeria.uploading') : tFn('galeria.publish')}
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- ── Álbuns + busca ─────────────────────────────────────────────── -->
		<div class="gal-filters">
			<div class="gal-albums">
				<button type="button" class="gal-chip {!data.album ? 'is-active' : ''}"
				        onclick={() => aplicarFiltro({ album: '' })}>
					{tFn('galeria.all')}
				</button>
				{#each albums as a}
					<button type="button" class="gal-chip {data.album === a.id ? 'is-active' : ''}"
					        onclick={() => aplicarFiltro({ album: a.id })}>
						{a.name} <span class="gal-chip-n">{a.image_count}</span>
					</button>
				{/each}
				<button type="button" class="gal-chip {data.album === 'none' ? 'is-active' : ''}"
				        onclick={() => aplicarFiltro({ album: 'none' })}>
					{tFn('galeria.no_album')}
				</button>
			</div>

			<div class="gal-row">
				<input type="search" bind:value={busca}
				       placeholder={tFn('galeria.search_ph')}
				       onkeydown={(e) => e.key === 'Enter' && aplicarFiltro({})}
				       class="gal-input" />
				<input type="text" bind:value={novoAlbum}
				       placeholder={tFn('galeria.new_album_ph')}
				       onkeydown={(e) => e.key === 'Enter' && criarAlbum()}
				       class="gal-input" />
			</div>
		</div>

		{#if data.tag}
			<p class="gal-tagfilter">
				{tFn('galeria.filtering_tag')} <strong>#{data.tag}</strong>
				<button type="button" class="gal-chip" onclick={() => aplicarFiltro({ tag: '' })}>×</button>
			</p>
		{/if}

		<!-- ── Grade ──────────────────────────────────────────────────────── -->
		{#if images.length === 0}
			<div class="gal-empty">
				<p class="gal-empty-title">{tFn('galeria.empty')}</p>
				<p class="gal-empty-sub">{tFn('galeria.empty_hint')}</p>
			</div>
		{:else}
			<div class="gal-grid">
				{#each images as img (img.id)}
					<button type="button" class="gal-card" onclick={() => (aberta = img)}>
						<img src={urlThumb(img)} alt={img.title} loading="lazy" class="gal-card-img" />
						<div class="gal-card-body">
							<p class="gal-card-title">{img.title}</p>
							{#if img.album_name}
								<p class="gal-card-album">{img.album_name}</p>
							{/if}
							{#if img.tags.length}
								<p class="gal-card-tags">
									{#each img.tags.slice(0, 3) as tg}<span class="gal-tag">#{tg}</span>{/each}
								</p>
							{/if}
						</div>
					</button>
				{/each}
			</div>
			<div class="gal-pager">
				<button type="button" class="gal-btn-ghost"
				        disabled={!temAnterior} onclick={() => paginar(-1)}>
					← {tFn('common.prev_page')}
				</button>
				<span class="gal-count">{faixa} / {total}</span>
				<button type="button" class="gal-btn-ghost"
				        disabled={!temProxima} onclick={() => paginar(1)}>
					{tFn('common.next_page')} →
				</button>
			</div>
		{/if}
	{/if}
</div>

<!-- ── Visualizador ───────────────────────────────────────────────────────── -->
{#if aberta}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="gal-viewer" role="dialog" aria-modal="true" tabindex="-1" aria-label={aberta.title}
	     onclick={(e) => { if (e.target === e.currentTarget && !editando) fecharVisualizador() }}>
		<div class="gal-viewer-box">
			<img src={urlCheia(aberta)} alt={aberta.title} class="gal-viewer-img" />
			<div class="gal-viewer-side">
			{#if editando}
				<input type="text" bind:value={edTitulo} maxlength="160"
				       placeholder={tFn('galeria.title_ph')} class="gal-input gal-input--full" />

				<div class="gal-editor">
					<!-- `{#key}`: o editor só lê `initialContent` ao montar. -->
					{#key aberta.id}
						<NodyxEditor
							compact={true}
							initialContent={aberta.description ?? ''}
							placeholder={tFn('galeria.description_ph')}
							onchange={(v) => (edDescricao = v)}
						/>
					{/key}
				</div>

				<select bind:value={edAlbum} class="gal-input gal-input--full">
					<option value="">{tFn('galeria.no_album')}</option>
					{#each albums as a}
						<option value={a.id}>{a.name}</option>
					{/each}
				</select>
				<input type="text" bind:value={edTags}
				       placeholder={tFn('galeria.tags_ph')} class="gal-input gal-input--full" />

				{#if erroEdicao}<p class="gal-error">{erroEdicao}</p>{/if}

				<div class="gal-row gal-row--end gal-viewer-actions">
					<button type="button" class="gal-btn-ghost" onclick={() => (editando = false)}>
						{tFn('common.cancel')}
					</button>
					<button type="button" class="gal-btn-primary"
					        disabled={!edTitulo.trim() || salvando}
					        onclick={salvarEdicao}>
						{salvando ? tFn('galeria.saving') : tFn('common.save')}
					</button>
				</div>
			{:else}
				<h2 class="gal-viewer-title">{aberta.title}</h2>
				<p class="gal-viewer-meta">
					{aberta.uploader_username ?? '—'}
					{#if aberta.album_name} · {aberta.album_name}{/if}
				</p>
				{#if aberta.description}
					<!-- HTML sanitizado no servidor com o mesmo sanitize do fórum. -->
					<div class="nodyx-prose gal-viewer-desc">{@html aberta.description}</div>
				{/if}
				{#if aberta.tags.length}
					<p class="gal-card-tags">
						{#each aberta.tags as tg}
							<button type="button" class="gal-tag gal-tag--btn"
							        onclick={() => { fecharVisualizador(); aplicarFiltro({ tag: tg, album: '' }) }}>#{tg}</button>
						{/each}
					</p>
				{/if}
				<div class="gal-row gal-row--end gal-row--wrap gal-viewer-actions">
					<a href={urlCheia(aberta)} target="_blank" rel="noopener" class="gal-btn-ghost">
						{tFn('galeria.open_full')}
					</a>
					<button type="button" class="gal-btn-ghost" onclick={abrirEdicao}>
						{tFn('common.edit')}
					</button>
					<button type="button" class="gal-btn-danger" onclick={() => apagarImagem(aberta!.id)}>
						{tFn('common.delete')}
					</button>
				</div>
			{/if}
			</div>
		</div>
	</div>
{/if}

<style>
/* Sem max-width: o +layout tira o `max-w-5xl` desta rota justamente pra grade
   poder crescer com a tela (numa galeria, mais colunas = mais imagens visíveis).
   `--gal-gap` é o mesmo vão usado pela grade e pelo cálculo das 2 colunas no
   telefone. */
.gal-root { padding: 1.5rem; --gal-gap: 0.875rem; }

.gal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
.gal-title { font-size: 1.25rem; font-weight: 800; color: #fff; }
.gal-sub   { font-size: 0.8125rem; color: rgba(255,255,255,0.45); margin-top: 0.125rem; }

.gal-input {
	background: rgba(255,255,255,0.04);
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 0.5rem;
	padding: 0.5rem 0.75rem;
	font-size: 0.8125rem;
	color: #fff;
	min-width: 0;
	flex: 1;
}
.gal-input:focus { outline: none; border-color: rgb(var(--nx-accent-rgb) / 0.6); }
.gal-select { flex: 0 0 auto; min-width: 10rem; }

.gal-btn-primary {
	background: rgb(var(--nx-accent-rgb) / 0.9); color: #fff;
	border: 0; border-radius: 0.5rem; padding: 0.5rem 1rem;
	font-size: 0.8125rem; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.gal-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.gal-btn-ghost {
	background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8);
	border: 0; border-radius: 0.5rem; padding: 0.5rem 1rem;
	font-size: 0.8125rem; cursor: pointer; text-decoration: none;
}
.gal-btn-danger {
	background: rgba(239,68,68,0.15); color: rgb(248 113 113);
	border: 0; border-radius: 0.5rem; padding: 0.5rem 1rem;
	font-size: 0.8125rem; cursor: pointer;
}

.gal-row { display: flex; gap: 0.5rem; align-items: center; }
.gal-row--end { justify-content: flex-end; }
.gal-row--wrap { flex-wrap: wrap; }
/* No painel do visualizador os campos empilham; `flex: 1` num container em
   coluna esticaria a altura, então aqui a largura é explícita. */
.gal-input--full { flex: 0 0 auto; width: 100%; }

/* ── Envio ─────────────────────────────────────────────────────────────────── */
.gal-upload {
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 0.75rem;
	padding: 1rem;
	margin-bottom: 1.25rem;
	background: rgba(255,255,255,0.02);
}
.gal-upload-grid { display: grid; grid-template-columns: 240px 1fr; gap: 1rem; }
.gal-upload-fields { display: flex; flex-direction: column; gap: 0.625rem; min-width: 0; }
.gal-drop {
	display: flex; flex-direction: column; align-items: center; justify-content: center;
	gap: 0.375rem; min-height: 200px; cursor: pointer; overflow: hidden;
	border: 1px dashed rgba(255,255,255,0.18); border-radius: 0.625rem;
	background: rgba(255,255,255,0.02);
}
.gal-drop-preview { width: 100%; height: 100%; max-height: 240px; object-fit: contain; }
.gal-drop-hint  { font-size: 0.8125rem; color: rgba(255,255,255,0.6); }
.gal-drop-types { font-size: 0.6875rem; color: rgba(255,255,255,0.3); }
.gal-editor { border: 1px solid rgba(255,255,255,0.1); border-radius: 0.5rem; overflow: hidden; }
.gal-error { font-size: 0.75rem; color: rgb(248 113 113); }

/* ── Filtros ───────────────────────────────────────────────────────────────── */
.gal-filters { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: space-between; margin-bottom: 1rem; }
.gal-albums { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.gal-chip {
	background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.65);
	border: 1px solid transparent; border-radius: 9999px;
	padding: 0.3125rem 0.75rem; font-size: 0.75rem; cursor: pointer;
}
.gal-chip.is-active { background: rgb(var(--nx-accent-rgb) / 0.2); color: #fff; border-color: rgb(var(--nx-accent-rgb) / 0.5); }
.gal-chip-n { opacity: 0.5; margin-left: 0.25rem; }
.gal-tagfilter { font-size: 0.75rem; color: rgba(255,255,255,0.5); margin-bottom: 0.75rem; }

/* ── Grade ─────────────────────────────────────────────────────────────────── */
/* A grade não tem número fixo de colunas: o auto-fill decide pela largura
   disponível (que varia com a sidebar e a lista de membros abertas ou não).
   No telefone o mínimo é metade da largura (menos meio vão): dá exatamente 2
   colunas por mais estreita que seja a tela, sem colapsar pra 1. Daí pra cima
   o mínimo vira pixels e cresce por faixa, pra que num monitor grande as
   miniaturas não virem selos. */
.gal-grid {
	display: grid;
	gap: var(--gal-gap, 0.875rem);
	grid-template-columns: repeat(auto-fill, minmax(calc(50% - var(--gal-gap, 0.875rem) / 2), 1fr));
}
@media (min-width: 480px)  { .gal-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); } }
@media (min-width: 768px)  { .gal-grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); } }
@media (min-width: 1280px) { .gal-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); } }
@media (min-width: 1920px) { .gal-grid { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); } }
.gal-card {
	display: flex; flex-direction: column; text-align: left; cursor: pointer;
	background: rgba(255,255,255,0.03);
	border: 1px solid rgba(255,255,255,0.07);
	border-radius: 0.75rem; overflow: hidden; padding: 0;
	transition: border-color .15s, transform .15s;
}
.gal-card:hover { border-color: rgb(var(--nx-accent-rgb) / 0.45); transform: translateY(-2px); }
.gal-card-img   { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: rgba(0,0,0,0.25); }
.gal-card-body  { padding: 0.625rem 0.75rem 0.75rem; }
.gal-card-title { font-size: 0.8125rem; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gal-card-album { font-size: 0.6875rem; color: rgba(255,255,255,0.4); margin-top: 0.125rem; }
.gal-card-tags  { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.375rem; }
.gal-tag        { font-size: 0.625rem; color: rgb(var(--nx-accent-rgb)); background: rgb(var(--nx-accent-rgb) / 0.12); border-radius: 9999px; padding: 0.0625rem 0.375rem; }
.gal-tag--btn   { border: 0; cursor: pointer; }
.gal-count      { font-size: 0.6875rem; color: rgba(255,255,255,0.3); text-align: center; }
.gal-pager      { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 1.5rem; }
.gal-pager .gal-btn-ghost:disabled { opacity: 0.3; cursor: not-allowed; }

.gal-empty      { text-align: center; padding: 3rem 1rem; }
.gal-empty-title{ font-size: 0.9375rem; font-weight: 600; color: rgba(255,255,255,0.55); }
.gal-empty-sub  { font-size: 0.8125rem; color: rgba(255,255,255,0.3); margin-top: 0.375rem; }

/* ── Visualizador ──────────────────────────────────────────────────────────── */
.gal-viewer {
	position: fixed; inset: 0; z-index: 200;
	background: rgba(0,0,0,0.85);
	display: flex; align-items: center; justify-content: center; padding: 1.5rem;
}
.gal-viewer-box {
	display: grid; grid-template-columns: minmax(0, 1fr) 22rem;
	gap: 1rem; width: 100%; max-width: 1200px; max-height: 88vh;
	background: var(--p-bg, #0b0f19);
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 0.875rem; overflow: hidden;
}
.gal-viewer-img  { width: 100%; height: 100%; max-height: 88vh; object-fit: contain; background: #000; }
.gal-viewer-side { padding: 1.25rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.625rem; }
.gal-viewer-title{ font-size: 1rem; font-weight: 700; color: #fff; }
.gal-viewer-meta { font-size: 0.75rem; color: rgba(255,255,255,0.4); }
.gal-viewer-desc { font-size: 0.8125rem; color: rgba(255,255,255,0.75); }
.gal-viewer-actions { margin-top: auto; }

/* Telefone: o envio e o visualizador viram uma coluna só — duas colunas de
   240px + conteúdo não cabem, e o visualizador ficaria com a imagem em uma
   fatia ilegível. */
@media (max-width: 860px) {
	.gal-root { padding: 1rem; }
	.gal-upload-grid { grid-template-columns: 1fr; }
	.gal-viewer { padding: 0; }
	.gal-viewer-box { grid-template-columns: 1fr; grid-template-rows: auto 1fr; max-height: 100dvh; border-radius: 0; }
	.gal-viewer-img { max-height: 45vh; }
}
</style>
