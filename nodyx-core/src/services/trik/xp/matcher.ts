/**
 * Módulo RPG (trik) — Fluxo 1 (Fase 2): identifica qual personagem do autor
 * escreveu a cena, comparando template_name/template_signature (Fase 1,
 * /plaquinha) contra o header já em texto puro (ver sceneParser.ts).
 * Ver plans/fase-dois.md, seção "Fluxo 1", item 2.
 */

import { getCharactersWithTemplate } from '../../../models/trik'
import type { TrikCharacter } from '../../../models/trik'

/**
 * Colapsa qualquer sequência de espaço em branco (espaço, tab, quebra de
 * linha, &nbsp; já decodificado) num único espaço. Headers decorativos de
 * RPG costumam usar espaçamento duplo/nbsp pra separar visualmente nome ·
 * pronome · panteão etc — o template_name salvo via /plaquinha normalmente
 * não tem esse espaçamento extra, então comparar os textos crus faz um
 * personagem real nunca bater (visto num post real: "NOME  SOBRENOME" no
 * header vs "NOME SOBRENOME" salvo — só a assinatura batia, o nome não).
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Personagens do autor cujo template_name E template_signature aparecem
 * como substring no header (ambos normalizados por espaço em branco, ver
 * normalizeWhitespace). Exatamente 1 match → devolve o personagem.
 * 0 matches → null (sem crédito). Mais de 1 match (assinaturas parecidas
 * entre dois personagens do mesmo jogador) → **a definir** no fase-dois.md;
 * por ora loga um aviso e não credita, pra não arriscar creditar o
 * personagem errado.
 */
export async function matchCharacterByHeader(playerId: string, header: string): Promise<TrikCharacter | null> {
  const normalizedHeader = normalizeWhitespace(header)
  const candidates = await getCharactersWithTemplate(playerId)
  const matches = candidates.filter(c =>
    normalizedHeader.includes(normalizeWhitespace(c.template_name!)) &&
    normalizedHeader.includes(normalizeWhitespace(c.template_signature!))
  )
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    console.warn(`[trik:xp] header ambíguo pro jogador ${playerId}: ${matches.length} personagens batem, nenhum creditado`)
  }
  return null
}
