/**
 * Linkify — convert bare URLs and @mentions to clickable <a> tags
 *
 * Used in two contexts:
 *  - Chat messages (HTML content from sanitize-html/TipTap): process text nodes only
 *  - Whisper messages (plain text): split approach, no XSS risk
 */

const URL_REGEX      = /(https?:\/\/[^\s<>"'{}|\\^`[\]]+)/g
const MENTION_REGEX  = /(?:^|\s)@([a-zA-Z0-9_-]{2,32})/g

// Alias de personagem (módulo trik): `@[Nome do Personagem](username)`.
// O nome entre colchetes é só o rótulo exibido; o alvo do link e da notificação
// é o username entre parênteses — um alias é um apelido DO JOGADOR, não uma
// entidade mencionável à parte.
//
// ATENÇÃO: o mesmo formato vive no servidor, em
// nodyx-core/src/utils/mentions.ts (é ele que notifica). Bundles separados, sem
// módulo comum: mudar um exige mudar o outro. Os dois têm teste.
const ALIAS_MENTION_REGEX = /(^|\s)@\[([^\]\n]{1,100})\]\(([^)\s\n]{2,50})\)/g

// Escape ASSIMÉTRICO, e a assimetria é o ponto:
//
//  · o NOME EXIBIDO entra como conteúdo e NÃO é escapado aqui. `linkifyHtml`
//    recebe HTML já sanitizado no servidor, então o texto já traz suas
//    entidades (`&lt;`). Escapá-lo de novo daria `&amp;lt;` e o usuário leria
//    "&lt;" na tela em vez de "<".
//  · o USERNAME entra num ATRIBUTO (`href="…"`), e o charset do alias é
//    permissivo por desenho (o `)` é que delimita). Um `"` cru fecharia o
//    atributo e permitiria injetar outro, então ele é escapado.
//
// `&` fica de fora de propósito: num nó de texto HTML ele já vem como `&amp;`,
// e reescapá-lo corromperia o username no href.
const ATTR_ESCAPES: Record<string, string> = {
  '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;',
}
function escapeAttr(v: string): string {
  return v.replace(/["'<>]/g, (c) => ATTR_ESCAPES[c] ?? c)
}

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

/**
 * Aplica `transform` APENAS aos nós de texto, preservando todo o markup.
 *
 * Extraído de linkifyHtml para que renderAliasMentions reuse exatamente a mesma
 * contagem de <a>/<pre>/<code> — é a parte delicada daqui (uma versão antiga
 * transformava DENTRO dos atributos e quebrava as imagens do chat, cf
 * linkify.test.ts). Duplicá-la seria repetir o bug em dois lugares.
 */
function mapTextNodes(
  html: string,
  transform: (part: string, ctx: { insideCode: boolean }) => string,
): string {
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
        return part
      }
      if (insideAnchor > 0) return part  // nunca dentro de um <a> existente
      return transform(part, { insideCode: insideCode > 0 })
    })
    .join('')
}

/** O <a> de um alias: nome do personagem visível, jogador no href. */
function aliasAnchors(part: string): string {
  return part.replace(
    ALIAS_MENTION_REGEX,
    (_full: string, lead: string, display: string, username: string) =>
      `${lead}<a href="/users/${escapeAttr(username)}" class="text-indigo-400 hover:text-indigo-300 font-medium" style="text-decoration: none">${display}</a>`,
  )
}

/**
 * Renderiza SÓ os aliases de personagem, sem tocar em URLs nuas nem em
 * `@username`.
 *
 * Existe para o fórum, que renderiza `{@html post.content}` cru: sem isto, uma
 * cena mostraria o texto literal `@[Kaelen Duvray](rafael)`. Usar linkifyHtml
 * ali passaria a transformar URLs e @menções que hoje aparecem como texto — uma
 * mudança de comportamento que este recurso não pediu.
 */
export function renderAliasMentions(html: string): string {
  if (!html.includes('@[')) return html
  return mapTextNodes(html, (part, { insideCode }) => (insideCode ? part : aliasAnchors(part)))
}

export function linkifyHtml(html: string): string {
  // Fast-path: if the content has neither a URL nor a mention, skip
  if (!html.includes('http') && !html.includes('@')) return html

  return mapTextNodes(html, (part, { insideCode }) => {
    // Alias antes da menção simples: a saída do alias não contém `@` nem
    // `http`, então nem MENTION_REGEX nem URL_REGEX a reescaneiam.
    const aliased = insideCode ? part : aliasAnchors(part)

    const mentioned = insideCode ? aliased : aliased.replace(MENTION_REGEX, (full: string, username: string) => {
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
// Um regex para as duas formas. A alternativa do alias vem PRIMEIRO, senão
// `@[Kaelen](rafael)` nunca seria alcançada pela forma simples logo atrás.
//   grupo 1 = espaço/início   2 = nome exibido   3 = username do alias
//   grupo 4 = username da menção simples
const ANY_MENTION_RE  = /(^|\s)(?:@\[([^\]\n]{1,100})\]\(([^)\s\n]{2,50})\)|@([a-zA-Z0-9_-]{2,32}))/g

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
    for (const mm of t.matchAll(ANY_MENTION_RE)) {
      const idx  = mm.index ?? 0
      const lead = mm[1] ?? ''
      const mentionStart = idx + lead.length
      if (mentionStart > li) {
        final.push({ type: 'text', value: t.slice(li, mentionStart) })
      }
      if (mm[3]) {
        // Alias: exibe o nome do personagem, aponta para o jogador. Sem `@` no
        // texto — numa cena o nome tem de se ler como nome.
        final.push({ type: 'mention', value: mm[2], username: mm[3] })
      } else {
        final.push({ type: 'mention', value: '@' + mm[4], username: mm[4] })
      }
      li = idx + mm[0].length
    }
    if (li < t.length) {
      final.push({ type: 'text', value: t.slice(li) })
    }
  }
  return final
}
