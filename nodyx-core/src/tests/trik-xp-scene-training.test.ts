// Módulo RPG (trik) — processScenePost com #treino / #aula no footer.
// Complementa trik-xp-scene.test.ts (que cobre as rejeições e a cena normal).
// Ver TRIK-PROJECT.md, seção 4.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../models/trik', () => ({
  isXpThread:                vi.fn(),
  getPlayer:                 vi.fn(),
  getCharactersWithTemplate: vi.fn(),
  applySceneAward:           vi.fn(),
  revertSceneAward:          vi.fn(),
  listAwardedPostIdsByThread: vi.fn(),
  getChannelPurposes:        vi.fn(),
  getOrCreateProgress:       vi.fn(),
}))

vi.mock('../models/trikMastery', () => ({
  findCatalogByName:   vi.fn(),
  getMasteryUsedToday: vi.fn(),
}))

vi.mock('../services/trik/bot', () => ({
  postTrikMessage:      vi.fn(),
  postTrikThreadReply:  vi.fn(),
  reactSceneCounted:    vi.fn(),
  unreactSceneCounted:  vi.fn(),
}))

import {
  isXpThread, getPlayer, getCharactersWithTemplate, applySceneAward,
  getChannelPurposes, getOrCreateProgress,
} from '../models/trik'
import { findCatalogByName, getMasteryUsedToday } from '../models/trikMastery'
import { postTrikMessage, postTrikThreadReply, reactSceneCounted } from '../services/trik/bot'
import { processScenePost } from '../services/trik/xp'

const THREAD_ID = 'thread-1'
const POST_ID   = 'post-1'
const USER_ID   = 'user-1'
const HEADER    = 'Fulano - "sig"'

const TREINO = '#treino #espada'
const AULA   = '#aula #historia'
const ANNOUNCE = [{ channel_id: 'ch-anuncio', purpose: 'anuncio' }] as any

const ITEMS = {
  weapon:    { id: 'w1', name: 'Espada' },
  knowledge: { id: 'k1', name: 'História' },
}

function scene(cena: string, footer?: string) {
  const parts = [`<p>${HEADER}</p>`, '<p></p>', '<p></p>', `<p>${cena}</p>`]
  if (footer !== undefined) parts.push('<p></p>', '<p></p>', `<p>${footer}</p>`)
  return parts.join('')
}

function post(cena: string, footer?: string) {
  return processScenePost({
    threadId: THREAD_ID, postId: POST_ID, authorUserId: USER_ID, content: scene(cena, footer),
  })
}

/** Prepara o catálogo (acha o item do `kind`), o uso do dia e o resultado do
 *  crédito de maestria. */
function trainWith(
  kind: keyof typeof ITEMS,
  opts: { used?: number; level?: number; leveledUp?: boolean; characterLeveledUp?: boolean } = {}
) {
  vi.mocked(findCatalogByName).mockResolvedValue(ITEMS[kind])
  vi.mocked(getMasteryUsedToday).mockResolvedValue(opts.used ?? 0)
  // Um único applySceneAward (prêmio + xp + maestria numa transação): só devolve o
  // bloco de maestria quando a cena pediu maestria (4º argumento).
  vi.mocked(applySceneAward).mockImplementation(async (_char, _post, _xp, mastery) => ({
    leveledUp: opts.characterLeveledUp ?? false,
    ...(mastery && { mastery: { level: opts.level ?? 1, progress: 0, leveledUp: opts.leveledUp ?? false } }),
  }))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getChannelPurposes).mockResolvedValue([])
  vi.mocked(postTrikMessage).mockResolvedValue(undefined)
  vi.mocked(postTrikThreadReply).mockResolvedValue(undefined)
  vi.mocked(reactSceneCounted).mockResolvedValue(undefined)

  vi.mocked(isXpThread).mockResolvedValue(true)
  vi.mocked(getPlayer).mockResolvedValue({ id: 'player-1' } as any)
  vi.mocked(getCharactersWithTemplate).mockResolvedValue([
    { id: 'char-1', name: 'Fulano', template_name: 'Fulano', template_signature: 'sig' } as any,
  ])
  vi.mocked(applySceneAward).mockResolvedValue({ leveledUp: false })
})

describe('processScenePost — #treino / #aula válidos', () => {
  it('#treino com arma do catálogo: xp reduzido (0.2x), grava a arma e credita maestria', async () => {
    trainWith('weapon')

    const result = await post('x'.repeat(600), TREINO)

    expect(findCatalogByName).toHaveBeenCalledWith('weapon', 'espada')
    // 600 chars: base 12 xp → 0.2x = 2 (2.4 arredondado); 600/500 = 1.2 unidades
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, 2, { kind: 'weapon', itemId: 'w1', units: 1.2 })
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, expect.any(Number), { kind: 'weapon', itemId: 'w1', units: 1.2 })
    expect(result).toEqual({
      awarded: true, characterId: 'char-1', xp: 2, leveledUp: false,
      mastery: { kind: 'weapon', name: 'Espada', units: 1.2, level: 1, leveledUp: false },
    })
    expect(reactSceneCounted).toHaveBeenCalledWith(POST_ID)
    expect(postTrikMessage).not.toHaveBeenCalled() // não subiu de maestria: sem aviso
  })

  it('#aula com matéria do catálogo: credita conhecimento, não arma', async () => {
    trainWith('knowledge')

    const result = await post('x'.repeat(600), AULA)

    expect(findCatalogByName).toHaveBeenCalledWith('knowledge', 'historia')
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, 2, { kind: 'knowledge', itemId: 'k1', units: 1.2 })
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, expect.any(Number), { kind: 'knowledge', itemId: 'k1', units: 1.2 })
    expect(result).toMatchObject({ awarded: true, mastery: { kind: 'knowledge', name: 'História' } })
  })

  it('cena de 1200 chars: 0.5x de xp, 2.4 unidades', async () => {
    trainWith('weapon')

    await post('x'.repeat(1200), TREINO)

    // base = round(1200/500*10*1.8) = 43 → 0.5x = 21.5 → 22
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, 22, { kind: 'weapon', itemId: 'w1', units: 2.4 })
  })

  it('cena acima de 1500 chars: xp CHEIO e maestria travada no teto de 3.0', async () => {
    trainWith('weapon')

    const result = await post('x'.repeat(2000), TREINO)

    // base = round(2000/500*10*1.8) = 72, sem redução
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, 72, { kind: 'weapon', itemId: 'w1', units: 3 })
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, expect.any(Number), { kind: 'weapon', itemId: 'w1', units: 3 })
    expect(result).toMatchObject({ awarded: true, xp: 72 })
  })
})

describe('processScenePost — avisos de subida de maestria', () => {
  it('subiu de maestria de arma: avisa no canal de anúncio', async () => {
    vi.mocked(getChannelPurposes).mockResolvedValue(ANNOUNCE)
    trainWith('weapon', { level: 2, leveledUp: true })

    await post('x'.repeat(600), TREINO)

    expect(postTrikMessage).toHaveBeenCalledWith(
      'ch-anuncio',
      expect.stringMatching(/Fulano.*subiu de maestria em.*Espada.*nível 2/)
    )
  })

  it('subiu de nível de matéria: mensagem de aula, não de arma', async () => {
    vi.mocked(getChannelPurposes).mockResolvedValue(ANNOUNCE)
    trainWith('knowledge', { level: 2, leveledUp: true })

    await post('x'.repeat(600), AULA)

    expect(postTrikMessage).toHaveBeenCalledWith(
      'ch-anuncio',
      expect.stringMatching(/Fulano.*subiu de nível em.*História/)
    )
  })

  it('subiu de maestria sem canal de anúncio configurado: não é erro, só não avisa', async () => {
    trainWith('weapon', { level: 2, leveledUp: true })

    const result = await post('x'.repeat(600), TREINO)

    expect(result.awarded).toBe(true)
    expect(postTrikMessage).not.toHaveBeenCalled()
  })

  it('level up de personagem numa cena de treino também é avisado', async () => {
    vi.mocked(getChannelPurposes).mockResolvedValue(ANNOUNCE)
    vi.mocked(getOrCreateProgress).mockResolvedValue({
      points_conduct: 0, spent_conduct: 0, points_principles: 0, spent_principles: 0,
      points_preferences: 0, spent_preferences: 0,
    } as any)
    trainWith('weapon', { characterLeveledUp: true })

    const result = await post('x'.repeat(600), TREINO)

    expect(result).toMatchObject({ awarded: true, leveledUp: true })
    expect(postTrikMessage).toHaveBeenCalledWith('ch-anuncio', expect.stringContaining('subiu de nível'))
  })
})

describe('processScenePost — teto diário de maestria (3.0 unidades / 1500 chars por dia)', () => {
  it('consulta o uso do dia do personagem, do tipo certo, contra o próprio post', async () => {
    trainWith('weapon')
    await post('x'.repeat(600), TREINO)
    expect(getMasteryUsedToday).toHaveBeenCalledWith('char-1', 'weapon', POST_ID)

    trainWith('knowledge')
    await post('x'.repeat(600), AULA)
    expect(getMasteryUsedToday).toHaveBeenLastCalledWith('char-1', 'knowledge', POST_ID)
  })

  it('já treinou parte do dia e a cena cabe no que sobra: maestria inteira, xp reduzido', async () => {
    trainWith('weapon', { used: 1 }) // sobram 2.0 (1000 chars)

    await post('x'.repeat(600), TREINO)

    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, 2, { kind: 'weapon', itemId: 'w1', units: 1.2 })
  })

  it('a cena é maior do que sobra do dia: só o que cabe vira maestria e o xp é o cheio', async () => {
    trainWith('weapon', { used: 2 }) // sobra 1.0 (500 chars)

    const result = await post('x'.repeat(600), TREINO)

    // 600 chars, sobra 1.0 unidade: maestria 1.0 (não 1.2), xp normal = 12 (não 2)
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, 12, { kind: 'weapon', itemId: 'w1', units: 1 })
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, expect.any(Number), { kind: 'weapon', itemId: 'w1', units: 1 })
    expect(result).toMatchObject({ awarded: true, xp: 12, mastery: { units: 1 } })
  })

  it('fecha o dia exatamente: 1.68 + 1.32 = 3.0', async () => {
    trainWith('weapon', { used: 1.68 })

    await post('x'.repeat(842), TREINO)

    // 842 chars = 1.68 unidades, mas só 1.32 cabem
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, expect.any(Number), { kind: 'weapon', itemId: 'w1', units: 1.32 })
  })

  it.each([
    ['atingido', 3],
    ['ultrapassado (dado antigo)', 3.5],
  ])('teto %s: vira xp básico de cena — sem maestria (bloco de maestria ausente)', async (_label, used) => {
    trainWith('weapon', { used })

    const result = await post('x'.repeat(600), TREINO)

    expect(result).toEqual({ awarded: true, characterId: 'char-1', xp: 12, leveledUp: false })
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, 12, undefined) // cena normal
  })

  it('teto de treino e de aula são separados: dia cheio de treino não bloqueia a aula', async () => {
    // O mock responde por tipo, como o banco (a query filtra por mastery_kind).
    trainWith('knowledge')
    vi.mocked(getMasteryUsedToday).mockImplementation(async (_c, kind) => (kind === 'weapon' ? 3 : 0))

    const result = await post('x'.repeat(600), AULA)

    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, expect.any(Number), { kind: 'knowledge', itemId: 'k1', units: 1.2 })
    expect(result).toMatchObject({ awarded: true, xp: 2, mastery: { kind: 'knowledge' } })
  })
})

describe('processScenePost — footer que NÃO vira treino (cena normal)', () => {
  it.each([
    ['hashtag sem match no catálogo',      '#treino #armainexistente', true],
    ['#treino e #aula juntos',             '#treino #espada #aula #historia', false],
    ['#treino sem nome de arma',           '#treino', false],
    ['footer sem nenhuma tag',             'só um rodapé qualquer', false],
  ])('%s: xp cheio, sem maestria', async (_label, footer, looksUpCatalog) => {
    vi.mocked(findCatalogByName).mockResolvedValue(null)

    const result = await post('x'.repeat(600), footer)

    expect(result).toEqual({ awarded: true, characterId: 'char-1', xp: 12, leveledUp: false })
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, 12, undefined)
    expect(getMasteryUsedToday).not.toHaveBeenCalled() // sem item do catálogo, nem chega no teto
    // Só consulta o catálogo quando há UMA tag com nome (sem par ou tags juntas nem chegam lá).
    expect(vi.mocked(findCatalogByName).mock.calls.length).toBe(looksUpCatalog ? 1 : 0)
  })

  it('cena sem footer: não toca no catálogo', async () => {
    await post('x'.repeat(600))
    expect(findCatalogByName).not.toHaveBeenCalled()
  })

  it('cena curta demais (< 500) continua rejeitada — o footer nem é lido', async () => {
    const result = await post('curta', TREINO)
    expect(result).toEqual({ awarded: false, reason: 'below_minimum' })
    expect(findCatalogByName).not.toHaveBeenCalled()
    expect(applySceneAward).not.toHaveBeenCalled()
  })
})

describe('processScenePost — nomes digitados pelo jogador nos avisos do bot', () => {
  // O nome do personagem vai parar numa mensagem que o bot posta no chat (com
  // sanitize + @menção): HTML e @usuário digitados no nome não podem virar link
  // clicável nem notificar ninguém em nome do bot.
  it('nome com HTML e @menção é escapado no anúncio de level up', async () => {
    vi.mocked(getChannelPurposes).mockResolvedValue(ANNOUNCE)
    vi.mocked(getOrCreateProgress).mockResolvedValue({
      points_conduct: 0, spent_conduct: 0, points_principles: 0, spent_principles: 0,
      points_preferences: 0, spent_preferences: 0,
    } as any)
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([
      { id: 'char-1', name: '<a href="https://phish.test">@admin</a>', template_name: 'Fulano', template_signature: 'sig' } as any,
    ])
    trainWith('weapon', { characterLeveledUp: true })

    await post('x'.repeat(600), TREINO)

    const message = vi.mocked(postTrikMessage).mock.calls[0][1]
    expect(message).toContain('subiu de nível')
    expect(message).not.toContain('<a href')           // HTML escapado
    expect(message).toContain('&lt;a href=')
    expect(message).not.toMatch(/@admin/)              // "@" desarmado (espaço de largura zero)
    expect(message).toContain('@​admin')
  })

  it('nome da arma/matéria também é escapado no aviso de maestria', async () => {
    vi.mocked(getChannelPurposes).mockResolvedValue(ANNOUNCE)
    vi.mocked(findCatalogByName).mockResolvedValue({ id: 'w1', name: '<b>@todos</b>' })
    vi.mocked(getMasteryUsedToday).mockResolvedValue(0)
    vi.mocked(applySceneAward).mockResolvedValue({ leveledUp: false, mastery: { level: 2, progress: 0, leveledUp: true } })

    await post('x'.repeat(600), TREINO)

    const message = vi.mocked(postTrikMessage).mock.calls[0][1]
    expect(message).toContain('subiu de maestria')
    expect(message).not.toContain('<b>@todos</b>')
    expect(message).toContain('&lt;b&gt;@​todos&lt;/b&gt;')
  })
})
