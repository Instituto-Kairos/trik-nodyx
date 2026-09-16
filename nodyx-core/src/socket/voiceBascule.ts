// ── Bascule mesh ↔ SFU (§17-B, cf SPECS/NODYX_SFU_BASCULE.md) ──────────────────
//
// Orchestration côté serveur du passage d'un canal vocal du mesh (P2P) à l'SFU
// SANS coupure : on garde le mesh debout, chaque client établit l'SFU en
// parallèle, et on ne ferme le mesh QUE quand TOUT LE MONDE est prêt (porte
// "tous prêts") — sinon un pair encore en mesh tomberait dans un trou (mesh N↔N).
//
// ADDITIF & DORMANT : si `VOICE_SFU_AUTO` ≠ 'true' (ou pas de `VOICE_SFU_URL`, ou
// canal hors liste blanche), `enabled()` est faux, aucune transition ne démarre,
// `channelMode()` reste 'mesh', et le mesh est STRICTEMENT inchangé.

import type { Server } from 'socket.io'

// Config lue paresseusement (testable : les tests règlent l'env puis appellent).
function auto(): boolean { return process.env.VOICE_SFU_AUTO === 'true' }
function hasSfu(): boolean { return !!process.env.VOICE_SFU_URL }
function allowList(): string[] {
  return (process.env.VOICE_SFU_AUTO_CHANNELS ?? '').split(',').map(s => s.trim()).filter(Boolean)
}
function threshold(): number {
  const n = parseInt(process.env.VOICE_SFU_MESH_THRESHOLD ?? '6', 10)
  return Number.isFinite(n) && n > 0 ? n : 6
}
const SWITCH_TIMEOUT_MS = 9000 // délai d'overlap avant abandon

function enabled(channelId: string): boolean {
  const allow = allowList()
  return auto() && hasSfu() && (allow.length === 0 || allow.includes(channelId))
}

type Mode = 'mesh' | 'switching' | 'sfu'

const _mode = new Map<string, Mode>()
const _ready = new Map<string, Set<string>>()   // socketIds ayant confirmé leur SFU
const _timer = new Map<string, ReturnType<typeof setTimeout>>()
const _cooldown = new Set<string>()             // canaux ayant abandonné : pas de retry avant changement de composition

function room(channelId: string): string { return `voice:${channelId}` }

export function channelMode(channelId: string): Mode {
  return _mode.get(channelId) ?? 'mesh'
}
export function channelIsSfu(channelId: string): boolean {
  return channelMode(channelId) === 'sfu'
}

// Appelé après un join, avec le nombre de participants du canal (seats).
export function onSeatCount(server: Server, channelId: string, count: number): void {
  if (!enabled(channelId)) return
  if (channelMode(channelId) !== 'mesh') return
  if (_cooldown.has(channelId)) return
  if (count < threshold()) return
  startSwitch(server, channelId)
}

// Quelqu'un commence un PARTAGE D'ÉCRAN : on bascule tout de suite, SANS attendre
// de quorum.
//
// Pourquoi ignorer le seuil ici : le partage d'écran est PRÉCISÉMENT le moment où le
// mesh s'écroule. Le partageur y uploade sa vidéo UNE FOIS PAR SPECTATEUR, et il
// plafonne vers 4 personnes. Attendre un quorum pour basculer, c'est attendre que le
// mesh souffre avant de le soulager : ça n'a aucun sens.
//
// On ignore aussi le cooldown : c'est une action DÉLIBÉRÉE de l'utilisateur, pas une
// bascule automatique déclenchée par une composition de canal. Il a le droit de
// réessayer.
export function onScreenShare(server: Server, channelId: string): void {
  if (!enabled(channelId)) return
  if (channelMode(channelId) !== 'mesh') return   // déjà en bascule ou en SFU : rien à faire
  _cooldown.delete(channelId)
  startSwitch(server, channelId)
}

function startSwitch(server: Server, channelId: string): void {
  _mode.set(channelId, 'switching')
  _ready.set(channelId, new Set())
  server.to(room(channelId)).emit('voice:mode', { channelId, mode: 'sfu' })
  clearTimer(channelId)
  _timer.set(channelId, setTimeout(() => abort(server, channelId), SWITCH_TIMEOUT_MS))
}

// Un client confirme que son SFU produit ET consomme (audio prêt, non joué).
export function onSfuReady(server: Server, channelId: string, socketId: string): void {
  if (channelMode(channelId) !== 'switching') return
  _ready.get(channelId)?.add(socketId)
  void checkAllReady(server, channelId)
}

async function checkAllReady(server: Server, channelId: string): Promise<void> {
  if (channelMode(channelId) !== 'switching') return
  const sockets = await server.in(room(channelId)).fetchSockets()
  if (sockets.length === 0) { reset(channelId); return }
  const ready = _ready.get(channelId) ?? new Set<string>()
  if (sockets.every(s => ready.has(s.id))) commit(server, channelId)
}

function commit(server: Server, channelId: string): void {
  clearTimer(channelId)
  _mode.set(channelId, 'sfu')
  _ready.delete(channelId)
  server.to(room(channelId)).emit('voice:sfu_commit', { channelId })
}

function abort(server: Server, channelId: string): void {
  if (channelMode(channelId) !== 'switching') return
  clearTimer(channelId)
  _mode.set(channelId, 'mesh')
  _ready.delete(channelId)
  _cooldown.add(channelId) // anti-flapping
  server.to(room(channelId)).emit('voice:mode', { channelId, mode: 'mesh' })
}

// Appelé au départ / à la déconnexion, avec le nombre de participants RESTANTS.
export function onLeave(server: Server, channelId: string, socketId: string, remaining: number): void {
  _ready.get(channelId)?.delete(socketId)
  if (remaining < threshold()) _cooldown.delete(channelId) // dip sous le seuil → on pourra re-tenter
  if (remaining === 0) { reset(channelId); return }
  if (channelMode(channelId) === 'switching') void checkAllReady(server, channelId)
}

function reset(channelId: string): void {
  clearTimer(channelId)
  _mode.delete(channelId)
  _ready.delete(channelId)
  _cooldown.delete(channelId)
}
function clearTimer(channelId: string): void {
  const t = _timer.get(channelId)
  if (t) { clearTimeout(t); _timer.delete(channelId) }
}

// ── Tests uniquement ──────────────────────────────────────────────────────────
export function _resetAllForTest(): void {
  for (const t of _timer.values()) clearTimeout(t)
  _mode.clear(); _ready.clear(); _timer.clear(); _cooldown.clear()
}
