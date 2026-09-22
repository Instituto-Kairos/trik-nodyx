// Módulo RPG (trik) — parseFooterTags: lê `#treino #NOMEARMA` e
// `#aula #NOMEAULA` do footer da cena. Ver TRIK-PROJECT.md, seção 4.
// O footer chega em texto puro (parseScenePost já tirou as tags HTML).

import { describe, it, expect } from 'vitest'
import { parseFooterTags, parseScenePost } from '../services/trik/xp/sceneParser'

describe('parseFooterTags', () => {
  it('footer vazio → nenhuma tag', () => {
    expect(parseFooterTags('')).toEqual({})
  })

  it('#treino + nome da arma', () => {
    expect(parseFooterTags('#treino #espada')).toEqual({ treino: 'espada' })
  })

  it('#aula + nome da matéria', () => {
    expect(parseFooterTags('#aula #historia')).toEqual({ aula: 'historia' })
  })

  it('tag-gatilho é case-insensitive; o nome sai como digitado', () => {
    expect(parseFooterTags('#TREINO #Espada')).toEqual({ treino: 'Espada' })
    expect(parseFooterTags('#Aula #História')).toEqual({ aula: 'História' })
  })

  it('aceita texto solto e outras hashtags ao redor', () => {
    expect(parseFooterTags('Data: 12/03/2026 #treino #espada #com fulano')).toEqual({ treino: 'espada' })
    expect(parseFooterTags('hoje foi puxado #treino #espada')).toEqual({ treino: 'espada' })
  })

  it('#treino e #aula juntos devolvem os dois (quem decide o que fazer é processScenePost)', () => {
    expect(parseFooterTags('#treino #espada #aula #historia')).toEqual({ treino: 'espada', aula: 'historia' })
  })

  it('tag sem par no fim do footer é ignorada', () => {
    expect(parseFooterTags('#treino')).toEqual({})
    expect(parseFooterTags('sem nada #aula')).toEqual({})
  })

  it('tag seguida de outra tag reservada fica sem par (#com não é nome de arma)', () => {
    expect(parseFooterTags('#treino #com fulano')).toEqual({})
    expect(parseFooterTags('#treino #aula #historia')).toEqual({ aula: 'historia' })
  })

  it('#tarefa e #trabalho não geram nada (ficam pra uma fase futura)', () => {
    expect(parseFooterTags('#tarefa')).toEqual({})
    expect(parseFooterTags('#trabalho #ferreiro')).toEqual({})
  })

  it('sem nenhuma hashtag → nada', () => {
    expect(parseFooterTags('só um rodapé qualquer, treino de espada')).toEqual({})
  })

  it('integra com parseScenePost: footer sai do 3º bloco, em texto puro', () => {
    const html = '<p>Fulano</p><p></p><p></p><p>cena</p><p></p><p></p><p>#treino&nbsp;#espada</p>'
    const parsed = parseScenePost(html)
    expect(parsed).not.toBeNull()
    expect(parseFooterTags(parsed!.footer)).toEqual({ treino: 'espada' })
  })
})
