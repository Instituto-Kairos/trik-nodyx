/**
 * Módulo RPG (trik) — /plaquinha.
 * Ver plans/fase-um.md, seção 4.
 *
 * template_name/template_signature são as âncoras que a Fase 2 usa pra
 * reconhecer qual personagem escreveu uma cena (substring no cabeçalho).
 */

import { getPlayer } from '../../../models/trik'
import { getCharacterById, updateCharacterTemplate, type TrikCharacter } from '../../../models/trik'

export type PlaquinhaResult =
  | { ok: true; character: TrikCharacter }
  | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION'; message: string }

export async function submitPlaquinha(
  userId: string,
  characterId: string,
  templateName: string,
  templateSignature: string
): Promise<PlaquinhaResult> {
  if (!templateName.trim() || !templateSignature.trim()) {
    return { ok: false, code: 'VALIDATION', message: 'Nome e assinatura da plaquinha não podem ficar vazios' }
  }

  const character = await getCharacterById(characterId)
  if (!character) {
    return { ok: false, code: 'NOT_FOUND', message: 'Personagem não encontrado' }
  }

  const player = await getPlayer(userId)
  if (!player || character.player_id !== player.id) {
    return { ok: false, code: 'FORBIDDEN', message: 'Esse personagem não pertence a você' }
  }

  const updated = await updateCharacterTemplate(characterId, templateName.trim(), templateSignature.trim())
  return { ok: true, character: updated }
}
