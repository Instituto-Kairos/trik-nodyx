// Módulo RPG (trik) — Fase 3: funções puras do clima (services/trik/weather).

import { describe, it, expect, vi } from 'vitest'

vi.mock('../config/database', () => ({ db: { query: vi.fn() } }))
vi.mock('../services/trik/bot', () => ({ postTrikMessage: vi.fn() }))

import { climateFromCode, rainHours, dayAlerts, formatWeekNotice, addDays } from '../services/trik/weather'

const hours = (rainy: number[], mm = 1) => Array.from({ length: 24 }, (_, i) => (rainy.includes(i) ? mm : 0))

describe('climateFromCode', () => {
  it('mapeia os grupos WMO pra lista fixa', () => {
    expect([0, 1, 2, 3, 45, 51, 61, 80, 71, 95].map(climateFromCode))
      .toEqual(['sol', 'sol', 'nublado', 'nublado', 'neblina', 'garoa', 'chuva', 'chuva', 'neve', 'tempestade'])
    expect(climateFromCode(null)).toBeNull()
  })
})

describe('rainHours', () => {
  it('um bloco → das X às Y (fim = fim da última hora)', () => {
    expect(rainHours(hours([14, 15, 16]))).toBe('das 14:00 às 17:00')
  })
  it('ignora chuvisco abaixo de 0.5 mm', () => {
    expect(rainHours(hours([14], 0.4))).toBeNull()
  })
  it('junta blocos separados por 1 h seca, não por 2', () => {
    expect(rainHours(hours([10, 12]))).toBe('das 10:00 às 13:00')
    expect(rainHours(hours([10, 13]))).toBe('das 10:00 às 11:00 e das 13:00 às 14:00')
  })
  it('mais de 2 blocos → espalhada; quase o dia todo → o dia todo', () => {
    expect(rainHours(hours([2, 8, 15]))).toBe('espalhada ao longo do dia')
    expect(rainHours(hours(Array.from({ length: 21 }, (_, i) => i + 2)))).toBe('o dia todo')
  })
  it('chuva até meia-noite fecha em 00:00', () => {
    expect(rainHours(hours([22, 23]))).toBe('das 22:00 às 00:00')
  })
})

describe('dayAlerts', () => {
  const day = (temp_max: number, temp_min: number, humidity_min: number) =>
    ({ temp_max: String(temp_max), temp_min: String(temp_min), humidity_min })

  it('dia comum não tem alerta', () => {
    expect(dayAlerts(day(31.9, 10.1, 31))).toEqual([])
  })
  it('limites são inclusivos e vale o pior nível de cada tipo', () => {
    expect(dayAlerts(day(32, 10, 30))).toEqual([
      { kind: 'calor', level: 'atencao' }, { kind: 'frio', level: 'atencao' }, { kind: 'umidade', level: 'atencao' },
    ])
    expect(dayAlerts(day(35, 5, 20)).map(a => a.level)).toEqual(['laranja', 'laranja', 'laranja'])
    expect(dayAlerts(day(40, 0, 12)).map(a => a.level)).toEqual(['vermelho', 'vermelho', 'vermelho'])
  })
})

describe('formatWeekNotice', () => {
  it('monta o aviso com chuva parcial, alertas e o lembrete de Data', () => {
    const base = { location_id: 'l1', weather_code: 61, sunrise: '06:20:00', sunset: '20:04:00' }
    const text = formatWeekNotice('2020-07-26', [{ id: 'l1', name: 'Nova Orleans' }], [
      { ...base, game_date: '2020-07-27', climate: 'chuva', temp_max: '31.2', temp_min: '24.6', humidity_min: 55, rain_hours: 'das 14:00 às 17:00' },
      { ...base, game_date: '2020-07-26', climate: 'sol', weather_code: 0, temp_max: '35.4', temp_min: '25.0', humidity_min: 50, rain_hours: null },
    ])
    const lines = text.split('<br>')
    expect(lines[0]).toContain('26/07 a 01/08/2020')
    expect(lines[3]).toBe('Dom 26/07 · ☀️ Sol · 🌡️ 35°/25° · 💧 50% · 🌅 06:20 · 🌇 20:04')
    expect(lines[4]).toContain('🟠 Calor extremo')
    expect(lines[5]).toBe('Seg 27/07 · 🌧️ Chuva das 14:00 às 17:00 · 🌡️ 31°/25° · 💧 55% · 🌅 06:20 · 🌇 20:04')
    expect(lines.at(-1)).toBe('Cenas desta semana devem usar Data: entre 26/07/2020 e 01/08/2020.')
  })
})

describe('addDays', () => {
  it('cruza mês e ano', () => {
    expect(addDays('2020-07-26', 6)).toBe('2020-08-01')
    expect(addDays('2020-12-27', 6)).toBe('2021-01-02')
  })
})
