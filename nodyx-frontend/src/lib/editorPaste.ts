// ─── Colagem de texto de fora no NodyxEditor ─────────────────────────────────
//
// Dois defeitos relatados no fórum em 2026-09-29, ao colar um texto já montado
// num editor de texto:
//
//  1. "Tudo vira um bloco só": um editor que copia HTML pré-formatado
//     (`white-space: pre`) faz o ProseMirror converter cada "\n" em <br>
//     DENTRO DE UM ÚNICO <p> (prosemirror-model, from_dom.ts, via o
//     `linebreakReplacement` do hard-break). O alinhamento é do parágrafo, então
//     centralizar uma linha centralizava o texto inteiro.
//  2. Os espaços manuais no início das linhas somem: o documento guarda espaços
//     comuns, e o HTML publicado os colapsa (só o editor usa `pre-wrap`).
//
// Soma-se um terceiro, no texto puro (Bloco de Notas): o parser padrão quebra
// em `/(?:\r\n?|\n)+/`, e o `+` engole as linhas em branco.
//
// Regra adotada: cada linha colada vira um parágrafo, como se o autor tivesse
// digitado Enter no editor. Linha em branco vira parágrafo vazio, o que mantém
// o separador de cena do trik (sceneParser.ts: 2+ parágrafos vazios).

import { Fragment, Slice, type Mark, type Node as PMNode, type Schema } from '@tiptap/pm/model'

const NBSP = ' '
const TAB  = '    '

/**
 * Troca os espaços que o HTML colapsaria por espaços inseparáveis: todo o recuo
 * no início da linha e, numa sequência de 2+, todos menos o último (que fica
 * comum para a linha ainda poder quebrar ali).
 */
export function preservarEspacos(texto: string, inicioDeLinha: boolean): string {
	let s = texto.replace(/\t/g, TAB)
	if (inicioDeLinha) s = s.replace(/^ +/, (m) => NBSP.repeat(m.length))
	return s.replace(/ {2,}/g, (m) => NBSP.repeat(m.length - 1) + ' ')
}

function tratarLinha(filhos: PMNode[], schema: Schema): PMNode[] {
	return filhos.map((n, i) =>
		n.isText ? schema.text(preservarEspacos(n.text!, i === 0), n.marks) : n,
	)
}

/** Separa o conteúdo inline em linhas, uma por <br>. */
function linhasDe(conteudo: Fragment, schema: Schema): PMNode[][] {
	const linhas: PMNode[][] = [[]]
	conteudo.forEach((n) => {
		if (n.type === schema.nodes.hardBreak) linhas.push([])
		else linhas[linhas.length - 1].push(n)
	})
	return linhas.map((l) => tratarLinha(l, schema))
}

function normalizarFragmento(frag: Fragment, schema: Schema): Fragment {
	const saida: PMNode[] = []
	frag.forEach((n) => {
		if (n.type === schema.nodes.paragraph) {
			for (const linha of linhasDe(n.content, schema)) {
				saida.push(n.type.create(n.attrs, linha, n.marks))
			}
		} else if (n.isTextblock || n.isLeaf) {
			// Títulos e blocos de código ficam como vieram; átomos (console,
			// Twitch, áudio) também.
			saida.push(n)
		} else {
			saida.push(n.copy(normalizarFragmento(n.content, schema)))
		}
	})
	return Fragment.from(saida)
}

/** `transformPasted`: aplica a regra acima a uma colagem vinda de fora. */
export function normalizarColagem(slice: Slice, schema: Schema): Slice {
	let inline = true
	slice.content.forEach((n) => { if (!n.isInline) inline = false })

	if (inline) {
		// Trecho sem bloco em volta (colagem no meio de uma linha). Com <br>,
		// embrulha cada linha num parágrafo aberto dos dois lados: a primeira
		// e a última se fundem com o parágrafo onde o cursor está.
		const linhas = linhasDe(slice.content, schema)
		if (linhas.length === 1) return new Slice(Fragment.from(linhas[0]), slice.openStart, slice.openEnd)
		const paras = linhas.map((l) => schema.nodes.paragraph.create(null, l))
		return new Slice(Fragment.from(paras), 1, 1)
	}
	return new Slice(normalizarFragmento(slice.content, schema), slice.openStart, slice.openEnd)
}

/** `clipboardTextParser`: texto puro, uma linha por parágrafo, linhas em branco inclusas. */
export function textoParaSlice(texto: string, schema: Schema, marks: readonly Mark[] = []): Slice {
	const paras = texto.replace(/\r\n?/g, '\n').split('\n').map((l) =>
		schema.nodes.paragraph.create(null, l ? schema.text(preservarEspacos(l, true), marks) : null),
	)
	return Slice.maxOpen(Fragment.from(paras))
}
