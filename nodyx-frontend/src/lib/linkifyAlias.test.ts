// ─── Alias de personagem: `@[Nome do Personagem](username)` ──────────────────
//
// Marcar um personagem numa cena é marcar O JOGADOR por trás dele. O nome entre
// colchetes é rótulo; o alvo do link (e da notificação, no servidor) é sempre o
// username entre parênteses.
//
// O formato é duplicado no servidor (nodyx-core/src/utils/mentions.ts) porque os
// bundles são separados. Estes testes fixam o lado cliente; o de lá fixa o
// outro. Se um mudar sem o outro, um dos dois cai.

import { describe, it, expect } from 'vitest'
import { linkifyHtml, linkify, renderAliasMentions } from './linkify'

const hrefs = (html: string) => [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1])

describe('linkify (segmentos) — alias de personagem', () => {
	it('exibe o nome do personagem e aponta para o jogador', () => {
		const segs = linkify('@[Kaelen Duvray](rafael) saca a lâmina.')
		const m = segs.find((s) => s.type === 'mention')
		expect(m).toBeDefined()
		// O nome se lê como nome: sem `@` no texto exibido.
		expect(m).toMatchObject({ type: 'mention', value: 'Kaelen Duvray', username: 'rafael' })
	})

	it('aceita espaços e acentos, que a menção simples não alcança', () => {
		// `@Astërion` casaria só como "Ast" no regex da menção simples (\w sem
		// flag u não pega acento) — é justamente por isso que o alias é delimitado.
		const segs = linkify('@[Astërion, o Pálido](joana) observa.')
		expect(segs.find((s) => s.type === 'mention')).toMatchObject({
			value: 'Astërion, o Pálido',
			username: 'joana',
		})
	})

	it('resolve vários aliases e preserva o texto entre eles', () => {
		const segs = linkify('@[Kaelen](rafael) olha para @[Astërion](joana) e sorri.')
		const ms = segs.filter((s) => s.type === 'mention')
		expect(ms.map((m) => (m as { username: string }).username)).toEqual(['rafael', 'joana'])
		const texto = segs.filter((s) => s.type === 'text').map((s) => s.value).join('')
		expect(texto).toContain('olha para')
		expect(texto).toContain('e sorri.')
	})

	it('convive com a menção simples na mesma frase', () => {
		const segs = linkify('@[Kaelen](rafael) responde a @joana fora de cena.')
		const ms = segs.filter((s) => s.type === 'mention') as Array<{ value: string; username: string }>
		expect(ms).toHaveLength(2)
		expect(ms[0]).toMatchObject({ value: 'Kaelen', username: 'rafael' })
		expect(ms[1]).toMatchObject({ value: '@joana', username: 'joana' })
	})

	it('não deixa a forma simples comer a forma de alias', () => {
		// Se a alternativa simples fosse testada primeiro, `@[...` não casaria
		// nada e o texto cru vazaria para a tela.
		const segs = linkify('@[Kaelen](rafael)')
		expect(segs.filter((s) => s.type === 'text').map((s) => s.value).join('')).toBe('')
	})

	it('ignora o que não é alias bem formado', () => {
		for (const cru of ['@[](rafael)', '@[Kaelen]()', '@[Kaelen] (rafael)', 'a@[Kaelen](rafael)']) {
			const segs = linkify(cru)
			const ms = segs.filter((s) => s.type === 'mention') as Array<{ username: string }>
			// Nenhum alias resolvido — no máximo uma menção simples incidental.
			expect(ms.every((m) => m.username !== 'rafael'), cru).toBe(true)
		}
	})
})

describe('linkifyHtml — alias de personagem', () => {
	it('gera um link para o jogador com o nome do personagem como texto', () => {
		const out = linkifyHtml('<p>@[Kaelen Duvray](rafael) entra.</p>')
		expect(hrefs(out)).toEqual(['/users/rafael'])
		expect(out).toContain('>Kaelen Duvray</a>')
	})

	it('NÃO reescapa o nome exibido (ele já vem sanitizado do servidor)', () => {
		// Premissa que eu errei na primeira versão deste teste: linkifyHtml não
		// sanitiza, ele linkifica — o HTML já passou pelo sanitize-html no
		// servidor, então o texto já traz suas entidades. Reescapar daria
		// `&amp;lt;` e o jogador leria "&lt;o Bravo&gt;" na tela.
		const out = linkifyHtml('<p>@[Kaelen &lt;o Bravo&gt;](rafael)</p>')
		expect(out).toContain('>Kaelen &lt;o Bravo&gt;</a>')
		expect(out).not.toContain('&amp;lt;')
		expect(hrefs(out)).toEqual(['/users/rafael'])
	})

	it('escapa o username antes de pôr no href', () => {
		// O charset do username do alias é permissivo por desenho (o `)` delimita),
		// então um `"` cru fecharia o atributo e permitiria injetar outro. Um `"`
		// sobrevive num nó de texto HTML — sanitize-html não o codifica ali.
		const out = linkifyHtml('<p>@[Kaelen](ra"onmouseover="x)</p>')
		expect(out).toContain('href="/users/ra&quot;onmouseover=&quot;x"')
		expect(out).not.toMatch(/href="[^"]*"\s*onmouseover/)
	})

	it('não toca alias dentro de <code>', () => {
		const html = '<code>@[Kaelen](rafael)</code>'
		expect(linkifyHtml(html)).toBe(html)
	})

	it('não reescaneia a própria saída (nenhum <a> aninhado)', () => {
		const out = linkifyHtml('<p>@[Kaelen](rafael) e @joana</p>')
		expect(out).not.toContain('<a href="/users/rafael"><a')
		expect(hrefs(out)).toEqual(['/users/rafael', '/users/joana'])
	})

	it('deixa a menção simples exatamente como antes', () => {
		const out = linkifyHtml('<p>oi @joana</p>')
		expect(hrefs(out)).toEqual(['/users/joana'])
		expect(out).toContain('>@joana</a>')
	})
})

describe('renderAliasMentions — só os aliases, para o fórum', () => {
	// O fórum renderiza `{@html post.content}` cru. Sem isto, uma cena mostraria
	// o literal `@[Kaelen Duvray](rafael)`. Usar linkifyHtml ali passaria a
	// transformar URLs e @menções que hoje são texto — mudança que este recurso
	// não pediu, daí a função estreita.
	it('transforma o alias', () => {
		const out = renderAliasMentions('<p>@[Kaelen Duvray](rafael) entra.</p>')
		expect(hrefs(out)).toEqual(['/users/rafael'])
		expect(out).toContain('>Kaelen Duvray</a>')
	})

	it('NÃO toca URL nua', () => {
		const html = '<p>veja https://exemplo.test/x</p>'
		expect(renderAliasMentions(html)).toBe(html)
	})

	it('NÃO toca @username simples', () => {
		const html = '<p>oi @joana</p>'
		expect(renderAliasMentions(html)).toBe(html)
	})

	it('preserva markup e atributos', () => {
		const html = '<img src="https://x.test/a.png" alt="@[nao](toca)">'
		expect(renderAliasMentions(html)).toBe(html)
	})

	it('não toca alias dentro de <code>', () => {
		const html = '<code>@[Kaelen](rafael)</code>'
		expect(renderAliasMentions(html)).toBe(html)
	})

	it('não aninha dentro de um <a> existente', () => {
		const html = '<a href="/x">@[Kaelen](rafael)</a>'
		expect(renderAliasMentions(html)).toBe(html)
	})

	it('conteúdo sem alias volta idêntico (atalho rápido)', () => {
		const html = '<p>uma cena sem ninguém marcado</p>'
		expect(renderAliasMentions(html)).toBe(html)
	})
})
