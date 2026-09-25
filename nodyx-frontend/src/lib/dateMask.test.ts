// $lib/dateMask — máscara dd/mm/aaaa [hh:mm] dos campos de data digitados.

import { describe, it, expect } from 'vitest'
import {
	onlyDigits, mask, maskedToValue, valueToMasked, isoToValue, isIncomplete,
} from './dateMask'

describe('mask — modo date', () => {
	it('insere as barras conforme se digita', () => {
		expect(mask('', 'date')).toBe('')
		expect(mask('2', 'date')).toBe('2')
		expect(mask('24', 'date')).toBe('24')
		expect(mask('249', 'date')).toBe('24/9')
		expect(mask('2409', 'date')).toBe('24/09')
		expect(mask('240920', 'date')).toBe('24/09/20')
		expect(mask('24092026', 'date')).toBe('24/09/2026')
	})

	it('descarta o que não é dígito, então a barra nunca duplica', () => {
		expect(mask('24/09/2026', 'date')).toBe('24/09/2026')
		expect(mask('24//09', 'date')).toBe('24/09')
		expect(mask('24.09.2026', 'date')).toBe('24/09/2026')
		expect(mask('ab24cd09', 'date')).toBe('24/09')
	})

	it('para em 8 dígitos', () => {
		expect(mask('240920261234', 'date')).toBe('24/09/2026')
	})

	// Apagar tem que poder atravessar a barra: o texto é sempre reconstruído
	// dos dígitos, então '24/0' -> apaga '0' -> '24/' -> vira '24'.
	it('reconstrói para trás sem travar na barra', () => {
		expect(mask('24/', 'date')).toBe('24')
		expect(mask('24/0', 'date')).toBe('24/0')
	})
})

describe('mask — modo datetime', () => {
	it('acrescenta espaço e dois-pontos na hora', () => {
		expect(mask('24092026', 'datetime')).toBe('24/09/2026')
		expect(mask('240920261', 'datetime')).toBe('24/09/2026 1')
		expect(mask('2409202619', 'datetime')).toBe('24/09/2026 19')
		expect(mask('24092026193', 'datetime')).toBe('24/09/2026 19:3')
		expect(mask('240920261930', 'datetime')).toBe('24/09/2026 19:30')
	})

	it('para em 12 dígitos', () => {
		expect(mask('2409202619304567', 'datetime')).toBe('24/09/2026 19:30')
	})

	it('aceita colar um texto já pontuado', () => {
		expect(mask('24/09/2026 19:30', 'datetime')).toBe('24/09/2026 19:30')
	})
})

describe('maskedToValue', () => {
	it('converte data completa no formato que o input nativo produzia', () => {
		expect(maskedToValue('24/09/2026', 'date')).toBe('2026-09-24')
		expect(maskedToValue('01/01/1990', 'date')).toBe('1990-01-01')
		expect(maskedToValue('24/09/2026 19:30', 'datetime')).toBe('2026-09-24T19:30')
		expect(maskedToValue('24/09/2026 00:05', 'datetime')).toBe('2026-09-24T00:05')
	})

	it('devolve null enquanto está incompleta', () => {
		for (const parcial of ['', '2', '24', '24/0', '24/09', '24/09/20']) {
			expect(maskedToValue(parcial, 'date'), parcial).toBeNull()
		}
		for (const parcial of ['24/09/2026', '24/09/2026 1', '24/09/2026 19', '24/09/2026 19:3']) {
			expect(maskedToValue(parcial, 'datetime'), parcial).toBeNull()
		}
	})

	// Uma checagem por faixa (dia<=31, mes<=12) aceitaria 31/02 e 30/02.
	// A reconstrução via Date é o que pega.
	it('recusa dia que não existe no mês', () => {
		expect(maskedToValue('31/02/2026', 'date')).toBeNull()
		expect(maskedToValue('30/02/2026', 'date')).toBeNull()
		expect(maskedToValue('31/04/2026', 'date')).toBeNull()
		expect(maskedToValue('32/01/2026', 'date')).toBeNull()
	})

	it('aceita 29 de fevereiro só em ano bissexto', () => {
		expect(maskedToValue('29/02/2024', 'date')).toBe('2024-02-29')
		expect(maskedToValue('29/02/2026', 'date')).toBeNull()
		// 1900 não é bissexto (divisível por 100 e não por 400).
		expect(maskedToValue('29/02/1900', 'date')).toBeNull()
		expect(maskedToValue('29/02/2000', 'date')).toBe('2000-02-29')
	})

	it('recusa mês e dia zero e mês acima de 12', () => {
		expect(maskedToValue('00/09/2026', 'date')).toBeNull()
		expect(maskedToValue('24/00/2026', 'date')).toBeNull()
		expect(maskedToValue('24/13/2026', 'date')).toBeNull()
		expect(maskedToValue('24/09/0000', 'date')).toBeNull()
	})

	// Date trata 0-99 como 1900-1999; o ano curto explícito tem que sair como
	// o ano que foi digitado, não como 1924.
	it('não desloca anos de dois dígitos escritos com zeros à frente', () => {
		expect(maskedToValue('24/09/0024', 'date')).toBe('0024-09-24')
	})

	// Relógio de 24h: 24:00 é 00:00 do dia seguinte, não uma hora válida.
	it('recusa hora fora de 00:00–23:59', () => {
		expect(maskedToValue('24/09/2026 24:00', 'datetime')).toBeNull()
		expect(maskedToValue('24/09/2026 25:00', 'datetime')).toBeNull()
		expect(maskedToValue('24/09/2026 19:60', 'datetime')).toBeNull()
		expect(maskedToValue('24/09/2026 23:59', 'datetime')).toBe('2026-09-24T23:59')
		expect(maskedToValue('24/09/2026 00:00', 'datetime')).toBe('2026-09-24T00:00')
	})
})

describe('valueToMasked', () => {
	it('inverte a conversão', () => {
		expect(valueToMasked('2026-09-24', 'date')).toBe('24/09/2026')
		expect(valueToMasked('2026-09-24T19:30', 'datetime')).toBe('24/09/2026 19:30')
	})

	it('corta a hora quando o modo é só data', () => {
		expect(valueToMasked('2026-09-24T19:30', 'date')).toBe('24/09/2026')
	})

	it('aceita valor sem hora no modo datetime, sem inventar uma', () => {
		expect(valueToMasked('2026-09-24', 'datetime')).toBe('24/09/2026')
	})

	it('devolve vazio para entrada vazia ou fora de formato', () => {
		for (const ruim of ['', null, undefined, 'nao-e-data', '24/09/2026']) {
			expect(valueToMasked(ruim as any, 'date'), String(ruim)).toBe('')
		}
	})

	it('faz ida e volta sem perder o dia', () => {
		for (const v of ['2026-09-24', '2024-02-29', '1990-12-31', '2000-01-01']) {
			expect(maskedToValue(valueToMasked(v, 'date'), 'date'), v).toBe(v)
		}
		for (const v of ['2026-09-24T19:30', '2026-01-01T00:00', '2026-12-31T23:59']) {
			expect(maskedToValue(valueToMasked(v, 'datetime'), 'datetime'), v).toBe(v)
		}
	})
})

describe('isoToValue — hora LOCAL, não UTC', () => {
	// Este é o bug que os formulários de evento tinham: eles usavam
	// `toISOString().slice(0, 16)`, que é UTC, num campo que lê hora local.
	it('preserva a hora de parede de um Date local', () => {
		const d = new Date(2026, 8, 24, 18, 0)
		expect(isoToValue(d, 'datetime')).toBe('2026-09-24T18:00')
		expect(isoToValue(d, 'date')).toBe('2026-09-24')
	})

	it('não é o mesmo que toISOString em fuso com offset', () => {
		const d = new Date(2026, 8, 24, 18, 0)
		const utc = d.toISOString().slice(0, 16)
		// Se a máquina não estiver em UTC, o caminho antigo divergia do certo.
		if (d.getTimezoneOffset() !== 0) {
			expect(isoToValue(d, 'datetime')).not.toBe(utc)
		}
		// E o que importa: o valor certo reconstrói o mesmo instante.
		expect(new Date(isoToValue(d, 'datetime')).getTime()).toBe(d.getTime())
	})

	it('faz ida e volta com o ISO da API sem deslocar o instante', () => {
		const original = new Date(2026, 8, 24, 18, 0)
		const daApi = original.toISOString()
		const noCampo = isoToValue(daApi, 'datetime')
		expect(new Date(noCampo).getTime()).toBe(original.getTime())
	})

	it('devolve vazio para nulo, vazio e data inválida', () => {
		for (const ruim of [null, undefined, '', 'nao-e-data']) {
			expect(isoToValue(ruim as any, 'datetime'), String(ruim)).toBe('')
		}
	})
})

describe('onlyDigits', () => {
	it('respeita o limite do modo', () => {
		expect(onlyDigits('240920261930', 'date')).toBe('24092026')
		expect(onlyDigits('240920261930', 'datetime')).toBe('240920261930')
	})
})

describe('isIncomplete', () => {
	it('é falso no campo vazio — campo vazio não é erro', () => {
		expect(isIncomplete('', 'date')).toBe(false)
		expect(isIncomplete('', 'datetime')).toBe(false)
	})

	it('é verdadeiro no meio da digitação e na data impossível', () => {
		expect(isIncomplete('24', 'date')).toBe(true)
		expect(isIncomplete('24/09', 'date')).toBe(true)
		expect(isIncomplete('31/02/2026', 'date')).toBe(true)
		expect(isIncomplete('24/09/2026', 'datetime')).toBe(true)
		expect(isIncomplete('24/09/2026 24:00', 'datetime')).toBe(true)
	})

	it('é falso quando a data fecha', () => {
		expect(isIncomplete('24/09/2026', 'date')).toBe(false)
		expect(isIncomplete('24/09/2026 19:30', 'datetime')).toBe(false)
	})
})
