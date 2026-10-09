// Módulo RPG (trik) — xp de narrador: post do narrador com #lore rende 15xp a
// cada 500 caracteres pro pool do narrador (models/trikNarrador.ts), não pra
// um personagem.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../models/trik', () => ({
  isXpThread:                 vi.fn(),
  getPlayer:                  vi.fn(),
  getCharactersWithTemplate:  vi.fn(),
  applySceneAward:            vi.fn(),
  revertSceneAward:           vi.fn().mockResolvedValue(undefined),
  listAwardedPostIdsByThread: vi.fn().mockResolvedValue([]),
  getChannelPurposes:         vi.fn().mockResolvedValue([]),
  getOrCreateProgress:        vi.fn(),
  setSceneRejection:          vi.fn().mockResolvedValue(undefined),
  clearSceneRejection:        vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../models/trikNarrador', () => ({
  getNarratorUserId:                  vi.fn(),
  applyNarratorAward:                 vi.fn(),
  revertNarratorAward:                vi.fn().mockResolvedValue(undefined),
  listNarratorAwardedPostIdsByThread: vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/trik/bot', () => ({
  postTrikMessage:    vi.fn().mockResolvedValue(undefined),
  reactSceneRejected: vi.fn().mockResolvedValue(undefined),
  reactSceneCounted:  vi.fn().mockResolvedValue(undefined),
  clearSceneMarks:    vi.fn().mockResolvedValue(undefined),
}))

import { isXpThread, getPlayer, applySceneAward, listAwardedPostIdsByThread, revertSceneAward } from '../models/trik'
import {
  getNarratorUserId, applyNarratorAward, revertNarratorAward, listNarratorAwardedPostIdsByThread,
} from '../models/trikNarrador'
import { reactSceneCounted, reactSceneRejected } from '../services/trik/bot'
import { processScenePost, revertScenePost, revertThreadScenes } from '../services/trik/xp'
import { calculateNarratorXp } from '../services/trik/xp/calc'
import { hasLoreTag } from '../services/trik/xp/sceneParser'

const THREAD_ID   = 'thread-1'
const POST_ID     = 'post-1'
const NARRATOR_ID = 'user-narrador'
const OTHER_ID    = 'user-outro'

function post(authorUserId: string, content: string) {
  return processScenePost({ threadId: THREAD_ID, postId: POST_ID, authorUserId, content })
}

describe('calculateNarratorXp', () => {
  it('15xp a cada 500 caracteres, proporcional', () => {
    expect(calculateNarratorXp(500)).toBe(15)
    expect(calculateNarratorXp(750)).toBe(23) // 22.5 → 23
    expect(calculateNarratorXp(1000)).toBe(30)
    expect(calculateNarratorXp(2000)).toBe(60) // sem a taxa 1.8x da cena normal
  })

  it('abaixo de 500 caracteres não rende nada', () => {
    expect(calculateNarratorXp(499)).toBe(0)
  })
})

describe('hasLoreTag', () => {
  it('acha #lore em qualquer caixa', () => {
    expect(hasLoreTag('fim da cena #lore')).toBe(true)
    expect(hasLoreTag('#Lore no começo')).toBe(true)
  })

  it('não confunde com outra hashtag que começa igual', () => {
    expect(hasLoreTag('#lorena')).toBe(false)
    expect(hasLoreTag('lore sem hashtag')).toBe(false)
  })
})

describe('processScenePost — #lore do narrador', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isXpThread).mockResolvedValue(true)
    vi.mocked(getNarratorUserId).mockResolvedValue(NARRATOR_ID)
    vi.mocked(applyNarratorAward).mockResolvedValue(true)
  })

  it('post sem estrutura de plaquinha: conta o texto todo pro pool', async () => {
    const texto = 'x'.repeat(995) + ' #lore' // 1001 chars
    const result = await post(NARRATOR_ID, `<p>${texto}</p>`)

    expect(result).toEqual({ awarded: true, narrator: true, xp: 30 })
    expect(applyNarratorAward).toHaveBeenCalledWith(NARRATOR_ID, POST_ID, 30)
    expect(reactSceneCounted).toHaveBeenCalledWith(POST_ID)
    expect(getPlayer).not.toHaveBeenCalled()
    expect(applySceneAward).not.toHaveBeenCalled()
  })

  it('post com estrutura: conta só a cena, sem header/footer', async () => {
    const content = '<p>Narrador</p><p></p><p></p>'
      + `<p>${'x'.repeat(500)}</p><p></p><p></p><p>#lore</p>`
    const result = await post(NARRATOR_ID, content)

    expect(result).toEqual({ awarded: true, narrator: true, xp: 15 })
  })

  it('curto demais: marca ❌ e não grava', async () => {
    const result = await post(NARRATOR_ID, '<p>evento curto #lore</p>')

    expect(result).toEqual({ awarded: false, reason: 'below_minimum' })
    expect(reactSceneRejected).toHaveBeenCalledWith(POST_ID)
    expect(applyNarratorAward).not.toHaveBeenCalled()
  })

  it('post que já tinha prêmio: não credita de novo nem reage', async () => {
    vi.mocked(applyNarratorAward).mockResolvedValue(false)
    const result = await post(NARRATOR_ID, `<p>${'x'.repeat(600)} #lore</p>`)

    expect(result).toEqual({ awarded: false, reason: 'already_awarded' })
    expect(reactSceneCounted).not.toHaveBeenCalled()
  })

  it('#lore de outro jogador: segue o fluxo normal de cena', async () => {
    const result = await post(OTHER_ID, `<p>${'x'.repeat(600)} #lore</p>`)

    expect(result).toEqual({ awarded: false, reason: 'no_structure' })
    expect(applyNarratorAward).not.toHaveBeenCalled()
  })

  it('post do narrador sem #lore: nem procura o narrador, segue o fluxo normal', async () => {
    const result = await post(NARRATOR_ID, `<p>${'x'.repeat(600)}</p>`)

    expect(result).toEqual({ awarded: false, reason: 'no_structure' })
    expect(getNarratorUserId).not.toHaveBeenCalled()
  })

  it('tópico que não vale xp: ignora mesmo com #lore', async () => {
    vi.mocked(isXpThread).mockResolvedValue(false)
    const result = await post(NARRATOR_ID, `<p>${'x'.repeat(600)} #lore</p>`)

    expect(result).toEqual({ awarded: false, reason: 'not_xp_thread' })
    expect(applyNarratorAward).not.toHaveBeenCalled()
  })
})

describe('revert de prêmio de narrador', () => {
  beforeEach(() => vi.clearAllMocks())

  it('revertScenePost também desfaz o prêmio de narrador', async () => {
    await revertScenePost(POST_ID)
    expect(revertSceneAward).toHaveBeenCalledWith(POST_ID)
    expect(revertNarratorAward).toHaveBeenCalledWith(POST_ID)
  })

  it('revertThreadScenes reverte os posts de cena e os de narrador, sem repetir', async () => {
    vi.mocked(listAwardedPostIdsByThread).mockResolvedValueOnce(['post-a'])
    vi.mocked(listNarratorAwardedPostIdsByThread).mockResolvedValueOnce(['post-b', 'post-a'])

    await revertThreadScenes(THREAD_ID)

    expect(revertNarratorAward).toHaveBeenCalledTimes(2)
    expect(revertNarratorAward).toHaveBeenCalledWith('post-a')
    expect(revertNarratorAward).toHaveBeenCalledWith('post-b')
  })
})
