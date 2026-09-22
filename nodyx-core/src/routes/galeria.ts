/**
 * Galeria — rotas da galeria de imagens interna (prefixo /api/v1/galeria).
 *
 * Álbuns + imagens com título e descrição em rich text, no modelo do "forum
 * gallery" do Discord. Interna por desenho: tudo exige `requireAuth`, e o
 * escopo é a comunidade da instância.
 *
 * Não confundir com o módulo `gallery` de config/modules.ts, que é uma galeria
 * PÚBLICA de vitrine (family 'website') e continua não implementada. Este é o
 * módulo `galeria`, family 'community'.
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../config/database'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import { requireModule } from '../middleware/requireModule'
import { validate } from '../middleware/validate'
import { sanitize } from '../utils/sanitize'
import { checkHtmlContent } from '../services/contentFilter'
import { scanBuffer } from '../services/fileScanner'
import * as Galeria from '../services/galeriaService'

// ── Comunidade da instância (mesmo padrão de routes/trik.ts e admin.ts) ───────

let _communityId: string | null = null

async function getCommunityId(): Promise<string | null> {
  if (_communityId) return _communityId
  const slug = process.env.NODYX_COMMUNITY_SLUG
  if (slug) {
    const { rows } = await db.query(`SELECT id FROM communities WHERE slug = $1`, [slug])
    if (rows[0]) { _communityId = rows[0].id; return _communityId }
  }
  const { rows } = await db.query(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  _communityId = rows[0]?.id ?? null
  return _communityId
}

const MAX_BYTES = 12 * 1024 * 1024  // 12 MB por imagem, antes do reencode

const AlbumBody = z.object({
  name:        z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
})

const PatchImageBody = z.object({
  title:       z.string().trim().min(1).max(160).optional(),
  description: z.string().max(20000).optional().nullable(),
  album_id:    z.string().uuid().optional().nullable(),
  tags:        z.array(z.string().trim().min(1).max(30)).max(12).optional(),
})

/**
 * A descrição vem do NodyxEditor, então é HTML e passa pelo MESMO sanitize do
 * fórum — não uma lista de tags própria, que divergiria com o tempo. Depois, o
 * filtro de conteúdo (símbolos de ódio / padrões do admin), como em toda
 * superfície de texto livre do produto.
 */
function limparDescricao(bruta: string | null | undefined): { ok: true; html: string | null } | { ok: false; motivo: string } {
  if (bruta === null || bruta === undefined) return { ok: true, html: null }
  const limpa = sanitize(bruta).trim()
  if (!limpa) return { ok: true, html: null }
  const check = checkHtmlContent(limpa)
  if (!check.ok) return { ok: false, motivo: check.reason ?? 'Conteúdo recusado.' }
  return { ok: true, html: limpa }
}

export default async function galeriaRoutes(app: FastifyInstance) {
  // Módulo desligado → 503 em tudo, inclusive na leitura.
  app.addHook('preHandler', requireModule('galeria'))

  // ── Álbuns ─────────────────────────────────────────────────────────────────

  app.get('/albums', { preHandler: [rateLimit, requireAuth] }, async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    return reply.send({ albums: await Galeria.listAlbums(communityId) })
  })

  app.post('/albums', {
    preHandler: [rateLimit, requireAuth, validate({ body: AlbumBody })],
  }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const body = request.body as z.infer<typeof AlbumBody>

    const nomeCheck = checkHtmlContent(body.name)
    if (!nomeCheck.ok) return reply.code(422).send({ error: nomeCheck.reason, code: 'CONTENT_BLOCKED' })

    const album = await Galeria.createAlbum({
      communityId,
      name: body.name,
      description: body.description ?? null,
      createdBy: request.user!.userId,
    })
    return reply.code(201).send({ album })
  })

  app.delete('/albums/:id', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const { id } = request.params as { id: string }

    if (!(await podeModerar(request.user!.userId))) {
      return reply.code(403).send({ error: 'Admin required', code: 'FORBIDDEN' })
    }
    const ok = await Galeria.deleteAlbum(communityId, id)
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'Álbum não encontrado.' })
  })

  // ── Imagens ────────────────────────────────────────────────────────────────

  app.get('/images', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const q = request.query as Record<string, string | undefined>
    const resultado = await Galeria.listImages({
      communityId,
      albumId:  q.album && /^[0-9a-f-]{36}$/i.test(q.album) ? q.album : null,
      semAlbum: q.album === 'none',
      q:        q.q?.trim().slice(0, 100) || undefined,
      tag:      q.tag?.trim().slice(0, 30) || undefined,
      limit:    Number(q.limit) || 40,
      offset:   Number(q.offset) || 0,
    })
    return reply.send(resultado)
  })

  app.get('/images/:id', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const { id } = request.params as { id: string }
    const image = await Galeria.getImage(communityId, id)
    return image ? reply.send({ image }) : reply.code(404).send({ error: 'Imagem não encontrada.' })
  })

  // Upload multipart: arquivo + campos title/description/album_id/tags.
  app.post('/images', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const data = await (request as unknown as { file: () => Promise<any> }).file()
    if (!data) return reply.code(400).send({ error: 'Nenhum arquivo enviado.' })

    if (!(Galeria.GALERIA_MIMES as readonly string[]).includes(data.mimetype)) {
      return reply.code(400).send({
        error: `Tipo não aceito. Aceitos: ${Galeria.GALERIA_MIMES.join(', ')}`,
      })
    }

    const campo = (n: string) => (data.fields?.[n] as { value?: string } | undefined)?.value?.trim()
    const title = campo('title')
    if (!title) return reply.code(400).send({ error: 'O título é obrigatório.' })
    if (title.length > 160) return reply.code(400).send({ error: 'Título longo demais (máx. 160).' })

    const tituloCheck = checkHtmlContent(title)
    if (!tituloCheck.ok) return reply.code(422).send({ error: tituloCheck.reason, code: 'CONTENT_BLOCKED' })

    const desc = limparDescricao(campo('description'))
    if (!desc.ok) return reply.code(422).send({ error: desc.motivo, code: 'CONTENT_BLOCKED' })

    const buffer = await data.toBuffer()
    if (buffer.length > MAX_BYTES) {
      return reply.code(413).send({ error: 'Imagem maior que 12 MB.' })
    }

    // Mesma varredura dos outros uploads: o MIME declarado não é prova de nada.
    const scan = scanBuffer(buffer, data.mimetype)
    if (!scan.ok) return reply.code(400).send({ error: `Arquivo recusado: ${scan.reason}` })

    const albumId = campo('album_id')
    const tags = (campo('tags') ?? '')
      .split(',').map(t => t.trim()).filter(Boolean).slice(0, 12)

    try {
      const image = await Galeria.uploadImage({
        communityId,
        uploaderId:  request.user!.userId,
        buffer,
        mimeType:    data.mimetype,
        title,
        description: desc.html,
        albumId:     albumId && /^[0-9a-f-]{36}$/i.test(albumId) ? albumId : null,
        tags,
      })
      return reply.code(201).send({ image })
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: 'Falha ao processar a imagem.' })
    }
  })

  app.patch('/images/:id', {
    preHandler: [rateLimit, requireAuth, validate({ body: PatchImageBody })],
  }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const { id } = request.params as { id: string }
    const body = request.body as z.infer<typeof PatchImageBody>

    const atual = await Galeria.getImage(communityId, id)
    if (!atual) return reply.code(404).send({ error: 'Imagem não encontrada.' })
    if (!(await podeEditar(request.user!.userId, atual.uploader_id))) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    if (body.title !== undefined) {
      const c = checkHtmlContent(body.title)
      if (!c.ok) return reply.code(422).send({ error: c.reason, code: 'CONTENT_BLOCKED' })
    }

    let descricao: string | null | undefined
    if (body.description !== undefined) {
      const d = limparDescricao(body.description)
      if (!d.ok) return reply.code(422).send({ error: d.motivo, code: 'CONTENT_BLOCKED' })
      descricao = d.html
    }

    const image = await Galeria.updateImage({
      communityId, id,
      title:       body.title,
      description: descricao,
      albumId:     body.album_id,
      tags:        body.tags,
    })
    return reply.send({ image })
  })

  app.delete('/images/:id', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const { id } = request.params as { id: string }

    const atual = await Galeria.getImage(communityId, id)
    if (!atual) return reply.code(404).send({ error: 'Imagem não encontrada.' })
    if (!(await podeEditar(request.user!.userId, atual.uploader_id))) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    await Galeria.deleteImage(communityId, id)
    return reply.code(204).send()
  })
}

// ── Autoria ───────────────────────────────────────────────────────────────────
// Quem subiu pode editar e apagar a sua imagem; admin/owner pode tudo. Álbuns,
// por serem estrutura compartilhada, só admin/owner apaga.

async function podeModerar(userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM community_members WHERE user_id = $1 AND role IN ('admin','owner') LIMIT 1`,
    [userId],
  )
  return rows.length > 0
}

async function podeEditar(userId: string, uploaderId: string | null): Promise<boolean> {
  if (uploaderId && uploaderId === userId) return true
  return podeModerar(userId)
}
