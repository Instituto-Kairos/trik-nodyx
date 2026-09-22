// Módulo RPG (trik) — services/trik/text.ts › botSafe: texto do jogador em mensagem do bot.

import { describe, it, expect } from 'vitest'
import { botSafe } from '../services/trik/text'

const ZWSP = '​'

describe('botSafe', () => {
  it('escapa HTML: tag digitada pelo jogador vira texto', () => {
    expect(botSafe('<a href="https://phish.test">clique</a>'))
      .toBe('&lt;a href=&quot;https://phish.test&quot;&gt;clique&lt;/a&gt;')
  })

  it('escapa & e aspas simples (não deixa "&lt;" digitado virar tag depois)', () => {
    expect(botSafe(`Tom & Jerry's`)).toBe('Tom &amp; Jerry&#39;s')
    expect(botSafe('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;')
  })

  it('desarma @menção com espaço de largura zero — o texto continua igual pra quem lê', () => {
    const out = botSafe('@admin e @alice')
    expect(out).toBe(`@${ZWSP}admin e @${ZWSP}alice`)
    expect(out.replaceAll(ZWSP, '')).toBe('@admin e @alice')
    // o regex de menção (@ + letras) não casa mais
    expect(/@[a-zA-Z0-9_-]{2,32}/.test(out)).toBe(false)
  })

  it('nome comum passa sem alteração (acento, hífen, símbolos decorativos)', () => {
    for (const name of ['Jahzell Khalid al-Filastini', '𝐉𝐀𝐇𝐙𝐄𝐋𝐋 𝐊𝐇𝐀𝐋𝐈𝐃 ✶ 𝐀𝐋-𝐅𝐈𝐋𝐀𝐒𝐓𝐈𝐍𝐈', 'جاهزلّ الخالد', 'Éowyn']) {
      expect(botSafe(name)).toBe(name)
    }
  })

  it('string vazia continua vazia', () => {
    expect(botSafe('')).toBe('')
  })
})
