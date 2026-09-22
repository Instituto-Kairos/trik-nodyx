// Módulo RPG (trik) — Fase 2: parseScenePost.
// Ver plans/fase-dois.md, "Fluxo 1", item 1, e
// plans/fase-dois-passo-a-passo.md, passo 3.1 — content é HTML já
// sanitizado do TipTap. Dois formatos reais de separador (ver comentário em
// sceneParser.ts): parágrafos vazios (`<p></p><p></p>`, digitando direto) e
// runs de `<br>` (`<br><br><br>`, colando texto de fora — o caso real que
// apareceu no primeiro teste em produção, 2026-09-15: um post colado vira
// um único `<p>` cheio de `<br>`, sem nenhum `<p></p>` vazio).

import { describe, it, expect } from 'vitest'
import { parseScenePost } from '../services/trik/xp/sceneParser'

function scene(header: string, cena: string, footer?: string) {
  const parts = [`<p>${header}</p>`, '<p></p>', '<p></p>', `<p>${cena}</p>`]
  if (footer !== undefined) parts.push('<p></p>', '<p></p>', `<p>${footer}</p>`)
  return parts.join('')
}

describe('parseScenePost', () => {
  it('sem separador (1 bloco só) → null', () => {
    expect(parseScenePost('<p>só um parágrafo, sem estrutura</p>')).toBeNull()
  })

  it('1 único parágrafo vazio entre os blocos não conta como separador', () => {
    // "no mínimo 3 quebras de linha" -> pelo menos 2 <p></p> em sequência
    expect(parseScenePost('<p>header</p><p></p><p>cena</p>')).toBeNull()
  })

  it('header + cena (sem footer)', () => {
    const parsed = parseScenePost(scene('Fulano - "assinatura"', 'era uma vez...'))
    expect(parsed).toEqual({
      header: 'Fulano - "assinatura"',
      cena:   'era uma vez...',
      footer: '',
    })
  })

  it('header + cena + footer', () => {
    const parsed = parseScenePost(scene('Fulano - "assinatura"', 'era uma vez...', '#treino #espada'))
    expect(parsed).toEqual({
      header: 'Fulano - "assinatura"',
      cena:   'era uma vez...',
      footer: '#treino #espada',
    })
  })

  it('remove tags HTML e decodifica entidades comuns do editor', () => {
    const header = '<p><strong>Fulano</strong> - &quot;assinatura&quot;</p>'
    const html = `${header}<p></p><p></p><p>cena &amp; mais cena</p>`
    const parsed = parseScenePost(html)
    expect(parsed?.header).toBe('Fulano - "assinatura"')
    expect(parsed?.cena).toBe('cena & mais cena')
  })

  it('conta o tamanho da cena em texto puro, não em bytes de HTML', () => {
    const cenaText = 'x'.repeat(600)
    const parsed = parseScenePost(scene('h', `<strong>${cenaText}</strong>`))
    expect(parsed?.cena.length).toBe(600)
  })

  describe('separador por <br> (texto colado — caso real de produção)', () => {
    it('reconhece header/cena quando tudo vem num único <p> com <br>', () => {
      const html = '<p>Fulano - "assinatura"<br><br><br><br><br>era uma vez...</p>'
      const parsed = parseScenePost(html)
      expect(parsed).toEqual({ header: 'Fulano - "assinatura"', cena: 'era uma vez...', footer: '' })
    })

    it('reconhece header/cena/footer com <br /> (self-closing) também', () => {
      const html = '<p>Fulano - "assinatura"<br /><br /><br />era uma vez...<br /><br /><br />#treino</p>'
      const parsed = parseScenePost(html)
      expect(parsed).toEqual({ header: 'Fulano - "assinatura"', cena: 'era uma vez...', footer: '#treino' })
    })

    it('menos de 3 <br> seguidos não conta como separador', () => {
      const html = '<p>header<br><br>cena continua na mesma linha visual</p>'
      expect(parseScenePost(html)).toBeNull()
    })

    it('quebra de linha simples (1 <br>) dentro da cena vira espaço, não junta palavras', () => {
      const html = '<p>h<br><br><br>linha um<br>linha dois</p>'
      const parsed = parseScenePost(html)
      // sem isso, "um<br>linha" viraria "umlinha" ao remover a tag — corrompe
      // a contagem de caracteres e o match de header em casos reais.
      expect(parsed?.cena).toBe('linha um\nlinha dois')
    })
  })
})
