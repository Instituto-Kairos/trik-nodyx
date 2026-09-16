/**
 * storage.ts — Nodyx Authenticator
 *
 * Stockage persistant via IndexedDB.
 * La clé privée n'est jamais stockée en clair — toujours chiffrée via crypto.ts.
 */

import type { EncryptedPrivateKey, ExportedPublicKey } from './crypto'

const DB_NAME = 'nodyx-auth'
const DB_VERSION = 2

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeviceRecord {
	/** ID unique de cet appareil pour cette instance (UUID v4) */
	id: string
	/** Label affiché : "Téléphone principal", "Backup iPad", etc. */
	label: string
	/** Clé publique exportée — à envoyer au Hub */
	publicKey: ExportedPublicKey
	/** Clé privée chiffrée — reste sur l'appareil */
	encryptedPrivateKey: EncryptedPrivateKey
	/** Timestamp d'enregistrement */
	createdAt: number
	/** URL du Hub associé à cet appareil */
	hubUrl: string
	/** Token d'enregistrement Hub (optionnel — pour renouveler) */
	deviceToken?: string
	/**
	 * true si id/publicKey/encryptedPrivateKey ont été DÉRIVÉS depuis la graine
	 * maître (deriveIdentity) plutôt que générés au hasard. Les enregistrements
	 * historiques (avant le cloisonnement par instance) n'ont pas ce champ et
	 * doivent rester utilisables tels quels, sans jamais être régénérés.
	 */
	derived?: boolean
}

const SEED_RECORD_ID = 'master-seed' as const

/**
 * Graine maître chiffrée, unique par installation de l'app. Source de vérité
 * pour dériver une identité par instance (cf crypto.ts:deriveIdentity et
 * SPECS/NODYX_SIGNET_CLOISONNEMENT_IDENTITE_CDC.md). Un seul enregistrement,
 * clé fixe `SEED_RECORD_ID`.
 */
export interface SeedRecord {
	id: typeof SEED_RECORD_ID
	encryptedSeed: EncryptedPrivateKey
	createdAt: number
}

export interface PendingChallenge {
	/** ID du challenge (fourni par Hub) */
	id: string
	/** Contenu du challenge à signer */
	challenge: string
	/** URL du Hub émetteur */
	hubUrl: string
	/** IP source de la demande (affichée à l'utilisateur) */
	sourceIp?: string
	/** Timestamp d'émission */
	issuedAt: number
	/** TTL en secondes (défaut : 90) */
	ttl: number
}

// ─── Init DB ──────────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
	if (_db) return Promise.resolve(_db)

	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)

		req.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result

			// Store des appareils enregistrés
			if (!db.objectStoreNames.contains('devices')) {
				db.createObjectStore('devices', { keyPath: 'id' })
			}

			// Store des challenges en attente (polling ou push)
			if (!db.objectStoreNames.contains('challenges')) {
				const store = db.createObjectStore('challenges', { keyPath: 'id' })
				store.createIndex('issuedAt', 'issuedAt')
			}

			// v2 : graine maître (cloisonnement de l'identité par instance)
			if (!db.objectStoreNames.contains('identity')) {
				db.createObjectStore('identity', { keyPath: 'id' })
			}
		}

		req.onsuccess = () => {
			_db = req.result
			resolve(_db)
		}

		req.onerror = () => reject(new Error(`IndexedDB error: ${req.error?.message}`))
	})
}

function tx(
	db: IDBDatabase,
	store: string,
	mode: IDBTransactionMode
): IDBObjectStore {
	return db.transaction(store, mode).objectStore(store)
}

// ─── Appareils ────────────────────────────────────────────────────────────────

export async function saveDevice(device: DeviceRecord): Promise<void> {
	const db = await openDB()
	return new Promise((resolve, reject) => {
		const req = tx(db, 'devices', 'readwrite').put(device)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
}

export async function getDevice(id: string): Promise<DeviceRecord | null> {
	const db = await openDB()
	return new Promise((resolve, reject) => {
		const req = tx(db, 'devices', 'readonly').get(id)
		req.onsuccess = () => resolve(req.result ?? null)
		req.onerror = () => reject(req.error)
	})
}

export async function getAllDevices(): Promise<DeviceRecord[]> {
	const db = await openDB()
	return new Promise((resolve, reject) => {
		const req = tx(db, 'devices', 'readonly').getAll()
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

export async function deleteDevice(id: string): Promise<void> {
	const db = await openDB()
	return new Promise((resolve, reject) => {
		const req = tx(db, 'devices', 'readwrite').delete(id)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
}

/**
 * Trouve les appareils enregistrés pour CETTE origine d'instance précisément
 * (généralement un seul, parfois plusieurs si l'utilisateur en a enregistré
 * plusieurs volontairement). Remplace le `devices[0]` de l'ancien flow de
 * connexion (cf CDC, option A) : ne jamais proposer par défaut l'identité
 * créée pour une autre instance.
 */
export async function getDevicesByOrigin(origin: string): Promise<DeviceRecord[]> {
	const devices = await getAllDevices()
	return devices.filter((d) => {
		try {
			return new URL(d.hubUrl).origin === origin
		} catch {
			return false
		}
	})
}

// ─── Graine maître ──────────────────────────────────────────────────────────────

export async function saveMasterSeed(encryptedSeed: EncryptedPrivateKey): Promise<void> {
	const db = await openDB()
	const record: SeedRecord = { id: SEED_RECORD_ID, encryptedSeed, createdAt: Date.now() }
	return new Promise((resolve, reject) => {
		const req = tx(db, 'identity', 'readwrite').put(record)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
}

export async function getMasterSeed(): Promise<SeedRecord | null> {
	const db = await openDB()
	return new Promise((resolve, reject) => {
		const req = tx(db, 'identity', 'readonly').get(SEED_RECORD_ID)
		req.onsuccess = () => resolve(req.result ?? null)
		req.onerror = () => reject(req.error)
	})
}

export async function hasMasterSeed(): Promise<boolean> {
	return (await getMasterSeed()) !== null
}

// ─── Challenges ───────────────────────────────────────────────────────────────

export async function savePendingChallenge(c: PendingChallenge): Promise<void> {
	const db = await openDB()
	return new Promise((resolve, reject) => {
		const req = tx(db, 'challenges', 'readwrite').put(c)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
}

export async function getPendingChallenge(id: string): Promise<PendingChallenge | null> {
	const db = await openDB()
	return new Promise((resolve, reject) => {
		const req = tx(db, 'challenges', 'readonly').get(id)
		req.onsuccess = () => resolve(req.result ?? null)
		req.onerror = () => reject(req.error)
	})
}

export async function deletePendingChallenge(id: string): Promise<void> {
	const db = await openDB()
	return new Promise((resolve, reject) => {
		const req = tx(db, 'challenges', 'readwrite').delete(id)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
}

/**
 * Purge les challenges expirés. À appeler au démarrage.
 */
export async function purgeExpiredChallenges(): Promise<void> {
	const db = await openDB()
	const all = await new Promise<PendingChallenge[]>((resolve, reject) => {
		const req = tx(db, 'challenges', 'readonly').getAll()
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})

	const now = Date.now()
	const expired = all.filter((c) => now > c.issuedAt + c.ttl * 1000)

	await Promise.all(expired.map((c) => deletePendingChallenge(c.id)))
}

// ─── Utilitaire ───────────────────────────────────────────────────────────────

export function generateDeviceId(): string {
	return crypto.randomUUID()
}

/**
 * Vérifie si l'application a déjà au moins un appareil enregistré.
 */
export async function isSetupDone(): Promise<boolean> {
	const devices = await getAllDevices()
	return devices.length > 0
}
