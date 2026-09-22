/**
 * Módulo RPG (trik) — /registro.
 * Ver plans/fase-um.md, seção 3.
 *
 * Diferente do OctoGuard, isto não é interpretado a partir de texto de chat
 * — é chamado pela rota REST que o modal do frontend submete. Mesmo assim
 * segue a convenção do repo de nunca lançar exceção nos services: devolve
 * um resultado tipado, a rota decide o código HTTP.
 */

import {
  getPlayer, upsertPlayer,
  getCharactersByPlayer, findCharacterByName, createCharacter,
  type TrikPlayer, type TrikCharacter, type NewCharacterInput,
} from '../../../models/trik'

export type Principle = 'mente' | 'coracao' | 'corpo'
export type Conduct   = 'presenca' | 'proposito' | 'sangue'

export interface RegistroPayload {
  player?: {
    name: string
    pronouns?: string
    birthDate?: string
  }
  character: {
    name: string
    pronouns?: string
    birthDate?: string
    faceclaimName?: string
    faceclaimBirthDate?: string
    fichaLink: string
    pantheon?: string
    divineBond?: string
    divineGift?: string
    principlesPicked: Principle[]
    conductPicked: Conduct[]
  }
}

export type RegistroResult =
  | { ok: true; player: TrikPlayer; character: TrikCharacter }
  | { ok: false; code: 'VALIDATION' | 'DUPLICATE_NAME'; message: string }

export async function getPlayerAndCharacters(userId: string): Promise<{ player: TrikPlayer | null; characters: TrikCharacter[] }> {
  const player = await getPlayer(userId)
  const characters = player ? await getCharactersByPlayer(player.id) : []
  return { player, characters }
}

/**
 * Regra dos mockups de /registro: "ESCOLHA 2" em Mente/Coração/Corpo,
 * "ESCOLHA 1" em Propósito/Sangue/Presença — nem mais, nem menos.
 */
export function validatePointsSelection(character: RegistroPayload['character']): string | null {
  const principles = new Set(character.principlesPicked)
  const conduct = new Set(character.conductPicked)
  if (principles.size !== character.principlesPicked.length) {
    return 'Não repita a mesma opção em Mente/Coração/Corpo'
  }
  if (conduct.size !== character.conductPicked.length) {
    return 'Não repita a mesma opção em Propósito/Sangue/Presença'
  }
  if (character.principlesPicked.length !== 2) {
    return 'Escolha exatamente 2 entre Mente, Coração e Corpo'
  }
  if (character.conductPicked.length !== 1) {
    return 'Escolha exatamente 1 entre Propósito, Sangue e Presença'
  }
  return null
}

export async function submitRegistro(userId: string, payload: RegistroPayload): Promise<RegistroResult> {
  const validationError = validatePointsSelection(payload.character)
  if (validationError) {
    return { ok: false, code: 'VALIDATION', message: validationError }
  }

  let player = await getPlayer(userId)
  if (!player) {
    if (!payload.player?.name) {
      return { ok: false, code: 'VALIDATION', message: 'Dados de jogador são obrigatórios no primeiro registro' }
    }
    player = await upsertPlayer(userId, payload.player)
  }

  const existing = await findCharacterByName(player.id, payload.character.name)
  if (existing) {
    return { ok: false, code: 'DUPLICATE_NAME', message: 'Você já tem um personagem com esse nome' }
  }

  const { principlesPicked, conductPicked, ...rest } = payload.character
  const characterInput: NewCharacterInput = {
    ...rest,
    conductPresenca:   conductPicked.includes('presenca')  ? 1 : 0,
    conductProposito:  conductPicked.includes('proposito') ? 1 : 0,
    conductSangue:     conductPicked.includes('sangue')    ? 1 : 0,
    principlesMente:   principlesPicked.includes('mente')   ? 1 : 0,
    principlesCoracao: principlesPicked.includes('coracao') ? 1 : 0,
    principlesCorpo:   principlesPicked.includes('corpo')   ? 1 : 0,
  }
  const character = await createCharacter(player.id, characterInput)

  return { ok: true, player, character }
}
