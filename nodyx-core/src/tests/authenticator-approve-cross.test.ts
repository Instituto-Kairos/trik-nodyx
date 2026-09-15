import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { webcrypto } from 'crypto'
import { buildApp } from './helpers/buildApp'

// Régression pour la faille de prise de compte trouvée en audit le 15/09 :
// POST /challenges/approve-cross vérifiait la signature contre la pubkey
// fournie dans le BODY, jamais contre celle déjà enregistrée pour le
// deviceId visé. `deviceId` n'étant pas un secret (il transite vers chaque
// instance visitée par construction du flow), quiconque le connaît pouvait
// se forger sa propre paire de clés, se signer lui-même le challenge, et se
// faire passer pour le propriétaire du compte.

const dbQuery = vi.fn()
const redisIncr = vi.fn().mockResolvedValue(1)

vi.mock('../config/database', () => ({
  db: { query: (...a: unknown[]) => dbQuery(...a) },
  redis: {
    incr:   (...a: unknown[]) => redisIncr(...a),
    expire: vi.fn().mockResolvedValue(1),
    setex:  vi.fn().mockResolvedValue('OK'),
    sadd:   vi.fn().mockResolvedValue(1),
  },
}))

let app: FastifyInstance

beforeEach(async () => {
  // resetAllMocks (pas clearAllMocks) : une file mockResolvedValueOnce non
  // épuisée par un test précédent (ex. un test qui s'arrête tôt sur un 401)
  // ne doit jamais fuiter dans le test suivant et décaler ses réponses.
  vi.resetAllMocks()
  redisIncr.mockResolvedValue(1)
  process.env.JWT_SECRET = 'secret-de-test'
  const { default: authenticatorRoutes } = await import('../routes/authenticator')
  app = await buildApp(async (a) => { await a.register(authenticatorRoutes, { prefix: '/api/auth' }) })
})

async function generateKeypair() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey)
  return { privateKey: pair.privateKey, publicJwk }
}

async function sign(privateKey: CryptoKey, challenge: string): Promise<string> {
  const sig = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    new TextEncoder().encode(challenge)
  )
  return Buffer.from(sig).toString('base64url')
}

const DEVICE_ID = '11111111-1111-4111-8111-111111111111'
const CHALLENGE = 'challenge-de-test'

const approveCross = (body: unknown) => app.inject({
  method: 'POST',
  url: '/api/auth/challenges/approve-cross',
  payload: body,
})

describe('POST /challenges/approve-cross', () => {
  it('refuse une pubkey attaquant sur un deviceId déjà enregistré (prise de compte)', async () => {
    const victim   = await generateKeypair()
    const attacker = await generateKeypair()

    // 1) challenge anonyme trouvé — 2) device déjà enregistré, clé de la victime en base
    dbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'chal-1', challenge: CHALLENGE }] })
      .mockResolvedValueOnce({ rows: [{
        id: DEVICE_ID, user_id: 'victim-id', username: 'victime',
        public_key: { algorithm: 'ECDSA', key: victim.publicJwk }, // colonne jsonb : déjà un objet, pas une string
      }] })

    // L'attaquant signe avec SA propre clé et fournit SA propre pubkey
    const signature = await sign(attacker.privateKey, CHALLENGE)

    const res = await approveCross({
      signature, challenge: CHALLENGE,
      pubkey: { algorithm: 'ECDSA', key: attacker.publicJwk },
      deviceId: DEVICE_ID, deviceLabel: 'Appareil attaquant',
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('INVALID_SIGNATURE')
    // Aucune session n'a dû être créée : seuls les 2 SELECT ont eu lieu, pas
    // le UPDATE de last_used_at ni l'approbation du challenge.
    expect(dbQuery).toHaveBeenCalledTimes(2)
  })

  it('accepte le propriétaire légitime signant avec sa propre clé déjà enregistrée', async () => {
    const owner = await generateKeypair()

    dbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'chal-1', challenge: CHALLENGE }] })
      .mockResolvedValueOnce({ rows: [{
        id: DEVICE_ID, user_id: 'owner-id', username: 'proprietaire',
        public_key: { algorithm: 'ECDSA', key: owner.publicJwk },
      }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE last_used_at
      .mockResolvedValueOnce({ rows: [] }) // UPDATE challenge approved

    const signature = await sign(owner.privateKey, CHALLENGE)

    const res = await approveCross({
      signature, challenge: CHALLENGE,
      pubkey: { algorithm: 'ECDSA', key: owner.publicJwk },
      deviceId: DEVICE_ID, deviceLabel: 'Mon appareil',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.isNewUser).toBe(false)
    expect(body.username).toBe('proprietaire')
  })

  it('crée un nouveau compte quand le deviceId est inconnu (chemin légitime inchangé)', async () => {
    const fresh = await generateKeypair()

    dbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'chal-1', challenge: CHALLENGE }] }) // challenge
      .mockResolvedValueOnce({ rows: [] })                                       // existingDevice: aucun
      .mockResolvedValueOnce({ rows: [] })                                       // username libre
      .mockResolvedValueOnce({ rows: [{ id: 'new-user-id', username: 'user_11111111' }] }) // INSERT users
      .mockResolvedValueOnce({ rows: [{ id: 'community-1' }] })                  // SELECT communities
      .mockResolvedValueOnce({ rows: [] })                                       // INSERT community_members
      .mockResolvedValueOnce({ rows: [] })                                       // INSERT user_profiles
      .mockResolvedValueOnce({ rows: [] })                                       // INSERT authenticator_devices
      .mockResolvedValueOnce({ rows: [] })                                       // UPDATE challenge approved

    const signature = await sign(fresh.privateKey, CHALLENGE)

    const res = await approveCross({
      signature, challenge: CHALLENGE,
      pubkey: { algorithm: 'ECDSA', key: fresh.publicJwk },
      deviceId: DEVICE_ID, deviceLabel: 'Nouvel appareil',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.isNewUser).toBe(true)
  })
})
