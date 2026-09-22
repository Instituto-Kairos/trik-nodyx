// Módulo RPG (trik) — /plaquinha: ownership e validação básica.
// Ver plans/fase-um.md, seção 4.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const OWNER_ID   = 'owner-uuid'
const OTHER_ID   = 'other-uuid'
const CHAR_ID    = 'char-uuid'

vi.mock('../models/trik', () => ({
  getPlayer: vi.fn(),
  getCharacterById: vi.fn(),
  updateCharacterTemplate: vi.fn(),
}))

import { getPlayer, getCharacterById, updateCharacterTemplate } from '../models/trik'
import { submitPlaquinha } from '../services/trik/registro/plaquinha'

describe('submitPlaquinha', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('rejeita nome/assinatura vazios sem tocar no banco', async () => {
    const result = await submitPlaquinha(OWNER_ID, CHAR_ID, '  ', 'assinatura')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VALIDATION')
    expect(getCharacterById).not.toHaveBeenCalled()
  })

  it('rejeita personagem inexistente', async () => {
    vi.mocked(getCharacterById).mockResolvedValue(null)
    const result = await submitPlaquinha(OWNER_ID, CHAR_ID, 'Nome', 'Assinatura')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_FOUND')
  })

  it('rejeita personagem de outro jogador', async () => {
    vi.mocked(getCharacterById).mockResolvedValue({ id: CHAR_ID, player_id: OTHER_ID } as any)
    vi.mocked(getPlayer).mockResolvedValue({ id: OWNER_ID } as any)
    const result = await submitPlaquinha(OWNER_ID, CHAR_ID, 'Nome', 'Assinatura')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FORBIDDEN')
    expect(updateCharacterTemplate).not.toHaveBeenCalled()
  })

  it('aceita o dono e grava o template', async () => {
    vi.mocked(getCharacterById).mockResolvedValue({ id: CHAR_ID, player_id: OWNER_ID } as any)
    vi.mocked(getPlayer).mockResolvedValue({ id: OWNER_ID } as any)
    vi.mocked(updateCharacterTemplate).mockResolvedValue({ id: CHAR_ID, template_name: 'Nome', template_signature: 'Assinatura' } as any)

    const result = await submitPlaquinha(OWNER_ID, CHAR_ID, 'Nome', 'Assinatura')
    expect(result.ok).toBe(true)
    expect(updateCharacterTemplate).toHaveBeenCalledWith(CHAR_ID, 'Nome', 'Assinatura')
  })
})
