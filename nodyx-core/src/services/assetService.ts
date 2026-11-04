import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { db } from '../config/database'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'assets')
const MAX_DIMENSION = 1024  // max width or height in px
const THUMB_SIZE    = 256   // thumbnail square size

// Categorias da biblioteca (trik_019): ik, au, staff, emoji (Emotes),
// badge (Emblemas) e bulk (privado de quem enviou). sound/video/font/theme são
// tipos internos (soundboard, /admin/media, música), fora da biblioteca.
export type AssetType = 'ik' | 'au' | 'staff' | 'emoji' | 'badge' | 'bulk' | 'sound' | 'video' | 'font' | 'theme'

export interface AssetRow {
  id: string
  asset_type: AssetType
  name: string
  description: string | null
  creator_id: string | null
  created_at: string
  file_path: string
  file_hash: string
  file_size: number
  mime_type: string
  original_filename: string | null
  thumbnail_path: string | null
  tags: string[]
  metadata: Record<string, unknown>
  downloads: number
  is_public: boolean
  is_banned: boolean
}

// ── Ensure uploads directory exists ─────────────────────────────────────────

export async function ensureUploadsDir(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true })
}

// ── Upload a new asset ───────────────────────────────────────────────────────

export async function uploadAsset(opts: {
  creatorId: string
  buffer: Buffer
  originalFilename: string
  mimeType: string
  assetType: AssetType
  name: string
  description?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}): Promise<AssetRow> {
  const { creatorId, buffer, originalFilename, mimeType, assetType, name, description, tags, metadata } = opts

  await ensureUploadsDir()

  const hash = crypto.createHash('sha256').update(buffer).digest('hex')

  // Determine if this is an image type that sharp can process
  const isImage = mimeType.startsWith('image/')

  let finalBuffer = buffer
  let finalMime   = mimeType
  let filePath    = `assets/${hash}.${path.extname(originalFilename).slice(1) || 'bin'}`
  let thumbPath: string | null = null

  if (isImage) {
    const isAnimated = mimeType === 'image/gif' || mimeType === 'image/webp'

    // Resize to max dimension, convert to WebP (preserve all frames for animated GIF/WebP)
    finalBuffer = await sharp(buffer, { animated: isAnimated })
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()
    finalMime = 'image/webp'
    filePath  = `assets/${hash}.webp`

    // Generate thumbnail — first frame only, no animation
    const thumbBuffer = await sharp(buffer)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .webp({ quality: 75 })
      .toBuffer()
    thumbPath = `assets/${hash}_thumb.webp`
    await fs.writeFile(path.join(process.cwd(), 'uploads', thumbPath), thumbBuffer)
  }

  // Write main file
  await fs.writeFile(path.join(process.cwd(), 'uploads', filePath), finalBuffer)

  const { rows } = await db.query<AssetRow>(
    `INSERT INTO community_assets
       (asset_type, name, description, creator_id,
        file_path, file_hash, file_size, mime_type, original_filename,
        thumbnail_path, tags, metadata, is_public)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      assetType, name, description ?? null, creatorId,
      filePath, hash, finalBuffer.length, finalMime, originalFilename,
      thumbPath, tags ?? [], JSON.stringify(metadata ?? {}),
      assetType !== 'bulk',
    ]
  )
  return rows[0]
}

// ── Get a single asset (increments downloads) ────────────────────────────────

export async function getAsset(id: string): Promise<AssetRow | null> {
  const { rows } = await db.query<AssetRow>(
    `UPDATE community_assets
     SET downloads = downloads + 1
     WHERE id = $1 AND is_banned = false
     RETURNING *`,
    [id]
  )
  return rows[0] ?? null
}

// ── Get asset metadata without download counter ───────────────────────────────

export async function getAssetMeta(id: string): Promise<AssetRow | null> {
  const { rows } = await db.query<AssetRow>(
    `SELECT * FROM community_assets WHERE id = $1 AND is_banned = false AND asset_type NOT IN ('staff', 'bulk')`,
    [id]
  )
  return rows[0] ?? null
}

// ── List assets for a user ────────────────────────────────────────────────────

export async function listUserAssets(userId: string): Promise<AssetRow[]> {
  const { rows } = await db.query<AssetRow>(
    `SELECT * FROM community_assets
     WHERE creator_id = $1 AND is_banned = false AND asset_type NOT IN ('staff', 'bulk')
     ORDER BY created_at DESC`,
    [userId]
  )
  return rows
}

// ── Search public assets ──────────────────────────────────────────────────────

export async function searchAssets(opts: {
  q?: string
  assetType?: string
  limit?: number
  offset?: number
}): Promise<AssetRow[]> {
  const { q, assetType, limit = 20, offset = 0 } = opts
  const params: unknown[] = []
  // 'staff' (trik_016) e 'bulk' (trik_019) nunca saem na busca pública.
  const conditions: string[] = ['is_public = true', 'is_banned = false', "asset_type NOT IN ('staff', 'bulk')"]

  if (assetType) {
    params.push(assetType)
    conditions.push(`asset_type = $${params.length}`)
  }

  if (q && q.trim()) {
    params.push(q.trim())
    conditions.push(`search_vector @@ plainto_tsquery('french', $${params.length})`)
  }

  params.push(limit, offset)
  const { rows } = await db.query<AssetRow>(
    `SELECT * FROM community_assets
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return rows
}

// ── Bulk do próprio usuário (trik_019) ───────────────────────────────────────

export async function listOwnBulk(userId: string, limit = 200): Promise<AssetRow[]> {
  const { rows } = await db.query<AssetRow>(
    `SELECT * FROM community_assets
     WHERE creator_id = $1 AND asset_type = 'bulk' AND is_banned = false
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  )
  return rows
}

// ── Trocar o tipo (categoria) de um asset ────────────────────────────────────
// Quem pode é decidido na rota; aqui só aplica, mantendo is_public coerente.

export async function setAssetType(id: string, assetType: AssetType): Promise<AssetRow | null> {
  const { rows } = await db.query<AssetRow>(
    `UPDATE community_assets
        SET asset_type = $2, is_public = ($2 <> 'bulk')
      WHERE id = $1
      RETURNING *`,
    [id, assetType]
  )
  return rows[0] ?? null
}

// ── Delete an asset (only by creator) ────────────────────────────────────────

export async function deleteAsset(id: string, requesterId: string): Promise<boolean> {
  const { rows } = await db.query<AssetRow>(
    `DELETE FROM community_assets
     WHERE id = $1 AND creator_id = $2
     RETURNING file_path, thumbnail_path`,
    [id, requesterId]
  )
  if (!rows[0]) return false

  // Clean up files (ignore errors — files may already be gone)
  const { file_path, thumbnail_path } = rows[0]
  await fs.unlink(path.join(process.cwd(), 'uploads', file_path)).catch(() => {})
  if (thumbnail_path) {
    await fs.unlink(path.join(process.cwd(), 'uploads', thumbnail_path)).catch(() => {})
  }
  return true
}
