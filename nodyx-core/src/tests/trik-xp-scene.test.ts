// Módulo RPG (trik) — Fase 2: processScenePost, incluindo os avisos do bot
// Trik no próprio tópico quando uma cena não gera xp (pedido do usuário:
// "se a cena tiver menos de 500 caracteres, deve ser avisado como inválida").

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../models/trik', () => ({
  isXpThread:             vi.fn(),
  getPlayer:              vi.fn(),
  getCharactersWithTemplate: vi.fn(),
  applySceneAward:        vi.fn(),
  revertSceneAward:       vi.fn(),
  listAwardedPostIdsByThread: vi.fn(),
  getChannelPurposes:     vi.fn().mockResolvedValue([]),
  getOrCreateProgress:    vi.fn(),
}))

vi.mock('../services/trik/bot', () => ({
  postTrikMessage:      vi.fn().mockResolvedValue(undefined),
  postTrikThreadReply:  vi.fn().mockResolvedValue(undefined),
  reactSceneCounted:    vi.fn().mockResolvedValue(undefined),
  unreactSceneCounted:  vi.fn().mockResolvedValue(undefined),
}))

import {
  isXpThread, getPlayer, getCharactersWithTemplate, applySceneAward,
  revertSceneAward, listAwardedPostIdsByThread,
} from '../models/trik'
import { postTrikThreadReply, reactSceneCounted, unreactSceneCounted } from '../services/trik/bot'
import { processScenePost, revertScenePost, revertThreadScenes } from '../services/trik/xp'

const THREAD_ID = 'thread-1'
const POST_ID   = 'post-1'
const USER_ID   = 'user-1'

function scene(header: string, cena: string) {
  return `<p>${header}</p><p></p><p></p><p>${cena}</p>`
}

describe('processScenePost — avisos de rejeição no tópico', () => {
  beforeEach(() => vi.clearAllMocks())

  it('not_xp_thread: não avisa (tópico normal, sem relação com o RPG)', async () => {
    vi.mocked(isXpThread).mockResolvedValue(false)
    const result = await processScenePost({ threadId: THREAD_ID, postId: POST_ID, authorUserId: USER_ID, content: '<p>oi</p>' })
    expect(result).toEqual({ awarded: false, reason: 'not_xp_thread' })
    expect(postTrikThreadReply).not.toHaveBeenCalled()
  })

  it('no_structure: avisa que falta a estrutura de cena', async () => {
    vi.mocked(isXpThread).mockResolvedValue(true)
    const result = await processScenePost({ threadId: THREAD_ID, postId: POST_ID, authorUserId: USER_ID, content: '<p>só um parágrafo</p>' })
    expect(result).toEqual({ awarded: false, reason: 'no_structure' })
    expect(postTrikThreadReply).toHaveBeenCalledWith(THREAD_ID, expect.stringContaining('estrutura de cena'))
  })

  it('no_player: avisa que o jogador não tem cadastro', async () => {
    vi.mocked(isXpThread).mockResolvedValue(true)
    vi.mocked(getPlayer).mockResolvedValue(null)
    const result = await processScenePost({
      threadId: THREAD_ID, postId: POST_ID, authorUserId: USER_ID,
      content: scene('Fulano', 'x'.repeat(600)),
    })
    expect(result).toEqual({ awarded: false, reason: 'no_player' })
    expect(postTrikThreadReply).toHaveBeenCalledWith(THREAD_ID, expect.stringContaining('/registro'))
  })

  it('no_match: avisa que não achou o personagem no cabeçalho', async () => {
    vi.mocked(isXpThread).mockResolvedValue(true)
    vi.mocked(getPlayer).mockResolvedValue({ id: 'player-1' } as any)
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([])
    const result = await processScenePost({
      threadId: THREAD_ID, postId: POST_ID, authorUserId: USER_ID,
      content: scene('Fulano', 'x'.repeat(600)),
    })
    expect(result).toEqual({ awarded: false, reason: 'no_match' })
    expect(postTrikThreadReply).toHaveBeenCalledWith(THREAD_ID, expect.stringContaining('personagem'))
  })

  it('below_minimum: avisa que a cena é curta demais (< 500 chars)', async () => {
    vi.mocked(isXpThread).mockResolvedValue(true)
    vi.mocked(getPlayer).mockResolvedValue({ id: 'player-1' } as any)
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([
      { id: 'char-1', name: 'Fulano', template_name: 'Fulano', template_signature: 'sig' } as any,
    ])
    const result = await processScenePost({
      threadId: THREAD_ID, postId: POST_ID, authorUserId: USER_ID,
      content: scene('Fulano - "sig"', 'cena curta'),
    })
    expect(result).toEqual({ awarded: false, reason: 'below_minimum' })
    expect(postTrikThreadReply).toHaveBeenCalledWith(THREAD_ID, expect.stringContaining('500'))
    expect(applySceneAward).not.toHaveBeenCalled()
  })

  it('sucesso: grava xp e NÃO avisa (só avisa em rejeição)', async () => {
    vi.mocked(isXpThread).mockResolvedValue(true)
    vi.mocked(getPlayer).mockResolvedValue({ id: 'player-1' } as any)
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([
      { id: 'char-1', name: 'Fulano', template_name: 'Fulano', template_signature: 'sig' } as any,
    ])
    vi.mocked(applySceneAward).mockResolvedValue({ leveledUp: false })

    const result = await processScenePost({
      threadId: THREAD_ID, postId: POST_ID, authorUserId: USER_ID,
      content: scene('Fulano - "sig"', 'x'.repeat(600)),
    })
    expect(result).toEqual({ awarded: true, characterId: 'char-1', xp: 12, leveledUp: false })
    expect(postTrikThreadReply).not.toHaveBeenCalled()
    expect(applySceneAward).toHaveBeenCalledWith('char-1', POST_ID, 12, undefined) // cena normal: sem bloco de maestria
    expect(reactSceneCounted).toHaveBeenCalledWith(POST_ID)
  })

  it('rejeição: não reage com a marca de "contou xp"', async () => {
    vi.mocked(isXpThread).mockResolvedValue(true)
    const result = await processScenePost({ threadId: THREAD_ID, postId: POST_ID, authorUserId: USER_ID, content: '<p>sem estrutura</p>' })
    expect(result).toEqual({ awarded: false, reason: 'no_structure' })
    expect(reactSceneCounted).not.toHaveBeenCalled()
  })
})

describe('revertScenePost', () => {
  beforeEach(() => vi.clearAllMocks())

  it('desfaz o xp bruto e tira a reação de "contou xp"', async () => {
    await revertScenePost(POST_ID)
    expect(revertSceneAward).toHaveBeenCalledWith(POST_ID)
    expect(unreactSceneCounted).toHaveBeenCalledWith(POST_ID)
  })
})

describe('processScenePost — post que já tem prêmio (edições concorrentes)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applySceneAward devolve null: não credita de novo, não reage nem avisa', async () => {
    vi.mocked(isXpThread).mockResolvedValue(true)
    vi.mocked(getPlayer).mockResolvedValue({ id: 'player-1' } as any)
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([
      { id: 'char-1', name: 'Fulano', template_name: 'Fulano', template_signature: 'sig' } as any,
    ])
    vi.mocked(applySceneAward).mockResolvedValue(null)

    const result = await processScenePost({
      threadId: THREAD_ID, postId: POST_ID, authorUserId: USER_ID,
      content: scene('Fulano - "sig"', 'x'.repeat(600)),
    })

    expect(result).toEqual({ awarded: false, reason: 'already_awarded' })
    expect(reactSceneCounted).not.toHaveBeenCalled()
    expect(postTrikThreadReply).not.toHaveBeenCalled()
  })
})

describe('revertScenePost — desfaz o prêmio e tira a reação', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reverte o prêmio primeiro e só depois tira a reação', async () => {
    await revertScenePost(POST_ID)

    expect(revertSceneAward).toHaveBeenCalledWith(POST_ID)
    expect(unreactSceneCounted).toHaveBeenCalledWith(POST_ID)
    expect(vi.mocked(revertSceneAward).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(unreactSceneCounted).mock.invocationCallOrder[0])
  })

  it('nunca lança: erro do model vira log e a reação fica como está', async () => {
    vi.mocked(revertSceneAward).mockRejectedValueOnce(new Error('banco fora do ar'))
    await expect(revertScenePost(POST_ID)).resolves.toBeUndefined()
    expect(unreactSceneCounted).not.toHaveBeenCalled()
  })
})

describe('revertThreadScenes — apagar um tópico inteiro', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reverte cada post premiado do tópico', async () => {
    vi.mocked(listAwardedPostIdsByThread).mockResolvedValueOnce(['post-a', 'post-b'])

    await revertThreadScenes(THREAD_ID)

    expect(listAwardedPostIdsByThread).toHaveBeenCalledWith(THREAD_ID)
    expect(revertSceneAward).toHaveBeenCalledTimes(2)
    expect(revertSceneAward).toHaveBeenCalledWith('post-a')
    expect(revertSceneAward).toHaveBeenCalledWith('post-b')
  })

  it('tópico sem cena premiada: não reverte nada', async () => {
    vi.mocked(listAwardedPostIdsByThread).mockResolvedValueOnce([])
    await revertThreadScenes(THREAD_ID)
    expect(revertSceneAward).not.toHaveBeenCalled()
  })

  it('nunca lança: se a listagem falhar, deixa o chamador apagar o tópico', async () => {
    vi.mocked(listAwardedPostIdsByThread).mockRejectedValueOnce(new Error('banco fora do ar'))
    await expect(revertThreadScenes(THREAD_ID)).resolves.toBeUndefined()
  })
})
