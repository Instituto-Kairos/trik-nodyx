// Colagem de texto de fora no fórum: ver o cabeçalho de editorPaste.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Fragment, Slice } from '@tiptap/pm/model'
import { normalizarColagem, preservarEspacos, textoParaSlice } from './editorPaste'

const schema = getSchema([StarterKit, TextAlign.configure({ types: ['heading', 'paragraph'] })])
const NBSP = ' '

const p   = (...c: any[]) => schema.nodes.paragraph.create(null, c)
const t   = (s: string) => schema.text(s)
const br  = () => schema.nodes.hardBreak.create()
const linhas = (s: Slice) => { const out: string[] = []; s.content.forEach((n) => out.push(n.textContent)); return out }

describe('preservarEspacos', () => {
	it('mantém o recuo manual no início da linha', () => {
		expect(preservarEspacos('    Capítulo', true)).toBe(NBSP.repeat(4) + 'Capítulo')
	})
	it('no meio da linha, só colapsa o que o HTML colapsaria', () => {
		expect(preservarEspacos('a b', false)).toBe('a b')
		expect(preservarEspacos('a   b', false)).toBe(`a${NBSP}${NBSP} b`)
	})
	it('fora do início da linha, um espaço à frente continua comum', () => {
		expect(preservarEspacos(' b', false)).toBe(' b')
	})
	it('tab vira quatro espaços', () => {
		expect(preservarEspacos('\tx', true)).toBe(NBSP.repeat(4) + 'x')
	})
})

describe('HTML pré-formatado: um <p> com <br> vira um parágrafo por linha', () => {
	// É o formato que o ProseMirror produz de um editor que copia com
	// `white-space: pre`: tudo num parágrafo só, linhas separadas por <br>.
	const colado = new Slice(Fragment.from(
		p(t('Título'), br(), t('  recuado'), br(), br(), t('fim')),
	), 1, 1)
	const r = normalizarColagem(colado, schema)

	it('cada linha é um bloco próprio, que pode ser centralizado sozinho', () => {
		expect(r.content.childCount).toBe(4)
		expect(linhas(r)).toEqual(['Título', NBSP + NBSP + 'recuado', '', 'fim'])
	})
	it('as bordas continuam abertas para se fundir com o parágrafo do cursor', () => {
		expect([r.openStart, r.openEnd]).toEqual([1, 1])
	})
	it('o alinhamento do parágrafo de origem vai para todas as linhas', () => {
		const centro = schema.nodes.paragraph.create({ textAlign: 'center' }, [t('a'), br(), t('b')])
		const s = normalizarColagem(new Slice(Fragment.from(centro), 0, 0), schema)
		s.content.forEach((n) => expect(n.attrs.textAlign).toBe('center'))
	})
})

describe('trecho inline (colado no meio de uma linha)', () => {
	it('sem <br>, continua inline', () => {
		const r = normalizarColagem(new Slice(Fragment.from(t('abc')), 0, 0), schema)
		expect(r.content.firstChild!.isText).toBe(true)
	})
	it('com <br>, vira parágrafos abertos', () => {
		const r = normalizarColagem(new Slice(Fragment.from([t('a'), br(), t('b')]), 0, 0), schema)
		expect(linhas(r)).toEqual(['a', 'b'])
		expect([r.openStart, r.openEnd]).toEqual([1, 1])
	})
})

describe('blocos que não se mexem', () => {
	it('bloco de código fica como veio', () => {
		const code = schema.nodes.codeBlock.create(null, t('  x\n  y'))
		const r = normalizarColagem(new Slice(Fragment.from(code), 0, 0), schema)
		expect(r.content.firstChild!.textContent).toBe('  x\n  y')
	})
})

describe('texto puro (Bloco de Notas)', () => {
	it('as linhas em branco sobrevivem, e o separador de cena do trik continua valendo', () => {
		// O parser padrão quebrava em /\n+/ e engolia as linhas em branco.
		// Três quebras = duas linhas em branco = dois parágrafos vazios, que é o
		// que o sceneParser do core reconhece como separador.
		const r = textoParaSlice('cabeçalho\n\n\ncena', schema)
		expect(linhas(r)).toEqual(['cabeçalho', '', '', 'cena'])
	})
	it('o recuo manual é mantido', () => {
		expect(linhas(textoParaSlice('  a\r\n    b', schema))).toEqual([NBSP + NBSP + 'a', NBSP.repeat(4) + 'b'])
	})
})

describe('ligação no componente', () => {
	const src = readFileSync(fileURLToPath(new URL('./components/editor/NodyxEditor.svelte', import.meta.url)), 'utf-8')
	it('usa os dois ganchos e poupa a colagem interna e o código', () => {
		expect(src).toContain('clipboardTextParser(text, $context)')
		expect(src).toContain('normalizarColagem(slice, view.state.schema)')
		expect(src).toContain("html.includes('data-pm-slice')")
		expect(src).toMatch(/colagemInterna \|\| view\.state\.selection\.\$from\.parent\.type\.spec\.code/)
	})
})
