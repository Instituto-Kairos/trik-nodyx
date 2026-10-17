/**
 * Módulo RPG (trik) — Fase 3: clima da semana em jogo (plano §2.4, §3).
 *
 * Ao selecionar a semana, busca os 7 dias de cada região na Open-Meteo
 * Historical, grava em trik_weather e posta um aviso só no canal de
 * propósito Clima. Dados de 2020 são definitivos: região que já tem os 7 dias
 * gravados não é buscada de novo.
 *
 * As funções puras (mapeamento do weather_code, horário da chuva, alertas,
 * texto do aviso) ficam exportadas pro motor de bônus e pros testes.
 */

import * as TrikEffects from '../../models/trikEffects'
import { getChannelPurposes } from '../../models/trik'
import { postTrikMessage } from './bot'
import { botSafe } from './text'

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const FETCH_TIMEOUT_MS = 15_000

// ─── Clima (weather_code WMO → lista fixa) ──────────────────────────────────

export const CLIMATES = ['sol', 'nublado', 'neblina', 'garoa', 'chuva', 'tempestade', 'neve'] as const
export type Climate = (typeof CLIMATES)[number]

const CLIMATE_LABEL: Record<Climate, string> = {
  sol: '☀️ Sol', nublado: '☁️ Nublado', neblina: '🌫️ Neblina', garoa: '🌦️ Garoa',
  chuva: '🌧️ Chuva', tempestade: '⛈️ Tempestade', neve: '❄️ Neve',
}

export function climateFromCode(code: number | null): Climate | null {
  if (code === null) return null
  if (code <= 1) return 'sol'
  if (code <= 3) return 'nublado'
  if (code === 45 || code === 48) return 'neblina'
  if (code >= 51 && code <= 57) return 'garoa'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'chuva'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'neve'
  if (code >= 95) return 'tempestade'
  return null
}

// ─── Horário da chuva ───────────────────────────────────────────────────────

/** Hora com ≥ 0.5 mm conta como chuva; abaixo é chuvisco e é ignorado. */
export const RAIN_HOUR_MM = 0.5
/** Bloco com pelo menos tantas horas vira "o dia todo". */
const ALL_DAY_HOURS = 20

const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`

/**
 * `precipitation[i]` é a chuva da hora que TERMINA em i+1 (posição 0 = 00–01h,
 * 23 = 23–24h) — a Open-Meteo rotula cada hora pelo fim do intervalo, quem
 * chama já desloca. Blocos separados por até 1 h seca se juntam; mais de 2
 * blocos → espalhada. Null quando nenhuma hora passa do limite.
 */
export function rainHours(precipitation: (number | null)[]): string | null {
  const blocks: [number, number][] = []
  precipitation.forEach((mm, i) => {
    if ((mm ?? 0) < RAIN_HOUR_MM) return
    const last = blocks[blocks.length - 1]
    if (last && i - last[1] <= 1) last[1] = i + 1
    else blocks.push([i, i + 1])
  })
  if (blocks.length === 0) return null
  if (blocks.length > 2) return 'espalhada ao longo do dia'
  if (blocks.length === 1 && blocks[0][1] - blocks[0][0] >= ALL_DAY_HOURS) return 'o dia todo'
  return blocks.map(([s, e]) => `das ${hh(s)} às ${hh(e)}`).join(' e ')
}

// ─── Alertas (plano §2.4) ───────────────────────────────────────────────────

export type AlertKind = (typeof TrikEffects.ALERT_KINDS)[number]
/** Ordem fixa do aviso (calor, frio, umidade) — espelha ALERT_KINDS do model. */
const ALERT_ORDER: readonly AlertKind[] = ['calor', 'frio', 'umidade']
export const ALERT_LEVELS = ['atencao', 'laranja', 'vermelho'] as const
export type AlertLevel = (typeof ALERT_LEVELS)[number]

export interface DayAlert { kind: AlertKind; level: AlertLevel }

/** Limites por nível, do mais fraco ao mais forte. */
const THRESHOLDS = {
  calor:   { above: true,  limits: [32, 35, 40] },
  frio:    { above: false, limits: [10, 5, 0] },
  umidade: { above: false, limits: [30, 20, 12] },
} as const

function levelFor(kind: AlertKind, value: number | null): AlertLevel | null {
  if (value === null || Number.isNaN(value)) return null
  const { above, limits } = THRESHOLDS[kind]
  let level: AlertLevel | null = null
  limits.forEach((limit, i) => {
    if (above ? value >= limit : value <= limit) level = ALERT_LEVELS[i]
  })
  return level
}

const num = (v: string | number | null) => (v === null ? null : Number(v))

/** Alertas do dia (no máximo um por tipo, o pior nível). Calor usa a máxima,
 *  frio a mínima, umidade a mínima relativa. */
export function dayAlerts(day: Pick<TrikEffects.TrikWeatherDay, 'temp_max' | 'temp_min' | 'humidity_min'>): DayAlert[] {
  const out: DayAlert[] = []
  const values: Record<AlertKind, number | null> = {
    calor: num(day.temp_max), frio: num(day.temp_min), umidade: num(day.humidity_min),
  }
  for (const kind of ALERT_ORDER) {
    const level = levelFor(kind, values[kind])
    if (level) out.push({ kind, level })
  }
  return out
}

const ALERT_TEXT: Record<AlertKind, Record<AlertLevel, string>> = {
  calor: {
    atencao:  '🟡 Calor · penaliza personagens sensíveis ao calor',
    laranja:  '🟠 Calor extremo · treino 0.5x · aula 0.75x · sem bônus (neutralizável)',
    vermelho: '🔴 Calor perigoso · treino proibido · aula sem efeito',
  },
  frio: {
    atencao:  '🟡 Frio · penaliza treino de personagens sensíveis ao frio',
    laranja:  '🟠 Frio intenso · treino 0.5x · sem bônus no treino (neutralizável)',
    vermelho: '🔴 Frio perigoso · treino proibido',
  },
  umidade: {
    atencao:  '🟡 Ar seco · penaliza personagens sensíveis à umidade',
    laranja:  '🟠 Ar muito seco · treino 0.5x · aula 0.75x · sem bônus (neutralizável)',
    vermelho: '🔴 Ar extremamente seco · treino proibido · aula sem efeito',
  },
}

// ─── Datas (sempre YYYY-MM-DD, aritmética em UTC pra não sofrer com fuso) ──

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const ddmmyyyy = (date: string) => `${ddmm(date)}/${date.slice(0, 4)}`
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
const hm = (t: string | null) => (t ? t.slice(0, 5) : '--:--')
const deg = (v: string | number | null) => (v === null ? '?' : `${Math.round(Number(v))}°`)

// ─── Aviso semanal (plano §3.4) ─────────────────────────────────────────────

const INDENT = '&nbsp;&nbsp;&nbsp;'

export function formatWeekNotice(
  weekStart: string,
  locations: Pick<TrikEffects.TrikLocation, 'id' | 'name'>[],
  weather: TrikEffects.TrikWeatherDay[],
): string {
  const weekEnd = addDays(weekStart, 6)
  const lines = [`🌦️ <strong>Clima da semana — ${ddmm(weekStart)} a ${ddmmyyyy(weekEnd)}</strong>`]

  for (const loc of locations) {
    const days = weather.filter(w => w.location_id === loc.id).sort((a, b) => a.game_date.localeCompare(b.game_date))
    if (days.length === 0) continue
    lines.push('', `📍 <strong>${botSafe(loc.name)}</strong>`)
    for (const d of days) {
      const climate = d.climate as Climate | null
      let sky = climate ? CLIMATE_LABEL[climate] : '❔ Sem dado'
      if (d.rain_hours && (climate === 'chuva' || climate === 'tempestade')) sky += ` ${d.rain_hours}`
      const humidity = d.humidity_min === null ? '' : ` · 💧 ${d.humidity_min}%`
      lines.push(
        `${weekday(d.game_date)} ${ddmm(d.game_date)} · ${sky} · 🌡️ ${deg(d.temp_max)}/${deg(d.temp_min)}` +
        `${humidity} · 🌅 ${hm(d.sunrise)} · 🌇 ${hm(d.sunset)}`
      )
      for (const a of dayAlerts(d)) lines.push(INDENT + ALERT_TEXT[a.kind][a.level])
    }
  }

  lines.push('', `Cenas desta semana devem usar Data: entre ${ddmmyyyy(weekStart)} e ${ddmmyyyy(weekEnd)}.`)
  return lines.join('<br>')
}

// ─── Open-Meteo ─────────────────────────────────────────────────────────────

interface ArchiveResponse {
  daily?: {
    time: string[]
    weather_code: (number | null)[]
    temperature_2m_max: (number | null)[]
    temperature_2m_min: (number | null)[]
    relative_humidity_2m_min: (number | null)[]
    sunrise: string[]
    sunset: string[]
  }
  hourly?: { time: string[]; precipitation: (number | null)[] }
}

/** Busca os 7 dias de uma região. Horários já no fuso local (timezone=auto). */
export async function fetchWeekWeather(
  location: Pick<TrikEffects.TrikLocation, 'id' | 'latitude' | 'longitude'>,
  weekStart: string,
): Promise<TrikEffects.WeatherDayInput[]> {
  const weekEnd = addDays(weekStart, 6)
  const params = new URLSearchParams({
    latitude:   String(location.latitude),
    longitude:  String(location.longitude),
    start_date: weekStart,
    // +1 dia: a chuva das 23–24h do sábado vem rotulada 00:00 de domingo.
    end_date:   addDays(weekEnd, 1),
    daily:      'weather_code,temperature_2m_max,temperature_2m_min,relative_humidity_2m_min,sunrise,sunset',
    hourly:     'precipitation',
    timezone:   'auto',
  })
  const res = await fetch(`${ARCHIVE_URL}?${params}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const data = await res.json() as ArchiveResponse
  if (!data.daily || !data.hourly) throw new Error('Open-Meteo: resposta sem daily/hourly')

  // Chuva por data: rótulo H cobre (H-1)..H, então desloca uma hora pra trás.
  const rainByDate = new Map<string, (number | null)[]>()
  data.hourly.time.forEach((t, i) => {
    const prev = new Date(`${t}:00Z`)
    prev.setUTCHours(prev.getUTCHours() - 1)
    const date = prev.toISOString().slice(0, 10)
    const hour = prev.getUTCHours()
    if (!rainByDate.has(date)) rainByDate.set(date, new Array(24).fill(null))
    rainByDate.get(date)![hour] = data.hourly!.precipitation[i]
  })

  const d = data.daily
  return d.time
    .map((date, i) => ({ date, i }))
    .filter(({ date }) => date >= weekStart && date <= weekEnd)
    .map(({ date, i }) => {
      const climate = climateFromCode(d.weather_code[i])
      const rain = climate === 'chuva' || climate === 'tempestade'
        ? rainHours(rainByDate.get(date) ?? [])
        : null
      return {
        location_id:  location.id,
        game_date:    date,
        weather_code: d.weather_code[i],
        climate,
        sunrise:      d.sunrise[i]?.slice(11, 16) ?? null,
        sunset:       d.sunset[i]?.slice(11, 16) ?? null,
        temp_max:     d.temperature_2m_max[i],
        temp_min:     d.temperature_2m_min[i],
        humidity_min: d.relative_humidity_2m_min[i] === null ? null : Math.round(d.relative_humidity_2m_min[i]!),
        rain_hours:   rain,
      }
    })
}

export interface WeekSyncResult {
  weather:    TrikEffects.TrikWeatherDay[]
  /** Regiões cuja busca falhou (nome) — ficam sem clima até a próxima seleção. */
  failed:     string[]
  noticeSent: boolean
}

/**
 * Garante os 7 dias de cada região gravados e posta o aviso no canal Clima
 * (se houver um configurado). Falha de uma região não impede as outras.
 */
export async function syncGameWeek(weekStart: string): Promise<WeekSyncResult> {
  const locations = await TrikEffects.listLocations()
  const stored = await TrikEffects.listWeatherWeek(weekStart)
  const failed: string[] = []

  for (const loc of locations) {
    if (stored.filter(w => w.location_id === loc.id).length >= 7) continue
    try {
      await TrikEffects.saveWeatherDays(await fetchWeekWeather(loc, weekStart))
    } catch (err) {
      console.error(`[trik] clima de ${loc.name} (${weekStart}) falhou:`, err)
      failed.push(loc.name)
    }
  }

  const weather = await TrikEffects.listWeatherWeek(weekStart)
  const channelId = (await getChannelPurposes()).find(p => p.purpose === 'clima')?.channel_id ?? null
  let noticeSent = false
  if (channelId && weather.length > 0) {
    await postTrikMessage(channelId, formatWeekNotice(weekStart, locations, weather))
    noticeSent = true
  }
  return { weather, failed, noticeSent }
}
