import { derived } from 'svelte/store'
import { locale } from './i18n'

/**
 * Formatação de data e hora ancorada no idioma DO APP, não no do navegador.
 *
 * Antes disto os três lugares que mostram eventos discordavam entre si:
 *  - `calendar/+page.svelte` passava `[]` a toLocaleTimeString, ou seja o
 *    locale do NAVEGADOR: um visitante com Chrome em en-US lia "3:30 PM" numa
 *    instância inteiramente em português;
 *  - `calendar/[id]/+page.svelte` tinha 'fr-FR' fixo, então os nomes de mês e
 *    de dia da semana saíam em francês em qualquer instância;
 *  - a agenda da home escolhia `instance.language === 'fr' ? 'fr-FR' : 'en-US'`,
 *    o que joga toda instância não-francesa no formato americano.
 *
 * A HORA é sempre 24h, em todos os idiomas. Isso é decisão de produto, não de
 * localização — `hourCycle: 'h23'` e não `hour12: false`, porque o segundo já
 * resolveu para o ciclo h24 em alguns motores, e h24 escreve "24:00" em vez de
 * "00:00" à meia-noite.
 *
 * As funções são puras e recebem o locale para poderem ser testadas sem store;
 * componentes usam o store `datetime`, que já as amarra ao idioma corrente.
 */

/** Aceita o que a API devolve (ISO string) ou um Date já pronto. */
export type DateLike = string | number | Date

function toDate(value: DateLike): Date {
	return value instanceof Date ? value : new Date(value)
}

/**
 * Chave de cache dos Intl.DateTimeFormat. Construir um formatador é a parte
 * cara do Intl, e estas funções são chamadas dentro de `{#each}` — o
 * calendário formata data e hora de cada evento a cada re-render.
 */
const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(loc: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = loc + '|' + JSON.stringify(opts)
	let fmt = cache.get(key)
	if (!fmt) {
		fmt = new Intl.DateTimeFormat(loc, opts)
		cache.set(key, fmt)
	}
	return fmt
}

/**
 * `allDay`: evento de dia inteiro é uma data de calendário guardada como
 * meia-noite UTC (ver `valueToIso` em $lib/dateMask). Formatado no fuso local,
 * o dia 6 às 00:00Z sai "5 de outubro" em qualquer fuso a oeste de Greenwich —
 * então ele é lido em UTC, que devolve exatamente o dia gravado.
 */
function format(value: DateLike, loc: string, opts: Intl.DateTimeFormatOptions, allDay = false): string {
	const d = toDate(value)
	// Data inválida formataria como "Invalid Date" no meio da tela.
	if (Number.isNaN(d.getTime())) return '—'
	return formatter(loc, allDay ? { ...opts, timeZone: 'UTC' } : opts).format(d)
}

/** 24h sempre, em qualquer idioma: `19:30`. */
export function fmtTime(value: DateLike, loc: string): string {
	return format(value, loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** Numérica curta: `24/09/2026` em pt-BR, `09/24/2026` em en. */
export function fmtDate(value: DateLike, loc: string, allDay = false): string {
	return format(value, loc, { day: '2-digit', month: '2-digit', year: 'numeric' }, allDay)
}

/** Por extenso com dia da semana: `quarta-feira, 24 de setembro de 2026`. */
export function fmtDateLong(value: DateLike, loc: string, allDay = false): string {
	return format(value, loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, allDay)
}

/** Sem ano, para listas do mês corrente: `24 de set.`. */
export function fmtDateShort(value: DateLike, loc: string, allDay = false): string {
	return format(value, loc, { day: 'numeric', month: 'short' }, allDay)
}

/** Cabeçalho de agrupamento: `setembro de 2026`. */
export function fmtMonthYear(value: DateLike, loc: string, allDay = false): string {
	return format(value, loc, { month: 'long', year: 'numeric' }, allDay)
}

/**
 * Bloco de data dos cartões: `SET`.
 *
 * Sem o `replace`, pt-BR devolve "set." e o badge fica "SET." — os idiomas
 * abreviam mês com ponto (pt, fr, es) ou sem (en). Num quadradinho de 9px o
 * ponto só come espaço, então ele sai.
 */
export function fmtMonthShort(value: DateLike, loc: string, allDay = false): string {
	return format(value, loc, { month: 'short' }, allDay).replace(/\.+$/, '').toLocaleUpperCase(loc)
}

/** Só o número do dia, para o bloco de data dos cartões: `24`. */
export function fmtDayNum(value: DateLike, loc: string, allDay = false): string {
	return format(value, loc, { day: 'numeric' }, allDay)
}

/** Data e hora juntas: `24/09/2026 19:30`. */
export function fmtDateTime(value: DateLike, loc: string): string {
	return format(value, loc, {
		day: '2-digit', month: '2-digit', year: 'numeric',
		hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	})
}

/**
 * O dia de calendário de um instante, `yyyy-mm-dd`, para comparar "mesmo dia"
 * e "hoje" sem `toDateString`/`getDate`, que são sempre locais. Com `allDay`
 * lê em UTC, pelo mesmo motivo de `format`.
 */
export function calendarDay(value: DateLike, allDay = false): string {
	const d = toDate(value)
	if (Number.isNaN(d.getTime())) return ''
	const pad = (n: number) => String(n).padStart(2, '0')
	return allDay
		? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
		: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Quando o evento começa para quem está olhando. Para dia inteiro é a
 * meia-noite LOCAL do dia gravado — não a meia-noite UTC guardada, que em
 * Brasília cai às 21:00 da véspera e fecharia o RSVP 3 horas antes.
 */
export function eventStart(ev: { starts_at: DateLike; is_all_day?: boolean | null }): Date {
	const d = toDate(ev.starts_at)
	if (!ev.is_all_day) return d
	return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * As mesmas funções já amarradas ao idioma corrente. Num componente:
 *
 *   import { datetime } from '$lib/datetime'
 *   const dt = $derived($datetime)
 *   ...
 *   {dt.time(ev.starts_at)}
 */
export const datetime = derived(locale, ($locale) => ({
	time:       (v: DateLike) => fmtTime(v, $locale),
	date:       (v: DateLike, allDay = false) => fmtDate(v, $locale, allDay),
	dateLong:   (v: DateLike, allDay = false) => fmtDateLong(v, $locale, allDay),
	dateShort:  (v: DateLike, allDay = false) => fmtDateShort(v, $locale, allDay),
	monthYear:  (v: DateLike, allDay = false) => fmtMonthYear(v, $locale, allDay),
	monthShort: (v: DateLike, allDay = false) => fmtMonthShort(v, $locale, allDay),
	dayNum:     (v: DateLike, allDay = false) => fmtDayNum(v, $locale, allDay),
	dateTime:   (v: DateLike) => fmtDateTime(v, $locale),
}))
