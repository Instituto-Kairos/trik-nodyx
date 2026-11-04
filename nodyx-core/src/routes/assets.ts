import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/adminOnly'
import { rateLimit } from '../middleware/rateLimit'
import { validate } from '../middleware/validate'
import {
  uploadAsset,
  getAssetMeta,
  listUserAssets,
  searchAssets,
  deleteAsset,
  listOwnBulk,
  setAssetType,
  type AssetType,
} from '../services/assetService'
import { scanBuffer } from '../services/fileScanner'
import { db, redis } from '../config/database'

// trik_019: categorias da biblioteca + tipos internos (sound/video/font/theme).
const VALID_TYPES = ['ik', 'au', 'staff', 'emoji', 'badge', 'bulk', 'sound', 'video', 'font', 'theme'] as const
// Categorias de imagem entre as quais o tipo pode ser trocado (PATCH /:id/type).
const IMAGE_CATEGORIES = ['ik', 'au', 'staff', 'emoji', 'badge', 'bulk'] as const

// Per-user upload quota: 200 MB per 24h rolling window.
// Cible : empêcher les regular users de flood l'instance (avatars, stickers,
// post images). Les owner/admin de l'instance sont bypass : ils gèrent les
// médias (soundboard, overlays, branding), c'est leur disque.
const UPLOAD_QUOTA_BYTES   = 200 * 1024 * 1024 // 200 MB
const UPLOAD_QUOTA_WINDOW  = 86400              // 24h in seconds

async function checkUploadQuota(userId: string, fileSize: number): Promise<boolean> {
  const key   = `upload_quota:${userId}`
  const total = await redis.incrby(key, fileSize)
  if (total === fileSize) await redis.expire(key, UPLOAD_QUOTA_WINDOW) // first upload in window
  return total <= UPLOAD_QUOTA_BYTES
}

// Helper inline (évite un round-trip au middleware adminOnly qui valide aussi
// le JWT — déjà fait par requireAuth en amont). Hit DB uniquement, et on cache
// le communityId via le pattern utilisé dans middleware/adminOnly.
let _bypassCommunityId: string | null = null
async function isInstanceAdmin(userId: string): Promise<boolean> {
  if (!_bypassCommunityId) {
    const slug = process.env.NODYX_COMMUNITY_SLUG
    if (slug) {
      const r = await db.query<{ id: string }>(`SELECT id FROM communities WHERE slug = $1`, [slug])
      if (r.rows[0]) _bypassCommunityId = r.rows[0].id
    }
    if (!_bypassCommunityId) {
      const r = await db.query<{ id: string }>(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
      if (r.rows[0]) _bypassCommunityId = r.rows[0].id
    }
  }
  if (!_bypassCommunityId) return false
  const r = await db.query<{ role: string }>(
    `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
    [_bypassCommunityId, userId],
  )
  return !!r.rows[0] && (r.rows[0].role === 'owner' || r.rows[0].role === 'admin')
}

// Staff da instância (owner/admin/moderator): quem VÊ os assets 'staff' no
// seletor do editor. Enviar continua restrito a owner/admin (isInstanceAdmin).
async function isInstanceStaff(userId: string): Promise<boolean> {
  if (!_bypassCommunityId) await isInstanceAdmin(userId)   // resolve o communityId
  if (!_bypassCommunityId) return false
  const r = await db.query<{ role: string }>(
    `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
    [_bypassCommunityId, userId],
  )
  return ['owner', 'admin', 'moderator'].includes(r.rows[0]?.role ?? '')
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
const ALLOWED_MIME_BY_TYPE: Record<string, readonly string[]> = {
  ik:      IMAGE_MIMES,
  au:      IMAGE_MIMES,
  badge:   IMAGE_MIMES,
  emoji:   IMAGE_MIMES,
  bulk:    IMAGE_MIMES,
  staff:   IMAGE_MIMES,
  font:    [
    'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
    'application/font-woff', 'application/font-woff2',
    'application/x-font-ttf', 'application/x-font-opentype',
  ],
  sound:   ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/flac'],
  theme:   ['application/json', 'text/plain'],
  video:   ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska'],
}

const SearchQuery = z.object({
  q:      z.string().optional(),
  type:   z.enum(VALID_TYPES).optional(),
  limit:  z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

const RenameBody = z.object({
  name: z.string().trim().min(1).max(100),
})

const TypeBody = z.object({
  asset_type: z.enum(IMAGE_CATEGORIES),
})

export default async function assetRoutes(app: FastifyInstance) {

  // ── POST /api/v1/assets — Upload a new asset ───────────────────────────────
  app.post('/', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    const userId = req.user!.userId

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Aucun fichier fourni.' })

    const name        = (data.fields['name']        as { value?: string } | undefined)?.value?.trim()
    const description = (data.fields['description'] as { value?: string } | undefined)?.value?.trim()
    const assetType   = (data.fields['asset_type']  as { value?: string } | undefined)?.value?.trim() as AssetType | undefined
    const tagsRaw     = (data.fields['tags']        as { value?: string } | undefined)?.value
    // Raccourci texte personnalisé (emoji) : :shortcode: — optionnel, sinon dérivé du nom.
    const shortcodeRaw = (data.fields['shortcode']  as { value?: string } | undefined)?.value
    const shortcode    = shortcodeRaw ? shortcodeRaw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 50) : ''

    if (!name)      return reply.code(400).send({ error: 'Le champ "name" est requis.' })
    if (!assetType || !VALID_TYPES.includes(assetType)) {
      return reply.code(400).send({ error: `Type invalide. Valeurs possibles : ${VALID_TYPES.join(', ')}` })
    }

    // 'staff' (trik_016): só owner/admin envia; some dos assets públicos.
    if (assetType === 'staff' && !(await isInstanceAdmin(userId))) {
      return reply.code(403).send({ error: 'Seuls les admins peuvent envoyer des assets staff.' })
    }

    const allowedMimes = ALLOWED_MIME_BY_TYPE[assetType]
    if (!allowedMimes.includes(data.mimetype)) {
      return reply.code(400).send({ error: `Type MIME non autorisé pour "${assetType}". Types acceptés : ${allowedMimes.join(', ')}` })
    }

    const tags = tagsRaw
      ? tagsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0)
      : []

    const buffer = await data.toBuffer()

    // Quota community : skip pour les admin/owner (ils gèrent l'instance).
    const bypassQuota = await isInstanceAdmin(userId)
    if (!bypassQuota) {
      const withinQuota = await checkUploadQuota(userId, buffer.length)
      if (!withinQuota) {
        return reply.code(429).send({ error: 'Quota d\'upload dépassé (200 Mo / 24h).' })
      }
    }

    const scan = scanBuffer(buffer, data.mimetype)
    if (!scan.ok) {
      return reply.code(400).send({ error: `Fichier rejeté : ${scan.reason}` })
    }

    try {
      const asset = await uploadAsset({
        creatorId:        userId,
        buffer,
        originalFilename: data.filename,
        mimeType:         data.mimetype,
        assetType,
        name,
        description:      description || undefined,
        tags,
      })
      // Emoji : mémoriser le raccourci texte perso dans metadata (sinon dérivé du nom)
      if (assetType === 'emoji' && shortcode) {
        await db.query(
          `UPDATE community_assets SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('shortcode', $2::text) WHERE id = $1`,
          [asset.id, shortcode]
        ).catch(() => {})
        ;(asset as { metadata?: Record<string, unknown> }).metadata = { ...((asset as { metadata?: Record<string, unknown> }).metadata ?? {}), shortcode }
      }
      return reply.code(201).send({ asset })
    } catch (err: unknown) {
      app.log.error(err)
      return reply.code(500).send({ error: 'Erreur lors de l\'upload.' })
    }
  })

  // ── GET /api/v1/assets — Search public assets ──────────────────────────────
  app.get('/', {
    preHandler: [rateLimit, validate({ query: SearchQuery })],
  }, async (req, reply) => {
    const q = req.query as z.infer<typeof SearchQuery>
    const assets = await searchAssets({
      q:         q.q,
      assetType: q.type,
      limit:     q.limit,
      offset:    q.offset,
    })
    return reply.send({ assets })
  })

  // ── GET /api/v1/assets/staff — Assets 'staff' (trik_016) pro seletor ──────
  // Declarada ANTES de /:id. Só owner/admin/moderator; os demais recebem 403.
  app.get('/staff', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    if (!(await isInstanceStaff(req.user!.userId))) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }
    const { rows } = await db.query(
      `SELECT * FROM community_assets
       WHERE asset_type = 'staff' AND is_banned = false
       ORDER BY created_at DESC LIMIT 200`
    )
    return reply.send({ assets: rows })
  })

  // ── GET /api/v1/assets/mine/bulk — Bulk do próprio usuário (trik_019) ────
  // Declarada ANTES de /:id. O Bulk é privado: cada um vê só o seu; o owner vê
  // todos em /assets/admin/all.
  app.get('/mine/bulk', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    const assets = await listOwnBulk(req.user!.userId)
    return reply.send({ assets })
  })

  // ── GET /api/v1/assets/:id — Get asset metadata ────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', { preHandler: [rateLimit, optionalAuth] }, async (req, reply) => {
    const asset = await getAssetMeta(req.params.id)
    if (asset) return reply.send({ asset })

    // Bulk (privado) e staff: só o criador ou owner/admin abrem pela página.
    const userId = req.user?.userId
    if (userId) {
      const { rows } = await db.query<{ creator_id: string | null; asset_type: string }>(
        `SELECT * FROM community_assets WHERE id = $1 AND is_banned = false`,
        [req.params.id]
      )
      const row = rows[0]
      if (row && (row.creator_id === userId || await isInstanceAdmin(userId))) {
        return reply.send({ asset: row })
      }
    }
    return reply.code(404).send({ error: 'Asset introuvable.' })
  })

  // ── DELETE /api/v1/assets/:id — Delete own asset ───────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    const deleted = await deleteAsset(req.params.id, req.user!.userId)
    if (!deleted) return reply.code(404).send({ error: 'Asset introuvable ou non autorisé.' })
    return reply.send({ ok: true })
  })

  // ── GET /api/v1/assets/user/:userId — List a user's assets ────────────────
  app.get<{ Params: { userId: string } }>('/user/:userId', async (req, reply) => {
    const assets = await listUserAssets(req.params.userId)
    return reply.send({ assets })
  })

  // ── GET /api/v1/assets/admin/all — All assets incl. banned (admin) ─────────
  app.get('/admin/all', {
    preHandler: [adminOnly],
  }, async (req, reply) => {
    // ?type= filtra (ex.: o Bulk de todos, trik_019); tipo desconhecido = sem filtro.
    const type = (req.query as { type?: string }).type
    const filter = type && (VALID_TYPES as readonly string[]).includes(type) ? type : null
    const { rows } = await db.query(
      `SELECT a.*, u.username AS creator_username
       FROM community_assets a
       LEFT JOIN users u ON u.id = a.creator_id
       WHERE ($1::text IS NULL OR a.asset_type = $1)
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [filter]
    )
    return reply.send({ assets: rows })
  })

  // ── DELETE /api/v1/assets/:id/force — Admin force-delete any asset ─────────
  app.delete<{ Params: { id: string } }>('/:id/force', {
    preHandler: [adminOnly],
  }, async (req, reply) => {
    const { rows } = await db.query<{ file_path: string; thumbnail_path: string | null }>(
      `DELETE FROM community_assets WHERE id = $1 RETURNING file_path, thumbnail_path`,
      [req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Asset introuvable.' })
    const { file_path, thumbnail_path } = rows[0]
    const fs = await import('fs/promises')
    const path = await import('path')
    await fs.unlink(path.join(process.cwd(), 'uploads', file_path)).catch(() => {})
    if (thumbnail_path) await fs.unlink(path.join(process.cwd(), 'uploads', thumbnail_path)).catch(() => {})
    return reply.send({ ok: true })
  })

  // ── PATCH /api/v1/assets/:id/type — Trocar a categoria (trik_019) ──────────
  // O criador troca a dos próprios assets; owner/admin trocam qualquer um.
  // 'staff' continua só para owner/admin. Só entre categorias de imagem.
  app.patch<{ Params: { id: string } }>('/:id/type', {
    preHandler: [rateLimit, requireAuth, validate({ body: TypeBody })],
  }, async (req, reply) => {
    const userId = req.user!.userId
    const { asset_type } = req.body as z.infer<typeof TypeBody>

    const { rows } = await db.query<{ creator_id: string | null; asset_type: string; mime_type: string }>(
      `SELECT creator_id, asset_type, mime_type FROM community_assets WHERE id = $1`,
      [req.params.id]
    )
    const cur = rows[0]
    if (!cur) return reply.code(404).send({ error: 'Asset introuvable.' })

    const admin = await isInstanceAdmin(userId)
    if (cur.creator_id !== userId && !admin) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }
    if ((asset_type === 'staff' || cur.asset_type === 'staff') && !admin) {
      return reply.code(403).send({ error: 'Seuls les admins peuvent gérer les assets staff.' })
    }
    if (!(IMAGE_CATEGORIES as readonly string[]).includes(cur.asset_type) || !cur.mime_type.startsWith('image/')) {
      return reply.code(400).send({ error: 'Seules les images peuvent changer de catégorie.' })
    }

    const asset = await setAssetType(req.params.id, asset_type)
    return reply.send({ asset })
  })

  // ── PATCH /api/v1/assets/:id — Admin rename ────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', {
    preHandler: [adminOnly, validate({ body: RenameBody })],
  }, async (req, reply) => {
    const { name } = req.body as z.infer<typeof RenameBody>
    const { rows } = await db.query<{ name: string }>(
      `UPDATE community_assets SET name = $2 WHERE id = $1 RETURNING name`,
      [req.params.id, name]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Asset introuvable.' })
    return reply.send({ name: rows[0].name })
  })

  // ── PATCH /api/v1/assets/:id/ban — Admin toggle ban ────────────────────────
  app.patch<{ Params: { id: string } }>('/:id/ban', {
    preHandler: [adminOnly],
  }, async (req, reply) => {
    const { rows } = await db.query<{ is_banned: boolean }>(
      `UPDATE community_assets SET is_banned = NOT is_banned WHERE id = $1 RETURNING is_banned`,
      [req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Asset introuvable.' })
    return reply.send({ is_banned: rows[0].is_banned })
  })
}
