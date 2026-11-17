import { describe, it, expect } from 'vitest'
import { safeImageUrl, LINK_ICON_PRESETS } from '../lib/components/homepage/linkIcons'

// A URL de ícone vai num <img src> da página inicial, escolhida por um admin : só
// http(s) e caminho relativo passam. Nada de javascript:, data: ou //host.
describe('safeImageUrl', () => {
	it.each(['https://a.b/x.png', 'http://a.b/x.png', 'HTTPS://A.B/X.PNG', '/uploads/x.png', '  https://a.b/x.png  '])('aceita %s', (u) => {
		expect(safeImageUrl(u)).toBe(u.trim())
	})
	it.each(['javascript:alert(1)', 'data:image/svg+xml;base64,AA', '//evil.example/x.png', 'ftp://a.b/x', 'x.png', '', '   ', null, undefined])('recusa %s', (u) => {
		expect(safeImageUrl(u as string | null | undefined)).toBeNull()
	})
})

describe('LINK_ICON_PRESETS', () => {
	it('todo ícone pronto tem um caminho SVG não vazio', () => {
		for (const [k, d] of Object.entries(LINK_ICON_PRESETS)) {
			expect(d, k).toMatch(/^M/)
		}
	})
	it('tem os ícones que o editor oferece', () => {
		expect(Object.keys(LINK_ICON_PRESETS)).toEqual(expect.arrayContaining(['link', 'globe', 'book', 'mail', 'star', 'heart', 'gamepad', 'dice']))
	})
})
