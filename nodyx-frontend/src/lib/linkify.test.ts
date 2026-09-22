import { describe, it, expect } from 'vitest';
import { linkifyHtml } from './linkify';

const A_OPEN = /<a href="([^"]*)"/g;
const hrefs = (html: string) => [...html.matchAll(A_OPEN)].map((m) => m[1]);

describe('linkifyHtml — nunca mexe no markup das tags', () => {
	// Regressão (revisão 2026-09-20): a URL de src/href dentro de uma tag virava um <a> dentro
	// do atributo, e a mídia embutida do chat quebrava.
	it.each([
		'<img src="https://x.test/a.png" alt="">',
		'<img src="https://x.test/a.png" alt="oi @bob">',
		'<iframe src="https://www.youtube.com/embed/abc" width="560"></iframe>',
		'<video src="https://x.test/v.mp4" controls></video>',
		'<a href="https://x.test/page">já é link</a>'
	])('deixa intacto: %s', (html) => {
		expect(linkifyHtml(html)).toBe(html);
	});

	it('linkifica só o texto ao redor de uma imagem', () => {
		const out = linkifyHtml('<p>olha https://x.test/y</p><img src="https://x.test/a.png">');
		expect(hrefs(out)).toEqual(['https://x.test/y']);
		expect(out).toContain('<img src="https://x.test/a.png">'); // src continua um atributo puro
	});
});

describe('linkifyHtml — URLs', () => {
	it('linkifica URL solta em texto', () => {
		const out = linkifyHtml('<p>veja https://x.test/y agora</p>');
		expect(hrefs(out)).toEqual(['https://x.test/y']);
		expect(out).toContain('target="_blank"');
		expect(out).toContain('rel="noopener noreferrer"');
	});

	it('não cria link duplo dentro de um <a> existente', () => {
		const html = '<p><a href="https://x.test/y">https://x.test/y</a></p>';
		expect(linkifyHtml(html)).toBe(html);
	});

	it('linkifica URL dentro de <code> (comportamento antigo preservado)', () => {
		expect(hrefs(linkifyHtml('<pre><code>curl https://x.test/y</code></pre>'))).toEqual(['https://x.test/y']);
	});
});

describe('linkifyHtml — @menções', () => {
	it('linkifica @menção em texto', () => {
		const out = linkifyHtml('<p>oi @bob tudo bem</p>');
		expect(hrefs(out)).toEqual(['/users/bob']);
		expect(out).toContain('>@bob</a>');
	});

	// É o caso que motivou a mudança: mensagens de bot sem <p>, com a menção no texto solto.
	it.each([
		['texto sem nenhuma tag', 'registrado por @bob.'],
		['texto depois da última tag', '<strong>Nome</strong> registrado por @bob.'],
		['texto antes da primeira tag', 'por @bob <strong>Nome</strong>']
	])('linkifica menção em %s', (_label, html) => {
		expect(hrefs(linkifyHtml(html))).toEqual(['/users/bob']);
	});

	it('não linkifica menção dentro de <code>/<pre>', () => {
		const html = '<pre><code>git config user @bob</code></pre>';
		expect(linkifyHtml(html)).toBe(html);
	});

	it('não trata e-mail nem "@" grudado em palavra como menção', () => {
		const html = '<p>escreva para fulano@dominio.com</p>';
		expect(linkifyHtml(html)).toBe(html);
	});

	it('URL com @ no caminho vira UM link, sem menção aninhada', () => {
		const out = linkifyHtml('<p>https://x.test/@bob</p>');
		expect(hrefs(out)).toEqual(['https://x.test/@bob']);
		expect((out.match(/<a /g) ?? []).length).toBe(1);
	});
});

describe('linkifyHtml — atalhos', () => {
	it('sem URL nem @ devolve o mesmo texto', () => {
		const html = '<p>nada pra linkificar</p>';
		expect(linkifyHtml(html)).toBe(html);
	});
});
