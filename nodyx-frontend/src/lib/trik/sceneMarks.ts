// Marcas do bot Trik nos posts de cena (ver nodyx-core/src/services/trik/bot.ts):
// ✅ = a cena contou xp, ❌ = estava num tópico XP-elegível mas foi recusada.
// Clicar numa delas mostra a explicação em vez de reagir junto.

export const SCENE_COUNTED_EMOJI  = '✅'
export const SCENE_REJECTED_EMOJI = '❌'

// Códigos gravados em trik_scene_rejections.reason (SceneRejectionReason no core).
const REJECTION_MESSAGES: Record<string, string> = {
	no_structure:  'Não encontrei a estrutura de cena nesse post (cabeçalho + cena, separados por pelo menos 2 parágrafos em branco).',
	no_player:     'Você ainda não tem cadastro no módulo RPG — use /registro antes de postar uma cena.',
	no_match:      'Não consegui identificar seu personagem no cabeçalho dessa cena (confira se o nome/assinatura batem com o que foi salvo via /plaquinha).',
	below_minimum: 'Essa cena tem menos de 500 caracteres. Mínimo pra contar: 500.',
}

/** Texto explicando a marca, ou null se o emoji não é uma marca do Trik. */
export function sceneMarkNote(emoji: string, rejectionReason: string | null | undefined): string | null {
	if (emoji === SCENE_COUNTED_EMOJI) return 'Cena computada — contou xp.'
	if (emoji === SCENE_REJECTED_EMOJI) {
		const why = rejectionReason ? REJECTION_MESSAGES[rejectionReason] : null
		return why ? `Não gerou xp. ${why}` : 'Essa cena não gerou xp.'
	}
	return null
}
