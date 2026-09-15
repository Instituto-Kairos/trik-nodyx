import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './helpers/buildApp'

// Régression pour la 2e faille de prise de compte trouvée dans le même audit
// que approve-cross (15/09), même racine : POST /devices/register faisait un
// upsert `ON CONFLICT (id) DO UPDATE` sur un `deviceId` choisi par le CLIENT,
// SANS jamais vérifier que la ligne en conflit appartenait déjà à l'appelant.
// Un attaquant avec n'importe quel compte pouvait enregistrer le deviceId
// d'un appareil existant, écraser sa clé publique et son device_token, et
// obtenir un device_token qui reste rattaché au user_id de la VICTIME.

const dbQuery = vi.fn()
const redisIncr = vi.fn().mockResolvedValue(1)

vi.mock('../config/database', () => ({
  db: { query: (...a: unknown[]) => dbQuery(...a) },
  redis: {
    incr:   (...a: unknown[]) => redisIncr(...a),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

let app: FastifyInstance

beforeEach(async () => {
  vi.resetAllMocks()
  redisIncr.mockResolvedValue(1)
  process.env.JWT_SECRET = 'secret-de-test'
  const { default: authenticatorRoutes } = await import('../routes/authenticator')
  app = await buildApp(async (a) => { await a.register(authenticatorRoutes, { prefix: '/api/auth' }) })
})

const VICTIM_DEVICE_ID = '22222222-2222-4222-8222-222222222222'

const registerDevice = (body: unknown) => app.inject({
  method: 'POST',
  url: '/api/auth/devices/register',
  payload: body,
})

describe('POST /devices/register', () => {
  it("l'INSERT porte bien la garde WHERE user_id = EXCLUDED.user_id (verrou syntaxique du correctif)", async () => {
    dbQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'attacker-id' }] }) // consommation du jeton
      .mockResolvedValueOnce({ rowCount: 1 })                        // upsert

    await registerDevice({
      deviceId: VICTIM_DEVICE_ID, deviceLabel: 'Appareil attaquant',
      publicKey: { algorithm: 'ECDSA', key: {} }, enrollmentToken: 'tok-attaquant',
    })

    const insertCall = dbQuery.mock.calls.find(call => String(call[0]).includes('INSERT INTO authenticator_devices'))
    expect(insertCall).toBeDefined()
    expect(String(insertCall![0])).toMatch(/WHERE\s+authenticator_devices\.user_id\s*=\s*EXCLUDED\.user_id/)
  })

  it('refuse de prendre le contrôle du deviceId d\'un appareil appartenant à un autre compte', async () => {
    dbQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'attacker-id' }] }) // jeton valide, POUR l'attaquant
      .mockResolvedValueOnce({ rowCount: 0 })                        // conflit : la ligne appartient à quelqu'un d'autre, WHERE bloque l'UPDATE

    const res = await registerDevice({
      deviceId: VICTIM_DEVICE_ID, deviceLabel: 'Appareil attaquant',
      publicKey: { algorithm: 'ECDSA', key: {} }, enrollmentToken: 'tok-attaquant',
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('DEVICE_ID_CONFLICT')
  })

  it('accepte le ré-enregistrement légitime de son propre appareil', async () => {
    dbQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'owner-id' }] })
      .mockResolvedValueOnce({ rowCount: 1 })

    const res = await registerDevice({
      deviceId: VICTIM_DEVICE_ID, deviceLabel: 'Mon appareil réinstallé',
      publicKey: { algorithm: 'ECDSA', key: {} }, enrollmentToken: 'tok-proprietaire',
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().success).toBe(true)
  })

  it("refuse un jeton d'enrôlement déjà consommé (TOCTOU) sans jamais créer d'appareil", async () => {
    // La consommation atomique (UPDATE ... WHERE used_at IS NULL RETURNING) ne
    // renvoie aucune ligne pour un jeton déjà utilisé par un appel concurrent.
    dbQuery.mockResolvedValueOnce({ rows: [] })

    const res = await registerDevice({
      deviceId: VICTIM_DEVICE_ID, deviceLabel: 'Appareil',
      publicKey: { algorithm: 'ECDSA', key: {} }, enrollmentToken: 'tok-deja-utilise',
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('INVALID_TOKEN')
    // Un seul appel DB : la consommation du jeton. Aucun INSERT sur authenticator_devices.
    expect(dbQuery).toHaveBeenCalledTimes(1)
  })
})
