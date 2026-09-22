// Módulo RPG (trik) — Fase 2: matchCharacterByHeader.
// Ver plans/fase-dois.md, "Fluxo 1", item 2.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../models/trik', () => ({
  getCharactersWithTemplate: vi.fn(),
}))

import { getCharactersWithTemplate } from '../models/trik'
import { matchCharacterByHeader } from '../services/trik/xp/matcher'

function character(overrides: Record<string, unknown> = {}) {
  return {
    id: 'char-1', player_id: 'player-1', name: 'Fulano',
    template_name: 'Fulano', template_signature: 'assinatura-unica',
    ...overrides,
  }
}

describe('matchCharacterByHeader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sem candidatos → null', async () => {
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([])
    const result = await matchCharacterByHeader('player-1', 'Fulano - "assinatura-unica"')
    expect(result).toBeNull()
  })

  it('nome bate mas assinatura não → null', async () => {
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([character() as any])
    const result = await matchCharacterByHeader('player-1', 'Fulano - "outra coisa"')
    expect(result).toBeNull()
  })

  it('1 match único → devolve o personagem', async () => {
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([character() as any])
    const result = await matchCharacterByHeader('player-1', 'Fulano - "assinatura-unica" escreve...')
    expect(result?.id).toBe('char-1')
  })

  it('mais de 1 match → null (ambíguo, não credita)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([
      character({ id: 'char-1', template_name: 'Fulano', template_signature: 'sig' }) as any,
      character({ id: 'char-2', template_name: 'Beltrano', template_signature: 'assinatura' }) as any,
    ])
    const result = await matchCharacterByHeader('player-1', 'Fulano Beltrano - "sig" "assinatura"')
    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // Bug real de produção (2026-09-15): header decorativo com espaçamento
  // duplo (&nbsp; do editor) não batia contra um template_name salvo com
  // espaço simples — a assinatura batia, o nome não, então nunca creditava.
  it('bate mesmo com espaçamento diferente entre header e template salvo', async () => {
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([
      character({ template_name: 'Jahzell Khalid', template_signature: 'sig' }) as any,
    ])
    const header = 'Nome:  Jahzell  Khalid  ·  Panteão: X\nAssinatura: sig'
    const result = await matchCharacterByHeader('player-1', header)
    expect(result?.template_name).toBe('Jahzell Khalid')
  })

  it('bate com quebra de linha entre as palavras do nome (header multi-linha)', async () => {
    vi.mocked(getCharactersWithTemplate).mockResolvedValue([
      character({ template_name: 'Jahzell Khalid', template_signature: 'sig' }) as any,
    ])
    const header = 'Jahzell\nKhalid - "sig"'
    const result = await matchCharacterByHeader('player-1', header)
    expect(result?.template_name).toBe('Jahzell Khalid')
  })
})
