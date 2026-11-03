import { describe, it, expect } from 'vitest'
import { renderSpoilers } from './spoiler'

describe('renderSpoilers', () => {
	it('converte ||texto||', () => {
		expect(renderSpoilers('<p>o vilão é ||o pai|| dele</p>'))
			.toBe('<p>o vilão é <span class="spoiler">o pai</span> dele</p>')
	})
	it('ignora code', () => {
		expect(renderSpoilers('<code>a ||b|| c</code>')).toBe('<code>a ||b|| c</code>')
	})
	it('não mexe em atributos nem em |||| vazio', () => {
		expect(renderSpoilers('<a title="||x||">y</a> a |||| b')).toBe('<a title="||x||">y</a> a |||| b')
	})
})
