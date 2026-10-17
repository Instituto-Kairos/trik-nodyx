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
/**
 * Menção que notifica o dono de verdade: forma de alias `@[nome](username)`
 * (utils/mentions.ts), que aceita qualquer username — inclusive com espaço ou
 * acento, que o `@nome` simples não casa. Com `)`, `]`, quebra de linha ou
 * caractere que o HTML escaparia (o alvo escapado deixaria de bater com o
 * username), não dá pra marcar: sai só o nome, escapado.
 */
export function mentionUser(username: string): string {
  if (/[\])\n&<>"']/.test(username)) return username.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch])
  return `@[${username}](${username})`
}

export function botSafe(text: string): string {
  return text
    .replace(/[&<>"']/g, ch => HTML_ESCAPES[ch])
    .replace(/@/g, '@​')
}
