import { describe, it, expect } from 'vitest'
import { scanBuffer } from '../services/fileScanner'

// scanBuffer n'avait aucun test dédié malgré son usage sur 4 routes d'upload
// (music, users, admin, assets) — trouvé en audit sécurité le 15/09, en même
// temps qu'une 5e route (social.ts /upload) qui l'omettait complètement et
// écrivait le buffer sur disque sans aucune vérification de contenu.

describe('scanBuffer', () => {
  it('rejette un exécutable Windows renommé en .mp3', () => {
    const fakeMp3 = Buffer.concat([Buffer.from([0x4D, 0x5A]), Buffer.alloc(100)]) // MZ
    const result = scanBuffer(fakeMp3, 'audio/mpeg')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Windows PE/)
  })

  it('rejette un script shell avec shebang', () => {
    const script = Buffer.from('#!/bin/sh\nrm -rf /\n')
    const result = scanBuffer(script, 'audio/mpeg')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Script exécutable/)
  })

  it('rejette une archive ZIP peu importe l\'extension déclarée', () => {
    const zip = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0])
    const result = scanBuffer(zip, 'image/png')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/ZIP/)
  })

  it('rejette un contenu dont les magic bytes ne correspondent pas au MIME déclaré', () => {
    const notAPng = Buffer.from('ceci n\'est pas un PNG du tout')
    const result = scanBuffer(notAPng, 'image/png')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/ne correspond pas au type déclaré/)
  })

  it('accepte un vrai MP3 (sync word MPEG)', () => {
    const realMp3 = Buffer.concat([Buffer.from([0xFF, 0xFB]), Buffer.alloc(50)])
    expect(scanBuffer(realMp3, 'audio/mpeg').ok).toBe(true)
  })

  it('accepte un vrai PNG', () => {
    const realPng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    expect(scanBuffer(realPng, 'image/png').ok).toBe(true)
  })

  it('rejette un WAV/AVI déguisé en WebP (RIFF partagé)', () => {
    const riffNotWebp = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]), Buffer.alloc(4),
      Buffer.from('WAVE'),
    ])
    const result = scanBuffer(riffNotWebp, 'image/webp')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/RIFF non-WebP/)
  })
})
