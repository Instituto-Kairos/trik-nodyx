// Spoiler estilo Discord: <span class="spoiler">. Esconde o texto atrás de uma
// barra até alguém clicar (vale pra todo mundo). Dois caminhos geram o span:
//  - a marca do editor (botão ou `||texto||` digitado), salva no HTML;
//  - renderSpoilers(), na leitura, converte `||texto||` cru (ex.: o input
//    simples do chat, que não passa pelo TipTap).
// O texto fica no HTML: o spoiler evita ler sem querer, não é sigilo.

const TAG_SPLIT_RE  = /(<[^>]*>)/
const CODE_OPEN_RE  = /^<(?:pre|code)(?:\s[^>]*)?>$/i
const CODE_CLOSE_RE = /^<\/(?:pre|code)\s*>$/i
const SPOILER_RE    = /\|\|(?=[^\s|])([^|]+?)\|\|/g

/** Converte `||texto||` em spoiler nos nós de texto (nunca dentro de code/pre). */
export function renderSpoilers(html: string): string {
	if (!html || !html.includes('||')) return html
	let insideCode = 0
	return html
		.split(TAG_SPLIT_RE)
		.map((part, i) => {
			if (i % 2 === 1) {
				if (CODE_OPEN_RE.test(part)) insideCode++
				else if (CODE_CLOSE_RE.test(part)) insideCode = Math.max(0, insideCode - 1)
				return part
			}
			if (insideCode > 0) return part
			return part.replace(SPOILER_RE, '<span class="spoiler">$1</span>')
		})
		.join('')
}

// Um único listener no documento revela qualquer spoiler clicado (fórum, chat,
// palco). O 1º clique só revela: um link dentro do spoiler não abre sem querer.
const g = globalThis as { __nxSpoiler?: boolean }
if (typeof document !== 'undefined' && !g.__nxSpoiler) {
	g.__nxSpoiler = true
	document.addEventListener('click', (e) => {
		const span = (e.target as Element | null)?.closest?.('.nodyx-prose .spoiler, .stage-msg .spoiler')
		if (!span || span.classList.contains('revealed')) return
		e.preventDefault()
		e.stopPropagation()
		span.classList.add('revealed')
	}, true)
}
