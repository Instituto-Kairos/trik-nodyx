/**
 * Módulo RPG (trik) — Fluxo 1 (Fase 2): separa um post de cena em
 * header / cena / footer.
 * Ver plans/fase-dois.md, seção "Fluxo 1", item 1, e
 * plans/fase-dois-passo-a-passo.md, passo 3.1.
 *
 * `content` chega aqui como HTML já sanitizado pelo editor TipTap (ver
 * routes/forums.ts, `sanitize(rehost.html)`), não texto puro — não existe
 * "\n" literal. Duas formas reais de produzir o separador de "pelo menos 3
 * quebras de linha", confirmadas contra posts de verdade (não só teoria):
 *
 *  1. Digitando direto no editor (Enter cria parágrafo novo): parágrafos
 *     vazios em sequência, `<p></p><p></p>` — como esperado a partir do
 *     comportamento do @tiptap/extension-paragraph.
 *  2. **Colando texto de fora** (Word, bloco de notas, outro fórum) — o
 *     caso real mais comum pra cenas longas de RPG: o parser de colagem do
 *     TipTap NÃO quebra em parágrafos novos, ele mantém tudo num único
 *     `<p>` e converte cada "\n" em `<br>`. Uma cena colada inteira vira
 *     `<p>header<br><br><br><br><br>cena...</p>`, sem nenhum `<p></p>`
 *     vazio — é exatamente o formato que apareceu no primeiro teste real
 *     (2026-09-15) e que a v1 deste parser não reconhecia (por isso "não
 *     encontrei a estrutura de cena" em toda cena colada).
 *
 * O separador aceita as duas formas: 2+ parágrafos vazios OU 3+ `<br>`
 * seguidos.
 */

export interface ParsedScene {
  header: string
  cena:   string
  footer: string // string vazia se não houver footer — lido por parseFooterTags
}

const SCENE_SEPARATOR = /(?:<p[^>]*>\s*<\/p>\s*){2,}|(?:<br\s*\/?>\s*){3,}/i

// Decodifica só as entidades mais comuns que o editor produz (espaço duplo
// vira &nbsp;) — não é um decoder HTML completo de propósito, evitar puxar
// mais uma dependência só pra isso.
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
}

export function stripTags(html: string): string {
  // <br> e fronteira de parágrafo viram quebra de linha ANTES de remover as
  // tags — senão duas linhas coladas (ex.: "...quiser<br>Olho pelo...")
  // grudam sem espaço nenhum ao tirar a tag, o que tanto polui a contagem
  // de caracteres quanto quebra o match de header (nome colado com o
  // próximo símbolo deixa de bater com o template_name salvo).
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
  const text = withBreaks.replace(/<[^>]*>/g, '')
  return text.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, m => HTML_ENTITIES[m] ?? m).trim()
}

/**
 * Divide o HTML em até 3 partes pelo separador (ver SCENE_SEPARATOR acima),
 * devolvendo texto puro (tags já removidas) em cada parte. Sem pelo menos
 * header + cena (menos de 2 blocos) → sem estrutura de plaquinha
 * reconhecível, não gera XP.
 */
export function parseScenePost(content: string): ParsedScene | null {
  const parts = content.split(SCENE_SEPARATOR)
  if (parts.length < 2) return null
  return {
    header: stripTags(parts[0]),
    cena:   stripTags(parts[1]),
    footer: stripTags(parts.slice(2).join(' ')),
  }
}

// Hashtags que nunca valem como NOME de arma/matéria: se aparecerem logo
// depois de #treino/#aula (ex.: "#treino #com fulano"), a tag fica sem par.
const RESERVED_TAGS = new Set(['treino', 'aula', 'tarefa', 'trabalho', 'com'])

export interface FooterTags {
  /** Nome candidato da arma (`#treino #espada` → 'espada'). Não é validado
   *  aqui — quem confere contra o catálogo é processScenePost. */
  treino?: string
  /** Nome candidato da matéria (`#aula #historia` → 'historia'). */
  aula?: string
}

/**
 * Lê `#treino #NOMEARMA` e `#aula #NOMEAULA` do footer (já em texto puro,
 * ver parseScenePost). O nome é a hashtag SEGUINTE na sequência — case
 * insensitive na tag-gatilho, o nome sai como digitado. Tag sem par (fim do
 * footer, ou seguida de outra tag reservada como #com) é ignorada: sem nome
 * não há o que procurar no catálogo. #tarefa/#trabalho ficam pra depois.
 */
export function parseFooterTags(footer: string): FooterTags {
  const tags = Array.from(footer.matchAll(/#([\wÀ-ÿ]+)/g), m => m[1])
  const result: FooterTags = {}
  tags.forEach((tag, i) => {
    const trigger = tag.toLowerCase()
    if (trigger !== 'treino' && trigger !== 'aula') return
    const next = tags[i + 1]
    if (!next || RESERVED_TAGS.has(next.toLowerCase())) return
    if (result[trigger] === undefined) result[trigger] = next
  })
  return result
}

/** `#lore` em qualquer parte do post (header, cena ou footer) — marca a cena
 *  de narrador (ver processScenePost). Recebe texto puro. Não casa
 *  `#lorena`, mas casa `#Lore`. */
export function hasLoreTag(text: string): boolean {
  return /#lore(?![\wÀ-ÿ])/i.test(text)
}

// ─── Fase 3: Data, Hora e #com (plans/fase-tres-bonus.md §5) ────────────────

export interface FooterMeta {
  /** `Data: dd/mm/aaaa` → 'YYYY-MM-DD'. Ausente ou data impossível → undefined. */
  gameDate?: string
  /** `Hora: HH:MM` (aceita também "14h" e "14h30") → 'HH:MM'. */
  gameTime?: string
  /** Nomes depois de `#com`, como digitados. Quem decide se é jogador ou NPC
   *  é o motor (confere em trik_characters). */
  companions: string[]
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function parseGameDate(text: string): string | undefined {
  const m = text.match(/\bdata\s*:\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})\b/i)
  if (!m) return undefined
  const day = Number(m[1]), month = Number(m[2])
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  // Confere se a data existe (31/02 vira março no Date — recusa).
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function parseGameTime(text: string): string | undefined {
  const m = text.match(/\bhora\s*:\s*(\d{1,2})\s*(?::|h)\s*(\d{2})?/i)
  if (!m) return undefined
  const h = Number(m[1]), min = Number(m[2] ?? 0)
  if (h > 23 || min > 59) return undefined
  return `${pad2(h)}:${pad2(min)}`
}

/**
 * `#com` aceita dois jeitos de escrever:
 *  - texto até o fim da linha (ou até a próxima hashtag), separado por
 *    vírgula, "e", "&" ou "/": `#com Ana Clara, Bruno e Caio`;
 *  - hashtags seguidas: `#com #Ana #Bruno` (para na primeira tag reservada).
 * Pode aparecer mais de uma vez; nomes repetidos contam uma vez só.
 */
function parseCompanions(text: string): string[] {
  const names: string[] = []
  for (const m of text.matchAll(/#com(?![\wÀ-ÿ])([^\n]*)/gi)) {
    const rest = m[1]
    const plain = rest.split('#')[0].trim()
    if (plain) {
      names.push(...plain.split(/\s*(?:,|;|&|\/|\be\b)\s*/i))
    } else {
      for (const t of rest.matchAll(/#([\wÀ-ÿ]+)/g)) {
        if (RESERVED_TAGS.has(t[1].toLowerCase()) || t[1].toLowerCase() === 'lore') break
        names.push(t[1])
      }
    }
  }
  const seen = new Set<string>()
  return names
    .map(n => n.trim().replace(/[.!]+$/, ''))
    .filter(n => {
      const key = n.toLowerCase()
      if (!n || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Lê Data, Hora e #com do footer (texto puro, ver parseScenePost). */
export function parseFooterMeta(footer: string): FooterMeta {
  return {
    gameDate:   parseGameDate(footer),
    gameTime:   parseGameTime(footer),
    companions: parseCompanions(footer),
  }
}
