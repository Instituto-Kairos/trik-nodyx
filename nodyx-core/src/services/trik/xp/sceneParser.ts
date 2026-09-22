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

function stripTags(html: string): string {
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
