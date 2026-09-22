// Módulo RPG (trik) — validação pura da seleção de pontos do /registro.
// Ver plans/fase-um.md, seção 3 ("ESCOLHA 2" em Mente/Coração/Corpo,
// "ESCOLHA 1" em Propósito/Sangue/Presença).

import { describe, it, expect } from 'vitest'
import { validatePointsSelection, type RegistroPayload } from '../services/trik/registro'

function character(overrides: Partial<RegistroPayload['character']> = {}): RegistroPayload['character'] {
  return {
    name: 'Test',
    fichaLink: 'https://example.com/ficha',
    principlesPicked: ['mente', 'corpo'],
    conductPicked: ['presenca'],
    ...overrides,
  }
}

describe('validatePointsSelection', () => {
  it('aceita 2 principles + 1 conduct', () => {
    expect(validatePointsSelection(character())).toBeNull()
  })

  it('rejeita menos de 2 principles', () => {
    const err = validatePointsSelection(character({ principlesPicked: ['mente'] }))
    expect(err).not.toBeNull()
  })

  it('rejeita mais de 2 principles', () => {
    const err = validatePointsSelection(character({ principlesPicked: ['mente', 'coracao', 'corpo'] }))
    expect(err).not.toBeNull()
  })

  it('rejeita 0 conduct', () => {
    const err = validatePointsSelection(character({ conductPicked: [] }))
    expect(err).not.toBeNull()
  })

  it('rejeita mais de 1 conduct', () => {
    const err = validatePointsSelection(character({ conductPicked: ['presenca', 'sangue'] }))
    expect(err).not.toBeNull()
  })

  it('rejeita opção repetida em principles', () => {
    const err = validatePointsSelection(character({ principlesPicked: ['mente', 'mente'] }))
    expect(err).not.toBeNull()
  })

  it('rejeita opção repetida em conduct (mesmo que o length bata)', () => {
    // length 1 já passaria na checagem de quantidade — mas não deveria
    // ser possível chegar aqui vindo de um Set no frontend; ainda assim,
    // um length 2 com repetição é o caso relevante:
    const err = validatePointsSelection(character({ conductPicked: ['presenca', 'presenca'] }))
    expect(err).not.toBeNull()
  })

  it('aceita as 3 combinações possíveis de conduct', () => {
    expect(validatePointsSelection(character({ conductPicked: ['presenca'] }))).toBeNull()
    expect(validatePointsSelection(character({ conductPicked: ['proposito'] }))).toBeNull()
    expect(validatePointsSelection(character({ conductPicked: ['sangue'] }))).toBeNull()
  })
})
