import { describe, it, expect } from 'vitest'
import {
	deriveIdentity,
	generateMasterSeed,
	encryptSeed,
	decryptSeed,
	exportPublicKey,
	signChallenge,
	verifySignature,
	MASTER_SEED_LENGTH
} from './crypto'

// Dérivation déterministe d'identité par instance (chantier de cloisonnement,
// cf SPECS/NODYX_SIGNET_CLOISONNEMENT_IDENTITE_CDC.md). Le test le plus
// important ici est le vecteur figé : la dérivation DOIT rester identique
// pour toujours, sinon un futur refactor romprait silencieusement l'accès de
// tous les utilisateurs à toutes leurs instances déjà connectées.

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fixedSeed(): Uint8Array<ArrayBuffer> {
	return new Uint8Array(MASTER_SEED_LENGTH).fill(0x42) as Uint8Array<ArrayBuffer>
}

describe('deriveIdentity', () => {
	it('est déterministe : même graine + même origine -> même identité', async () => {
		const seed = fixedSeed()
		const a = await deriveIdentity(seed, 'https://a.nodyx.example')
		const b = await deriveIdentity(seed, 'https://a.nodyx.example')

		expect(a.deviceId).toBe(b.deviceId)
		const pubA = await exportPublicKey(a.keyPair.publicKey)
		const pubB = await exportPublicKey(b.keyPair.publicKey)
		expect(pubA.key).toEqual(pubB.key)
	})

	it('produit une identité différente pour une origine différente', async () => {
		const seed = fixedSeed()
		const a = await deriveIdentity(seed, 'https://a.nodyx.example')
		const b = await deriveIdentity(seed, 'https://b.nodyx.example')

		expect(a.deviceId).not.toBe(b.deviceId)
		const pubA = await exportPublicKey(a.keyPair.publicKey)
		const pubB = await exportPublicKey(b.keyPair.publicKey)
		expect(pubA.key.x).not.toBe(pubB.key.x)
	})

	it('produit une identité différente pour une graine différente, même origine', async () => {
		const seedA = fixedSeed()
		const seedB = new Uint8Array(MASTER_SEED_LENGTH).fill(0x99) as Uint8Array<ArrayBuffer>
		const a = await deriveIdentity(seedA, 'https://a.nodyx.example')
		const b = await deriveIdentity(seedB, 'https://a.nodyx.example')

		expect(a.deviceId).not.toBe(b.deviceId)
	})

	it('produit un deviceId au format UUID v4 valide (ce que z.string().uuid() exige côté nodyx-core)', async () => {
		const { deviceId } = await deriveIdentity(fixedSeed(), 'https://a.nodyx.example')
		expect(deviceId).toMatch(UUID_V4_RE)
	})

	it('la clé dérivée signe et vérifie correctement (round-trip WebCrypto complet)', async () => {
		const { keyPair } = await deriveIdentity(fixedSeed(), 'https://a.nodyx.example')
		const signed = await signChallenge(keyPair.privateKey, 'un-challenge-de-test')
		const valid = await verifySignature(keyPair.publicKey, signed.signature, signed.challenge)
		expect(valid).toBe(true)
	})

	it("une signature ne vérifie PAS avec la clé publique d'une autre instance", async () => {
		const seed = fixedSeed()
		const a = await deriveIdentity(seed, 'https://a.nodyx.example')
		const b = await deriveIdentity(seed, 'https://b.nodyx.example')
		const signed = await signChallenge(a.keyPair.privateKey, 'un-challenge-de-test')
		const valid = await verifySignature(b.keyPair.publicKey, signed.signature, signed.challenge)
		expect(valid).toBe(false)
	})

	// Vecteur figé : graine = 32 x 0x42, origine = https://test.nodyx.example.
	// Si ce test casse après une modification de deriveIdentity/HKDF_SALT/les
	// préfixes "info", c'est que la dérivation a changé : TOUTES les identités
	// déjà dérivées par les utilisateurs existants seraient perdues. Ne changer
	// ces valeurs qu'en connaissance de cause, avec un plan de migration.
	it('reproduit exactement le vecteur de test figé (non-régression de la dérivation)', async () => {
		const seed = new Uint8Array(MASTER_SEED_LENGTH).fill(0x42) as Uint8Array<ArrayBuffer>
		const { deviceId, keyPair } = await deriveIdentity(seed, 'https://test.nodyx.example')
		const pub = await exportPublicKey(keyPair.publicKey)

		expect(deviceId).toBe('8a9dcd37-c3f3-4142-9f57-210e87f7314f')
		expect(pub.key.x).toBe('00Y2jIm5FB8Ivukh2ALO7ZsUTp85qBy4bxjJX2Tn2jI')
		expect(pub.key.y).toBe('Ge772nDMrpIQjscBBrgGWQl188I54Z2k-jBACpga7io')
	})
})

describe('generateMasterSeed / encryptSeed / decryptSeed', () => {
	it('génère une graine de la bonne longueur', () => {
		expect(generateMasterSeed().length).toBe(MASTER_SEED_LENGTH)
	})

	it('chiffre puis déchiffre la graine à l\'identique avec la bonne passphrase', async () => {
		const seed = generateMasterSeed()
		const encrypted = await encryptSeed(seed, 'ma-passphrase-de-test')
		const decrypted = await decryptSeed(encrypted, 'ma-passphrase-de-test')
		expect(Array.from(decrypted)).toEqual(Array.from(seed))
	})

	it('refuse une passphrase incorrecte', async () => {
		const seed = generateMasterSeed()
		const encrypted = await encryptSeed(seed, 'bonne-passphrase')
		await expect(decryptSeed(encrypted, 'mauvaise-passphrase')).rejects.toThrow()
	})
})
