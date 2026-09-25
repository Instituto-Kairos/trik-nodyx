// $lib/datetime — formatação ancorada no idioma do app, hora sempre 24h.
//
// O que importa travar aqui é o contrato que o usuário pediu: 24h em qualquer
// idioma (inclusive nos que usam AM/PM por padrão) e dd/mm/aaaa em pt-BR.
// Os testes usam um instante FIXO com offset explícito e comparam só o que o
// ICU garante estável entre versões (dígitos e ordem), nunca a pontuação
// exata dos formatos por extenso.

import { describe, it, expect } from 'vitest'
import {
	fmtTime, fmtDate, fmtDateLong, fmtDateShort,
	fmtMonthYear, fmtMonthShort, fmtDayNum, fmtDateTime,
} from './datetime'

// Construídos em hora LOCAL de propósito. Com uma string ISO em `Z` o
// resultado esperado mudaria conforme o fuso da máquina (aqui America/Cuiaba,
// UTC-4, o que viraria 15:30); ancorando no fuso local, o contrato testado é a
// formatação em si e o teste passa em qualquer máquina e na CI.
// 24/09/2026 é uma quinta-feira.
const TARDE = new Date(2026, 8, 24, 19, 30)
const MEIA_NOITE = new Date(2026, 8, 24, 0, 5)

describe('fmtTime — 24h em todos os idiomas', () => {
	it('escreve 19:30 e não 7:30 PM', () => {
		for (const loc of ['pt-BR', 'en', 'fr', 'es', 'de', 'ru', 'vi', 'pt-PT']) {
			const out = fmtTime(TARDE, loc)
			expect(out, loc).toMatch(/^19[:.]30$/)
			expect(out.toUpperCase(), loc).not.toContain('AM')
			expect(out.toUpperCase(), loc).not.toContain('PM')
		}
	})

	// hourCycle 'h23' e não hour12:false: o ciclo h24 escreveria "24:05".
	it('escreve 00:05 à meia-noite, nunca 24:05', () => {
		for (const loc of ['pt-BR', 'en', 'fr']) {
			expect(fmtTime(MEIA_NOITE, loc), loc).toMatch(/^00[:.]05$/)
		}
	})
})

describe('fmtDate — dd/mm/aaaa em pt-BR', () => {
	it('põe o dia antes do mês em pt-BR', () => {
		expect(fmtDate(TARDE, 'pt-BR')).toBe('24/09/2026')
	})

	it('respeita a ordem de cada idioma em vez de forçar a brasileira', () => {
		expect(fmtDate(TARDE, 'fr')).toBe('24/09/2026')
		// en resolve para en-US: mês primeiro. Não é bug — é o idioma escolhido.
		expect(fmtDate(TARDE, 'en')).toBe('09/24/2026')
	})
})

describe('demais formatos', () => {
	it('dateLong traz o dia da semana no idioma pedido', () => {
		expect(fmtDateLong(TARDE, 'pt-BR').toLowerCase()).toContain('quinta')
		expect(fmtDateLong(TARDE, 'pt-BR')).toContain('2026')
		expect(fmtDateLong(TARDE, 'fr').toLowerCase()).toContain('jeudi')
	})

	it('dateShort não traz o ano', () => {
		expect(fmtDateShort(TARDE, 'pt-BR')).toContain('24')
		expect(fmtDateShort(TARDE, 'pt-BR')).not.toContain('2026')
	})

	it('monthYear agrupa mês e ano, sem dia', () => {
		const out = fmtMonthYear(TARDE, 'pt-BR').toLowerCase()
		expect(out).toContain('setembro')
		expect(out).toContain('2026')
		expect(out).not.toContain('24')
	})

	it('monthShort sai em caixa alta e sem o ponto da abreviação', () => {
		expect(fmtMonthShort(TARDE, 'pt-BR')).toBe('SET')
		expect(fmtMonthShort(TARDE, 'en')).toBe('SEP')
		// pt/fr/es abreviam com ponto, en não: nenhum deve sobrar no badge.
		for (const loc of ['pt-BR', 'pt-PT', 'fr', 'es', 'en', 'de']) {
			expect(fmtMonthShort(TARDE, loc), loc).not.toContain('.')
		}
	})

	it('dayNum devolve só o número do dia', () => {
		expect(fmtDayNum(TARDE, 'pt-BR')).toBe('24')
	})

	it('dateTime junta dd/mm/aaaa com a hora em 24h', () => {
		expect(fmtDateTime(TARDE, 'pt-BR')).toMatch(/^24\/09\/2026.*19[:.]30$/)
	})
})

describe('entrada inválida', () => {
	// Sem esta guarda, um timestamp nulo ou quebrado vindo da API escreveria
	// "Invalid Date" no meio do calendário.
	it('devolve um travessão em vez de "Invalid Date"', () => {
		for (const ruim of ['', 'nao-e-data', 'null']) {
			expect(fmtTime(ruim, 'pt-BR'), ruim).toBe('—')
			expect(fmtDate(ruim, 'pt-BR'), ruim).toBe('—')
			expect(fmtDateLong(ruim, 'pt-BR'), ruim).toBe('—')
		}
	})

	// O caminho real é string ISO vinda da API; comparar com o Date equivalente
	// verifica o parse sem amarrar a expectativa a um fuso.
	it('aceita string ISO e número, não só Date', () => {
		expect(fmtDateTime(TARDE.toISOString(), 'pt-BR')).toBe(fmtDateTime(TARDE, 'pt-BR'))
		expect(fmtDate(TARDE.getTime(), 'pt-BR')).toBe('24/09/2026')
	})
})
