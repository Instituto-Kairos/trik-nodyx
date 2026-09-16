/**
 * crypto.ts — Nodyx Authenticator
 *
 * Web Crypto API pour tout le chiffrement/signature courant.
 * @noble/curves + @noble/hashes UNIQUEMENT pour la dérivation déterministe
 * d'identité par instance (deriveIdentity) : WebCrypto ne permet pas de
 * dériver une clé ECDSA depuis un secret, noble le fait correctement (rejet
 * de biais RFC 9380) sans réimplémenter la réduction modulaire à la main.
 * Une fois la paire de clés dérivée, elle est réimportée en CryptoKey et le
 * reste du fichier ne voit plus la différence avec une clé générée au hasard.
 *
 * Algorithmes :
 *   - ECDSA P-256 : signature / vérification
 *   - AES-GCM 256-bit : chiffrement de la clé privée (ou de la graine
 *     maître) au repos
 *   - PBKDF2 SHA-256 : dérivation de clé depuis la passphrase
 *   - HKDF-SHA256 : dérivation d'identité par instance depuis la graine
 *     maître (voir SPECS/NODYX_SIGNET_CLOISONNEMENT_IDENTITE_CDC.md)
 */

import { p256 } from '@noble/curves/nist.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

const ECDSA_PARAMS: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' }
const SIGN_PARAMS: EcdsaParams = { name: 'ECDSA', hash: { name: 'SHA-256' } }
const AES_PARAMS = { name: 'AES-GCM', length: 256 } as const
const PBKDF2_ITERATIONS = 310_000 // OWASP 2024 minimum pour PBKDF2-SHA256

// ─── Dérivation d'identité par instance ────────────────────────────────────────
//
// Graine -> une clé P-256 déterministe PAR ORIGINE D'INSTANCE, jamais
// réutilisée telle quelle d'une instance à l'autre. Constantes versionnées
// (v1) : ne jamais changer une valeur ici sans changer le suffixe, un
// changement silencieux romprait la reproductibilité de TOUTE identité déjà
// dérivée (l'utilisateur perdrait l'accès à tous ses comptes Signet d'un coup).
const HKDF_SALT = new TextEncoder().encode('nodyx-signet-hkdf-salt-v1')
const KEYPAIR_INFO_PREFIX = 'nodyx-signet-keypair-v1|'
const DEVICE_ID_INFO_PREFIX = 'nodyx-signet-device-id-v1|'
// (groupLen + ceil(groupLen/2)) pour P-256 (groupLen=32) : le minimum documenté
// par @noble/curves pour une réduction modulaire à biais négligeable.
const P256_KEYGEN_SEED_LENGTH = 48
const DEVICE_ID_SEED_LENGTH = 16
export const MASTER_SEED_LENGTH = 32

// ─── Types exportés ───────────────────────────────────────────────────────────

export interface KeyPair {
	publicKey: CryptoKey
	privateKey: CryptoKey
}

export interface ExportedPublicKey {
	algorithm: string
	key: JsonWebKey
}

export interface EncryptedPrivateKey {
	/** IV AES-GCM — 12 bytes base64 */
	iv: string
	/** Données chiffrées base64 */
	data: string
	/** Sel PBKDF2 — 32 bytes base64 */
	salt: string
}

export interface SignedChallenge {
	/** Signature ECDSA base64url */
	signature: string
	/** Challenge original (pour vérification côté Hub) */
	challenge: string
}

// ─── Génération de clés ───────────────────────────────────────────────────────

/**
 * Génère une nouvelle paire de clés ECDSA P-256.
 * extractable: false pour privateKey — la clé privée ne peut pas être exportée en clair.
 * Seul le chiffrement AES permet de la stocker.
 */
export async function generateKeyPair(): Promise<KeyPair> {
	const keyPair = await crypto.subtle.generateKey(
		ECDSA_PARAMS,
		true, // extractable: true requis pour pouvoir l'exporter + chiffrer avant stockage
		['sign', 'verify']
	)
	return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey }
}

// ─── Export / Import clé publique ─────────────────────────────────────────────

/**
 * Exporte la clé publique au format JWK — à envoyer au Hub lors de l'enregistrement.
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<ExportedPublicKey> {
	const jwk = await crypto.subtle.exportKey('jwk', publicKey)
	return { algorithm: 'ECDSA-P256', key: jwk }
}

/**
 * Importe une clé publique JWK — pour vérification côté client (optionnel).
 */
export async function importPublicKey(exported: ExportedPublicKey): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'jwk',
		exported.key,
		ECDSA_PARAMS,
		true,
		['verify']
	)
}

// ─── Chiffrement de la clé privée ─────────────────────────────────────────────

/**
 * Dérive une clé AES-GCM depuis une passphrase via PBKDF2.
 * Le sel est aléatoire et stocké avec le chiffré.
 */
async function deriveAesKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
	const encoder = new TextEncoder()
	const baseKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(passphrase),
		'PBKDF2',
		false,
		['deriveKey']
	)
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		baseKey,
		AES_PARAMS,
		false,
		['encrypt', 'decrypt']
	)
}

/**
 * Chiffre un buffer arbitraire avec AES-GCM, clé dérivée depuis la passphrase.
 * Primitive partagée : sert à la fois à la clé privée (legacy, par appareil)
 * et à la graine maître (dérivation par instance, voir plus bas).
 */
async function encryptBytes(raw: BufferSource, passphrase: string): Promise<EncryptedPrivateKey> {
	const salt = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>
	const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>

	const aesKey = await deriveAesKey(passphrase, salt)
	const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, raw)

	return {
		iv: bufferToBase64(iv),
		data: bufferToBase64(encrypted),
		salt: bufferToBase64(salt)
	}
}

/**
 * Déchiffre un buffer arbitraire chiffré par encryptBytes().
 * Lance une erreur si la passphrase est incorrecte (AES-GCM integrity check).
 */
async function decryptBytes(encrypted: EncryptedPrivateKey, passphrase: string): Promise<ArrayBuffer> {
	const salt = base64ToBuffer(encrypted.salt)
	const iv = base64ToBuffer(encrypted.iv)
	const data = base64ToBuffer(encrypted.data)

	const aesKey = await deriveAesKey(passphrase, new Uint8Array(salt) as Uint8Array<ArrayBuffer>)

	try {
		return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, aesKey, data)
	} catch {
		throw new Error('Passphrase incorrecte ou données corrompues.')
	}
}

/**
 * Chiffre la clé privée avec AES-GCM, clé dérivée depuis la passphrase.
 * Retourne les données prêtes à stocker dans IndexedDB.
 */
export async function encryptPrivateKey(
	privateKey: CryptoKey,
	passphrase: string
): Promise<EncryptedPrivateKey> {
	const rawPrivateKey = await crypto.subtle.exportKey('pkcs8', privateKey)
	return encryptBytes(rawPrivateKey, passphrase)
}

/**
 * Déchiffre la clé privée stockée avec la passphrase.
 * Lance une erreur si la passphrase est incorrecte (AES-GCM integrity check).
 */
export async function decryptPrivateKey(
	encrypted: EncryptedPrivateKey,
	passphrase: string
): Promise<CryptoKey> {
	const rawPrivateKey = await decryptBytes(encrypted, passphrase)

	return crypto.subtle.importKey(
		'pkcs8',
		rawPrivateKey,
		ECDSA_PARAMS,
		true,
		['sign']
	)
}

// ─── Graine maître et identité dérivée par instance ────────────────────────────
//
// Voir SPECS/NODYX_SIGNET_CLOISONNEMENT_IDENTITE_CDC.md pour le contexte
// complet. Résumé : avant, un seul deviceId + une seule paire de clés étaient
// générés une fois et réutilisés tels quels vers toutes les instances visitées
// (le flow de connexion envoyait toujours le même appareil, cf `connect/
// +page.svelte`), ce qui rendait le même appareil corrélable d'une communauté
// à l'autre par quiconque recoupe plusieurs jeux de logs. Une seule graine
// maître (générée une fois, chiffrée avec la passphrase exactement comme une
// clé privée) permet de dériver, à la demande et de façon déterministe, une
// identité DIFFÉRENTE et NON CORRÉLABLE pour chaque origine d'instance :
// perdre le cache local n'est pas grave, la même graine + la même origine
// redonnent toujours la même identité (recomposition possible, pas de
// sauvegarde par instance nécessaire).

/** Génère une nouvelle graine maître (32 octets). À faire une seule fois. */
export function generateMasterSeed(): Uint8Array<ArrayBuffer> {
	return crypto.getRandomValues(new Uint8Array(MASTER_SEED_LENGTH)) as Uint8Array<ArrayBuffer>
}

/** Chiffre la graine maître avec la passphrase, même mécanisme que encryptPrivateKey. */
export async function encryptSeed(seed: Uint8Array, passphrase: string): Promise<EncryptedPrivateKey> {
	// Copie vers un buffer proprement typé ArrayBuffer (pas ArrayBufferLike) :
	// une graine peut arriver ici depuis decryptSeed(), dont le type de retour
	// est plus large, ce que le typage strict de BufferSource n'accepte pas tel quel.
	return encryptBytes(new Uint8Array(seed), passphrase)
}

/** Déchiffre la graine maître stockée avec la passphrase. */
export async function decryptSeed(encrypted: EncryptedPrivateKey, passphrase: string): Promise<Uint8Array> {
	const raw = await decryptBytes(encrypted, passphrase)
	return new Uint8Array(raw)
}

export interface DerivedIdentity {
	deviceId: string
	keyPair: KeyPair
}

/**
 * Formate 16 octets en chaîne UUID, version 4 / variante RFC 4122 (les deux
 * seuls bits que le backend valide réellement, cf `z.string().uuid()` côté
 * nodyx-core), le contenu n'est PAS aléatoire (il est dérivé), seul le
 * FORMAT doit se conformer à ce qu'attend le serveur.
 */
function bytesToUuid(bytes: Uint8Array): string {
	const b = new Uint8Array(bytes) // copie : on va muter deux octets
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variante RFC 4122 (8/9/a/b)
	const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Dérive un deviceId ET une paire de clés ECDSA P-256, de façon déterministe,
 * depuis la graine maître et l'ORIGINE de l'instance (protocole + host, sans
 * chemin ni query, à normaliser par l'appelant via `new URL(url).origin`).
 * Même graine + même origine -> toujours la même identité. Origine différente
 * -> identité cryptographiquement indépendante (HKDF avec un "info" distinct
 * par usage ET par origine), impossible à relier sans casser HKDF/P-256.
 */
export async function deriveIdentity(masterSeed: Uint8Array, instanceOrigin: string): Promise<DerivedIdentity> {
	const encoder = new TextEncoder()

	const keySeed = hkdf(
		sha256,
		masterSeed,
		HKDF_SALT,
		encoder.encode(KEYPAIR_INFO_PREFIX + instanceOrigin),
		P256_KEYGEN_SEED_LENGTH
	)
	const { secretKey } = p256.keygen(keySeed)
	const rawPublicKey = p256.getPublicKey(secretKey, false) // non compressé : 0x04 || X(32) || Y(32)
	const x = rawPublicKey.slice(1, 33)
	const y = rawPublicKey.slice(33, 65)

	const privateKey = await crypto.subtle.importKey(
		'jwk',
		{ kty: 'EC', crv: 'P-256', d: bufferToBase64url(secretKey), x: bufferToBase64url(x), y: bufferToBase64url(y), ext: true },
		ECDSA_PARAMS,
		true,
		['sign']
	)
	const publicKey = await crypto.subtle.importKey(
		'jwk',
		{ kty: 'EC', crv: 'P-256', x: bufferToBase64url(x), y: bufferToBase64url(y), ext: true },
		ECDSA_PARAMS,
		true,
		['verify']
	)

	const deviceIdSeed = hkdf(
		sha256,
		masterSeed,
		HKDF_SALT,
		encoder.encode(DEVICE_ID_INFO_PREFIX + instanceOrigin),
		DEVICE_ID_SEED_LENGTH
	)
	const deviceId = bytesToUuid(deviceIdSeed)

	return { deviceId, keyPair: { privateKey, publicKey } }
}

// ─── Signature / Vérification ─────────────────────────────────────────────────

/**
 * Signe un challenge reçu du Hub.
 * Le challenge doit inclure l'URL du Hub pour éviter le phishing cross-site.
 */
export async function signChallenge(
	privateKey: CryptoKey,
	challenge: string
): Promise<SignedChallenge> {
	const encoder = new TextEncoder()
	const signatureBuffer = await crypto.subtle.sign(
		SIGN_PARAMS,
		privateKey,
		encoder.encode(challenge)
	)
	return {
		signature: bufferToBase64url(signatureBuffer),
		challenge
	}
}

/**
 * Vérifie une signature — utilisé côté Hub (Node.js Web Crypto API).
 * Exporté ici pour les tests unitaires frontend.
 */
export async function verifySignature(
	publicKey: CryptoKey,
	signature: string,
	challenge: string
): Promise<boolean> {
	const encoder = new TextEncoder()
	try {
		return await crypto.subtle.verify(
			SIGN_PARAMS,
			publicKey,
			base64urlToBuffer(signature),
			encoder.encode(challenge)
		)
	} catch {
		return false
	}
}

// ─── Utilitaires base64 ───────────────────────────────────────────────────────

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
	return btoa(String.fromCharCode(...bytes))
}

function base64ToBuffer(b64: string): ArrayBuffer {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes.buffer
}

/** base64url (RFC 4648) — sans padding, URL-safe */
function bufferToBase64url(buffer: ArrayBuffer | Uint8Array): string {
	return bufferToBase64(buffer)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '')
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
	const b64 = b64url
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), '=')
	return base64ToBuffer(b64)
}
