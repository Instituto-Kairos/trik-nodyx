/**
 * galeriaService — galeria de imagens interna da comunidade.
 *
 * Álbuns + imagens com título e descrição em rich text, no modelo do "forum
 * gallery" do Discord: miniatura grande, título curto, corpo formatado.
 *
 * Separado de assetService de propósito. Aquele guarda COSMÉTICOS (molduras,
 * emblemas, fontes, sons) que os perfis referenciam por FK — apagar uma foto de
 * cena não pode derrubar o perfil de ninguém. O pipeline de imagem, esse sim, é
 * o mesmo: sharp → WebP + miniatura, hash SHA-256, mesmas dimensões.
 */

import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { db } from '../config/database'

const UPLOADS_DIR   = path.join(process.cwd(), 'uploads', 'galeria')
const MAX_DIMENSION = 2048  // maior que os cosméticos: aqui a imagem é o conteúdo
const THUMB_SIZE    = 512   // o cartão da grade é grande, 256 ficava borrado

export const GALERIA_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export interface GaleriaAlbum {
  id: string
  community_id: string
  name: string
  slug: string
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  image_count?: number
  cover_thumb?: string | null
}

export interface GaleriaImage {
  id: string
  album_id: string | null
  community_id: string
  uploader_id: string | null
  title: string
  description: string | null   // HTML já sanitizado
  file_path: string
  thumbnail_path: string | null
  file_hash: string
  file_size: number
  mime_type: string
  width: number | null
  height: number | null
  tags: string[]
  created_at: string
  updated_at: string
  uploader_username?: string | null
  album_name?: string | null
}

export async function ensureGaleriaDir(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true })
}

/** "Cena da Taverna" → "cena-da-taverna". Colisão é resolvida por sufixo. */
export function slugify(nome: string): string {
  const base = nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
  return base || 'album'
}

// ── Álbuns ────────────────────────────────────────────────────────────────────

export async function listAlbums(communityId: string): Promise<GaleriaAlbum[]> {
  const { rows } = await db.query<GaleriaAlbum>(
    `SELECT a.*,
            (SELECT COUNT(*) FROM galeria_images i WHERE i.album_id = a.id)::int AS image_count,
            (SELECT i.thumbnail_path FROM galeria_images i
              WHERE i.album_id = a.id
              ORDER BY i.created_at DESC LIMIT 1) AS cover_thumb
       FROM galeria_albums a
      WHERE a.community_id = $1
      ORDER BY a.name ASC`,
    [communityId],
  )
  return rows
}

export async function createAlbum(opts: {
  communityId: string
  name: string
  description?: string | null
  createdBy: string
}): Promise<GaleriaAlbum> {
  // Slug único por comunidade: tenta o base, depois -2, -3… Sem laço infinito
  // (10 tentativas e desiste com um sufixo aleatório).
  const base = slugify(opts.name)
  let slug = base
  for (let i = 2; i <= 10; i++) {
    const { rows } = await db.query(
      `SELECT 1 FROM galeria_albums WHERE community_id = $1 AND slug = $2`,
      [opts.communityId, slug],
    )
    if (rows.length === 0) break
    slug = `${base}-${i}`
    if (i === 10) slug = `${base}-${crypto.randomBytes(3).toString('hex')}`
  }

  const { rows } = await db.query<GaleriaAlbum>(
    `INSERT INTO galeria_albums (community_id, name, slug, description, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [opts.communityId, opts.name, slug, opts.description ?? null, opts.createdBy],
  )
  return rows[0]
}

export async function deleteAlbum(communityId: string, id: string): Promise<boolean> {
  // As imagens NÃO vão junto (FK em SET NULL): apagar um álbum é reorganizar,
  // não destruir o que as pessoas subiram. Elas caem em "Sem álbum".
  const { rowCount } = await db.query(
    `DELETE FROM galeria_albums WHERE id = $1 AND community_id = $2`,
    [id, communityId],
  )
  return (rowCount ?? 0) > 0
}

// ── Imagens ───────────────────────────────────────────────────────────────────

export async function listImages(opts: {
  communityId: string
  albumId?: string | null
  semAlbum?: boolean
  q?: string
  tag?: string
  limit?: number
  offset?: number
}): Promise<{ images: GaleriaImage[]; total: number }> {
  const where: string[] = ['i.community_id = $1']
  const params: unknown[] = [opts.communityId]

  if (opts.semAlbum) {
    where.push('i.album_id IS NULL')
  } else if (opts.albumId) {
    params.push(opts.albumId)
    where.push(`i.album_id = $${params.length}`)
  }
  if (opts.q) {
    params.push(`%${opts.q}%`)
    where.push(`i.title ILIKE $${params.length}`)
  }
  if (opts.tag) {
    params.push(opts.tag)
    where.push(`$${params.length} = ANY(i.tags)`)
  }

  const limit  = Math.min(Math.max(1, opts.limit ?? 40), 100)
  const offset = Math.max(0, opts.offset ?? 0)
  const cond   = where.join(' AND ')

  const [lista, conta] = await Promise.all([
    db.query<GaleriaImage>(
      `SELECT i.*, u.username AS uploader_username, a.name AS album_name
         FROM galeria_images i
         LEFT JOIN users u          ON u.id = i.uploader_id
         LEFT JOIN galeria_albums a ON a.id = i.album_id
        WHERE ${cond}
        ORDER BY i.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM galeria_images i WHERE ${cond}`, params),
  ])

  return { images: lista.rows, total: parseInt(conta.rows[0]?.n ?? '0', 10) }
}

export async function getImage(communityId: string, id: string): Promise<GaleriaImage | null> {
  const { rows } = await db.query<GaleriaImage>(
    `SELECT i.*, u.username AS uploader_username, a.name AS album_name
       FROM galeria_images i
       LEFT JOIN users u          ON u.id = i.uploader_id
       LEFT JOIN galeria_albums a ON a.id = i.album_id
      WHERE i.id = $1 AND i.community_id = $2`,
    [id, communityId],
  )
  return rows[0] ?? null
}

export async function uploadImage(opts: {
  communityId: string
  uploaderId: string
  buffer: Buffer
  mimeType: string
  title: string
  description?: string | null   // HTML JÁ sanitizado pelo chamador
  albumId?: string | null
  tags?: string[]
}): Promise<GaleriaImage> {
  await ensureGaleriaDir()

  const hash = crypto.createHash('sha256').update(opts.buffer).digest('hex')
  const animada = opts.mimeType === 'image/gif' || opts.mimeType === 'image/webp'

  const principal = await sharp(opts.buffer, { animated: animada })
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer()

  // `fit: 'inside'` na miniatura, não 'cover': recortar um retrato de
  // personagem no quadrado costuma decapitá-lo.
  const mini = await sharp(opts.buffer)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()

  const meta = await sharp(principal).metadata().catch(() => ({ width: null, height: null }))

  const filePath  = `galeria/${hash}.webp`
  const thumbPath = `galeria/${hash}_thumb.webp`
  await fs.writeFile(path.join(process.cwd(), 'uploads', filePath), principal)
  await fs.writeFile(path.join(process.cwd(), 'uploads', thumbPath), mini)

  const { rows } = await db.query<GaleriaImage>(
    `INSERT INTO galeria_images
       (album_id, community_id, uploader_id, title, description,
        file_path, thumbnail_path, file_hash, file_size, mime_type, width, height, tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      opts.albumId ?? null, opts.communityId, opts.uploaderId, opts.title,
      opts.description ?? null,
      filePath, thumbPath, hash, principal.length, 'image/webp',
      meta.width ?? null, meta.height ?? null, opts.tags ?? [],
    ],
  )
  return rows[0]
}

export async function updateImage(opts: {
  communityId: string
  id: string
  title?: string
  description?: string | null   // HTML JÁ sanitizado
  albumId?: string | null
  tags?: string[]
}): Promise<GaleriaImage | null> {
  const sets: string[] = []
  const params: unknown[] = []
  const põe = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`) }

  if (opts.title       !== undefined) põe('title', opts.title)
  if (opts.description !== undefined) põe('description', opts.description)
  if (opts.albumId     !== undefined) põe('album_id', opts.albumId)
  if (opts.tags        !== undefined) põe('tags', opts.tags)
  if (sets.length === 0) return getImage(opts.communityId, opts.id)

  params.push(opts.id, opts.communityId)
  const { rows } = await db.query<GaleriaImage>(
    `UPDATE galeria_images SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length - 1} AND community_id = $${params.length}
      RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

/** Apaga o registro e os dois arquivos. Devolve o uploader, para o controle de autoria. */
export async function deleteImage(communityId: string, id: string): Promise<{ uploader_id: string | null } | null> {
  const { rows } = await db.query<{ file_path: string; thumbnail_path: string | null; uploader_id: string | null }>(
    `DELETE FROM galeria_images WHERE id = $1 AND community_id = $2
     RETURNING file_path, thumbnail_path, uploader_id`,
    [id, communityId],
  )
  if (!rows[0]) return null

  // Arquivo órfão é lixo, mas não é erro: se o unlink falhar, a linha já se foi
  // e a galeria não pode travar por causa disso.
  const raiz = path.join(process.cwd(), 'uploads')
  await fs.unlink(path.join(raiz, rows[0].file_path)).catch(() => {})
  if (rows[0].thumbnail_path) {
    await fs.unlink(path.join(raiz, rows[0].thumbnail_path)).catch(() => {})
  }
  return { uploader_id: rows[0].uploader_id }
}

// ── Anotações ─────────────────────────────────────────────────────────────────
// A linha do tempo da página de uma imagem (galeria_002_notes.sql). Quem pode
// escrever é decidido na rota; aqui só se lê e grava.

export interface GaleriaNote {
  id: string
  image_id: string
  community_id: string
  author_id: string | null
  content: string   // HTML já sanitizado
  created_at: string
  updated_at: string
  author_username?: string | null
  author_avatar?: string | null
}

const NOTE_SELECT =
  `SELECT n.*, u.username AS author_username, u.avatar AS author_avatar
     FROM galeria_notes n
     LEFT JOIN users u ON u.id = n.author_id`

/** Em ordem cronológica: a linha do tempo se lê de cima para baixo. */
export async function listNotes(communityId: string, imageId: string): Promise<GaleriaNote[]> {
  const { rows } = await db.query<GaleriaNote>(
    `${NOTE_SELECT}
      WHERE n.image_id = $1 AND n.community_id = $2
      ORDER BY n.created_at ASC`,
    [imageId, communityId],
  )
  return rows
}

export async function getNote(communityId: string, id: string): Promise<GaleriaNote | null> {
  const { rows } = await db.query<GaleriaNote>(
    `${NOTE_SELECT} WHERE n.id = $1 AND n.community_id = $2`,
    [id, communityId],
  )
  return rows[0] ?? null
}

export async function createNote(opts: {
  communityId: string
  imageId: string
  authorId: string
  content: string   // HTML JÁ sanitizado
}): Promise<GaleriaNote> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO galeria_notes (image_id, community_id, author_id, content)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [opts.imageId, opts.communityId, opts.authorId, opts.content],
  )
  return (await getNote(opts.communityId, rows[0].id))!
}

export async function updateNote(communityId: string, id: string, content: string): Promise<GaleriaNote | null> {
  const { rowCount } = await db.query(
    `UPDATE galeria_notes SET content = $1, updated_at = NOW()
      WHERE id = $2 AND community_id = $3`,
    [content, id, communityId],
  )
  return rowCount ? getNote(communityId, id) : null
}

export async function deleteNote(communityId: string, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM galeria_notes WHERE id = $1 AND community_id = $2`,
    [id, communityId],
  )
  return (rowCount ?? 0) > 0
}
