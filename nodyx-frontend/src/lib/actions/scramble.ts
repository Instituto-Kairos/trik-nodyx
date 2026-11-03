// Texto ofuscado (<span class="scramble">): cicla caracteres aleatórios no lugar
// do texto real, com o MESMO comprimento. O original continua no HTML (visível no
// DevTools, decisão consciente) e é guardado aqui pra restaurar no clique.
//
// Um único timer global serve todos os spans da página. Em
// prefers-reduced-motion, embaralha uma vez e não anima.

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*?<>/\\'
const TICK_MS = 70

const originals = new Map<Text, string>()
let timer: ReturnType<typeof setInterval> | null = null

function randomize(orig: string): string {
	let out = ''
	for (const ch of orig) out += /\s/.test(ch) ? ch : CHARS[(Math.random() * CHARS.length) | 0]
	return out
}

function tick() {
	for (const [node, orig] of originals) {
		if (!node.isConnected) { originals.delete(node); continue }
		if (node.parentElement?.closest('.scramble.revealed')) continue
		node.nodeValue = randomize(orig)
	}
	if (originals.size === 0 && timer) { clearInterval(timer); timer = null }
}

function reducedMotion() {
	return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Só o owner da instância revela no clique; os demais só veem o embaralhado.
const canRevealRoots = new WeakMap<HTMLElement, boolean>()

function onClick(e: Event) {
	if (!canRevealRoots.get(e.currentTarget as HTMLElement)) return
	const span = (e.target as Element | null)?.closest?.('.scramble')
	if (!span) return
	const revealed = span.classList.toggle('revealed')
	const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
	for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
		const orig = originals.get(n)
		if (orig !== undefined) n.nodeValue = revealed ? orig : randomize(orig)
	}
}

function scan(root: HTMLElement) {
	const canReveal = !!canRevealRoots.get(root)
	for (const span of root.querySelectorAll<HTMLElement>('.scramble')) {
		if (span.dataset.scrambleReady) continue
		span.dataset.scrambleReady = '1'
		if (canReveal) { span.title = 'Clique para revelar'; span.style.cursor = 'pointer' }
		else { span.removeAttribute('title'); span.style.cursor = 'default' }
		const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
		for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
			originals.set(n, n.nodeValue ?? '')
			n.nodeValue = randomize(n.nodeValue ?? '')
		}
	}
	if (!reducedMotion() && originals.size > 0 && !timer) timer = setInterval(tick, TICK_MS)
}

type Params = { content?: unknown; canReveal?: boolean }

export function scramble(node: HTMLElement, params: Params = {}) {
	canRevealRoots.set(node, !!params.canReveal)
	node.addEventListener('click', onClick)
	scan(node)
	return {
		// O parâmetro é o conteúdo: quando muda (edição salva), o {@html} já foi
		// re-renderizado e só os spans novos precisam ser registrados.
		update(p: Params = {}) {
			canRevealRoots.set(node, !!p.canReveal)
			queueMicrotask(() => scan(node))
		},
		destroy() { node.removeEventListener('click', onClick) },
	}
}
