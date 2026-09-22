/**
 * Módulo RPG (trik) — texto digitado por jogador que vai parar numa mensagem
 * do bot (nome do personagem, nome da plaquinha…).
 *
 * postTrikMessage passa o conteúdo por sanitize() (que mantém <a href>) e
 * depois resolve @menções — então um nome como "@admin @alice" notificaria
 * gente de verdade em nome do bot, e "<a href=...>" viraria link clicável.
 * Fica de fora de services/trik/bot.ts de propósito: é função pura, e os
 * testes que mockam o bot não a substituem por um stub.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

/**
 * Escapa HTML e desarma @menções (espaço de largura zero depois do "@": o
 * texto continua igual pra quem lê, mas não casa mais com um username).
 * Use SÓ em texto vindo do jogador — a menção intencional ao autor do
 * comando (`@${username}`) continua fora daqui.
 */
export function botSafe(text: string): string {
  return text
    .replace(/[&<>"']/g, ch => HTML_ESCAPES[ch])
    .replace(/@/g, '@​')
}
