/**
 * Linkify — convert bare URLs and @mentions to clickable <a> tags
 *
 * Used in two contexts:
 *  - Chat messages (HTML content from sanitize-html/TipTap): process text nodes only
 *  - Whisper messages (plain text): split approach, no XSS risk
 */

const URL_REGEX      = /(https?:\/\/[^\s<>"'{}|\\^`[\]]+)/g
const MENTION_REGEX  = /(?:^|\s)@([a-zA-Z0-9_-]{2,32})/g

// ── For HTML content (chat) ───────────────────────────────────────────────────
// Tokeniza por TAG: o HTML é cortado em [texto, <tag>, texto, <tag>, …] e só os
// trechos de TEXTO são linkificados — o markup das tags (atributos de <img>,
// <iframe>, <video>…) nunca é tocado. Uma versão anterior cortava só em <a>/</a>
// e rodava os regex sobre todo o resto, inclusive dentro das tags: a URL de
// `<img src="https://…">` virava um <a> DENTRO do atributo e a imagem quebrava.
//
// Isso ainda cobre o que aquela versão queria consertar: o texto antes da
// primeira tag, depois da última e mensagens só de texto (sem tag nenhuma) são
// tokens de texto como quaisquer outros — é onde uma mensagem composta por bot
// como `<strong>Nome</strong> … por @user.` põe a @menção.
//
// Dentro de um <a> já existente nada é linkificado (evita link duplo). Dentro de
// <pre>/<code> só URLs viram link (como sempre), @menções não: "@algo" em código
// é código, não uma menção.
// Menções rodam ANTES das URLs: a saída de uma menção (`<a>@user</a>`) nunca
// casa com URL_REGEX, mas o inverso poderia — `https://x.com/@bob` já viraria
// <a> e reescanear o texto dele por @menções aninharia um segundo <a>.

const TAG_SPLIT_RE    = /(<[^>]*>)/
const ANCHOR_OPEN_RE  = /^<a(?:\s[^>]*)?>$/i
const ANCHOR_CLOSE_RE = /^<\/a\s*>$/i
const CODE_OPEN_RE    = /^<(?:pre|code)(?:\s[^>]*)?>$/i
const CODE_CLOSE_RE   = /^<\/(?:pre|code)\s*>$/i

export function linkifyHtml(html: string): string {
  // Fast-path: if the content has neither a URL nor a mention, skip
  if (!html.includes('http') && !html.includes('@')) return html

  let insideAnchor = 0
  let insideCode   = 0
  // Com grupo de captura, split() põe as tags nos índices ÍMPARES.
  return html
    .split(TAG_SPLIT_RE)
    .map((part, i) => {
      if (i % 2 === 1) {
        if (ANCHOR_OPEN_RE.test(part))       insideAnchor++
        else if (ANCHOR_CLOSE_RE.test(part)) insideAnchor = Math.max(0, insideAnchor - 1)
        else if (CODE_OPEN_RE.test(part))    insideCode++
        else if (CODE_CLOSE_RE.test(part))   insideCode = Math.max(0, insideCode - 1)
        return part // a tag em si nunca é alterada
      }
      if (insideAnchor > 0) return part  // don't linkify inside an existing <a>

      const mentioned = insideCode > 0 ? part : part.replace(MENTION_REGEX, (full: string, username: string) => {
        const leading = full.startsWith('@') ? '' : full[0]
        // `.nodyx-prose a` (app.css) sets text-decoration:underline at
        // higher specificity than the `no-underline` utility class, so the
        // class alone loses — same fix already used elsewhere in this
        // codebase for the same rule (chat/+page.svelte link-preview card).
        return `${leading}<a href="/users/${username}" class="text-indigo-400 hover:text-indigo-300 font-medium" style="text-decoration: none">@${username}</a>`
      })
      return mentioned.replace(URL_REGEX, (url: string) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:text-indigo-300 underline break-all">${url}</a>`
      )
    })
    .join('')
}

// ── For plain text (whisper) ──────────────────────────────────────────────────
// Returns an array of segments: { type: 'text'|'url', value: string }
// Rendered safely without XSS (use Svelte {segment.value} for text).

export interface TextSegment { type: 'text'; value: string }
export interface UrlSegment  { type: 'url';  value: string }
export type Segment = TextSegment | UrlSegment

export function linkifyText(content: string): Segment[] {
  const segments: Segment[] = []
  let last = 0
  for (const match of content.matchAll(URL_REGEX)) {
    const start = match.index!
    if (start > last) segments.push({ type: 'text', value: content.slice(last, start) })
    segments.push({ type: 'url', value: match[0] })
    last = start + match[0].length
  }
  if (last < content.length) segments.push({ type: 'text', value: content.slice(last) })
  return segments.length ? segments : [{ type: 'text', value: content }]
}

// ── Version enrichie avec @mentions (utilisée par MessageBody) ───────────────
// Strip trailing punctuation et détecte les mentions @username Nodyx en
// plus des URLs. Le segment 'url' embarque maintenant un `href` distinct du
// `value` (qui est ce qu'on affiche, identique au href pour les URLs nues).

export type ExtSegment =
  | { type: 'text';    value: string }
  | { type: 'url';     value: string; href: string }
  | { type: 'mention'; value: string; username: string }

// Matche les URLs absolues (https://…) ET les paths internes Nodyx
// (/uploads/…), pour rendre cliquables/inline-images les fichiers uploadés
// même quand l'URL est relative.
const URL_RE_TRIMMED  = /(?:\bhttps?:\/\/[^\s<>"']+|\/uploads\/[^\s<>"']+)/gi
const TRAILING_PUNCT  = /[.,;:!?)\]}»>"']+$/
const MENTION_RE      = /(?:^|\s)@([a-zA-Z0-9_-]{2,32})/g

export function linkify(text: string): ExtSegment[] {
  if (!text) return []
  const out: ExtSegment[] = []
  // Pass 1 : URLs (avec strip de la ponctuation finale)
  let lastIndex = 0
  for (const m of text.matchAll(URL_RE_TRIMMED)) {
    const start = m.index ?? 0
    let url = m[0]
    while (TRAILING_PUNCT.test(url)) url = url.replace(TRAILING_PUNCT, '')
    if (start > lastIndex) {
      out.push({ type: 'text', value: text.slice(lastIndex, start) })
    }
    out.push({ type: 'url', value: url, href: url })
    lastIndex = start + url.length
  }
  if (lastIndex < text.length) {
    out.push({ type: 'text', value: text.slice(lastIndex) })
  }
  // Pass 2 : mentions à l'intérieur des segments text
  const final: ExtSegment[] = []
  for (const seg of out) {
    if (seg.type !== 'text') { final.push(seg); continue }
    const t = seg.value
    let li = 0
    for (const mm of t.matchAll(MENTION_RE)) {
      const idx = mm.index ?? 0
      const fullMatch = mm[0]
      const username  = mm[1]
      const leadingWs = fullMatch.startsWith('@') ? '' : fullMatch[0]
      const mentionStart = idx + leadingWs.length
      if (mentionStart > li) {
        final.push({ type: 'text', value: t.slice(li, mentionStart) })
      }
      final.push({ type: 'mention', value: '@' + username, username })
      li = mentionStart + (fullMatch.length - leadingWs.length)
    }
    if (li < t.length) {
      final.push({ type: 'text', value: t.slice(li) })
    }
  }
  return final
}
