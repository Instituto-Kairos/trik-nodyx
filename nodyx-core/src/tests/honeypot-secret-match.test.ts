import { describe, it, expect } from 'vitest'
import { secretMatches } from '../routes/honeypot'

// Trouvé en audit le 15/09 : les routes /_hp_cert/* de honeypot.ts comparaient
// un secret admin avec `!==` (non constant-time) ET retombaient sur
// JWT_SECRET (le secret de signature de TOUTES les sessions) quand
// CERT_REPORT_SECRET n'était pas configuré, ce qui était le cas en prod.

describe('secretMatches', () => {
  it('accepte une correspondance exacte', () => {
    expect(secretMatches('le-bon-secret', 'le-bon-secret')).toBe(true)
  })

  it('refuse une valeur différente', () => {
    expect(secretMatches('mauvais-secret', 'le-bon-secret')).toBe(false)
  })

  it('refuse quand aucun secret de référence n\'est configuré (fail-closed)', () => {
    expect(secretMatches('nimporte-quoi', undefined)).toBe(false)
  })

  it('refuse une valeur fournie non textuelle', () => {
    expect(secretMatches(undefined, 'le-bon-secret')).toBe(false)
    expect(secretMatches(['tableau'], 'le-bon-secret')).toBe(false)
  })

  it('refuse des longueurs différentes sans lever d\'exception', () => {
    expect(secretMatches('court', 'un-secret-beaucoup-plus-long')).toBe(false)
  })
})
