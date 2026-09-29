/**
 * Máscara dd/mm/aaaa (e dd/mm/aaaa hh:mm) para campos de data digitados.
 *
 * Existe porque o formato de `<input type="date">` e `<input type="datetime-local">`
 * NÃO é controlável pela página: Chrome e Edge seguem o idioma da interface do
 * navegador, Firefox o formato regional do sistema, e o atributo `lang` é
 * ignorado pelos dois. Um jogador com o navegador em inglês via mm/dd/yyyy e
 * hora em AM/PM por mais que a instância esteja inteiramente em português — e
 * nada no HTML, no CSS ou no i18n muda isso.
 *
 * O valor produzido é exatamente o que os inputs nativos produziam
 * (`yyyy-mm-dd` e `yyyy-mm-ddThh:mm`), então nem a API nem as actions mudam.
 */

export type DateMode = 'date' | 'datetime'

/** Quantos dígitos cada modo consome: ddmmaaaa ou ddmmaaaahhmm. */
const TAMANHO: Record<DateMode, number> = { date: 8, datetime: 12 }

export function onlyDigits(raw: string, mode: DateMode = 'datetime'): string {
	return raw.replace(/\D/g, '').slice(0, TAMANHO[mode])
}

/**
 * Formata progressivamente enquanto se digita: `2` → `2`, `249` → `24/9`,
 * `24092026` → `24/09/2026`, `240920261930` → `24/09/2026 19:30`.
 *
 * As barras e os dois-pontos são inseridos, nunca digitados — tudo que não é
 * dígito é descartado antes. Isso é o que faz o apagar atravessar a pontuação:
 * o texto é sempre reconstruído a partir dos dígitos.
 */
export function mask(raw: string, mode: DateMode): string {
	const d = onlyDigits(raw, mode)
	if (d.length <= 2) return d
	if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
	if (d.length <= 8) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
	if (d.length <= 10) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)} ${d.slice(8)}`
	return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)} ${d.slice(8, 10)}:${d.slice(10)}`
}

/**
 * Máscara → o valor que o input nativo produzia (`yyyy-mm-dd` ou
 * `yyyy-mm-ddThh:mm`), ou null se ainda estiver incompleto ou não existir.
 *
 * A data é validada por reconstrução (`Date` + comparação dos três campos) e
 * não por faixa: `31/02/2026` passa em qualquer teste de faixa — dia ≤ 31,
 * mês ≤ 12 — mas o `Date` rola para 03/03 e a comparação denuncia.
 *
 * Só valida se a data EXISTE, não se ela faz sentido: "24/09/0024" e uma data
 * no futuro passam. Plausibilidade (idade mínima, fim depois do início) é
 * regra de negócio de quem chama, não da máscara.
 */
export function maskedToValue(masked: string, mode: DateMode): string | null {
	const d = onlyDigits(masked, mode)
	if (d.length !== TAMANHO[mode]) return null

	const day   = Number(d.slice(0, 2))
	const month = Number(d.slice(2, 4))
	const year  = Number(d.slice(4, 8))

	// Mês/dia zero e ano zero passariam pela reconstrução de formas estranhas
	// (mês 0 vira dezembro do ano anterior), então saem antes.
	if (day === 0 || month === 0 || month > 12 || year < 1) return null

	// `setFullYear` e não `new Date(year, ...)`: o construtor mapeia anos 0-99
	// para 1900+ano, então "24/09/0024" viraria 1924 e a comparação abaixo
	// rejeitaria a data por um motivo que não é o dela.
	const probe = new Date(0)
	probe.setFullYear(year, month - 1, day)
	if (
		probe.getFullYear() !== year ||
		probe.getMonth() !== month - 1 ||
		probe.getDate() !== day
	) return null

	const pad = (n: number) => String(n).padStart(2, '0')
	const data = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
	if (mode === 'date') return data

	// Relógio de 24h: 24:00 não existe, é 00:00 do dia seguinte.
	const hour   = Number(d.slice(8, 10))
	const minute = Number(d.slice(10, 12))
	if (hour > 23 || minute > 59) return null

	return `${data}T${pad(hour)}:${pad(minute)}`
}

/** `yyyy-mm-dd[Thh:mm]` → `dd/mm/aaaa[ hh:mm]`. Vazio para entrada inválida. */
export function valueToMasked(value: string | null | undefined, mode: DateMode): string {
	if (!value) return ''
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value)
	if (!m) return ''
	const [, year, month, day, hour, minute] = m
	const data = `${day}/${month}/${year}`
	if (mode === 'date') return data
	return hour !== undefined ? `${data} ${hour}:${minute}` : data
}

/**
 * Timestamp guardado (ISO com fuso, como a API devolve) → o valor local que o
 * campo mostra.
 *
 * Usa os getters locais de propósito. O caminho antigo dos formulários de
 * evento era `new Date(iso).toISOString().slice(0, 16)`, que devolve UTC — mas
 * `datetime-local` interpreta o texto como hora LOCAL. Num fuso UTC-4 isso
 * mostrava 22:00 onde o evento era 18:00, e salvar de novo deslocava o
 * registro outras 4 horas, a cada edição.
 *
 * `utc: true` é para evento de dia inteiro, que é guardado ancorado em
 * meia-noite UTC (ver `valueToIso`): lido com os getters locais, o dia 6 às
 * 00:00Z vira dia 5 às 21:00 em Brasília.
 */
export function isoToValue(
	source: string | number | Date | null | undefined,
	mode: DateMode,
	{ utc = false }: { utc?: boolean } = {},
): string {
	if (source === null || source === undefined || source === '') return ''
	const d = source instanceof Date ? source : new Date(source)
	if (Number.isNaN(d.getTime())) return ''

	const pad = (n: number) => String(n).padStart(2, '0')
	const year   = utc ? d.getUTCFullYear() : d.getFullYear()
	const month  = utc ? d.getUTCMonth()    : d.getMonth()
	const day    = utc ? d.getUTCDate()     : d.getDate()
	const hour   = utc ? d.getUTCHours()    : d.getHours()
	const minute = utc ? d.getUTCMinutes()  : d.getMinutes()
	const data = `${String(year).padStart(4, '0')}-${pad(month + 1)}-${pad(day)}`
	return mode === 'date' ? data : `${data}T${pad(hour)}:${pad(minute)}`
}

/**
 * Valor do campo → o ISO que vai para a API. O inverso de `isoToValue`, e
 * precisa rodar NO NAVEGADOR.
 *
 * - `yyyy-mm-ddThh:mm` é hora de parede de quem digitou, e só o navegador
 *   sabe o fuso dessa pessoa. Antes a conversão era feita na action do
 *   SvelteKit, que roda no servidor (UTC na AWS): 19:00 digitado em Brasília
 *   era gravado como 19:00Z e aparecia como 16:00.
 * - `yyyy-mm-dd` (dia inteiro) não é um instante, é uma data de calendário:
 *   o dia 6 é o dia 6 em qualquer fuso. Fica ancorado em meia-noite UTC, e
 *   quem exibe usa `timeZone: 'UTC'` (ver `$lib/datetime`) para ler de volta
 *   o mesmo dia.
 *
 * Vazio ou inválido → ''.
 */
export function valueToIso(value: string | null | undefined, mode: DateMode): string {
	if (!value) return ''
	if (mode === 'date') {
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(value)
		return m ? `${m[1]}T00:00:00.000Z` : ''
	}
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return ''
	const d = new Date(value)
	return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** Texto começado mas ainda não válido — o que acende o aviso no campo. */
export function isIncomplete(masked: string, mode: DateMode): boolean {
	return onlyDigits(masked, mode).length > 0 && maskedToValue(masked, mode) === null
}
