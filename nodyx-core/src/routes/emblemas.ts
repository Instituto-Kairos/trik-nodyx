/**
 * Emblemas — rotas admin (prefixo /api/v1/admin/emblemas, adminOnly).
 *
 * Emblema é um asset `badge` da biblioteca (community_assets) mostrado ao lado
 * do nome no perfil, via user_profiles.badge_asset_id. Antes qualquer membro
 * equipava o que quisesse pela página do asset; agora é presente do admin: o
 * PATCH /users/me não aceita mais badge_asset_id, só esta rota escreve nele.
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../config/database'
import { adminOnly, getInstanceCommunityId } from '../middleware/adminOnly'
import { validate } from '../middleware/validate'

const UserIdParams = z.object({
  userId: z.string().uuid(),
})

const GiveBody = z.object({
  // null tira o emblema do membro
  badge_asset_id: z.string().uuid().nullable(),
})

export default async function emblemasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', adminOnly)

  // Emblemas disponíveis + membros da comunidade com o emblema atual de cada um.
  app.get('/', async (_request, reply) => {
    const communityId = await getInstanceCommunityId()
    if (!communityId) return reply.send({ badges: [], members: [] })

    const [badges, members] = await Promise.all([
      db.query(
        `SELECT id, name, file_path, thumbnail_path
           FROM community_assets
          WHERE asset_type = 'badge' AND is_banned = false
          ORDER BY name ASC`,
      ),
      db.query(
        `SELECT u.id AS user_id, u.username, p.display_name, u.avatar,
                p.badge_asset_id
           FROM community_members cm
           JOIN users u ON u.id = cm.user_id
           LEFT JOIN user_profiles p ON p.user_id = u.id
          WHERE cm.community_id = $1 AND u.is_system = false
          ORDER BY lower(u.username) ASC`,
        [communityId],
      ),
    ])

    return reply.send({ badges: badges.rows, members: members.rows })
  })

  app.put('/:userId', {
    preHandler: validate({ params: UserIdParams, body: GiveBody }),
  }, async (request, reply) => {
    const { userId } = request.params as z.infer<typeof UserIdParams>
    const { badge_asset_id } = request.body as z.infer<typeof GiveBody>

    const communityId = await getInstanceCommunityId()
    const member = await db.query(
      `SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2`,
      [communityId, userId],
    )
    if (!member.rows[0]) {
      return reply.code(404).send({ error: 'Membro não encontrado', code: 'NOT_FOUND' })
    }

    if (badge_asset_id) {
      const asset = await db.query(
        `SELECT 1 FROM community_assets
          WHERE id = $1 AND asset_type = 'badge' AND is_banned = false`,
        [badge_asset_id],
      )
      if (!asset.rows[0]) {
        return reply.code(400).send({ error: 'Emblema inválido', code: 'INVALID_BADGE' })
      }
    }

    // O perfil pode ainda não existir (membro que nunca editou o perfil).
    await db.query(
      `INSERT INTO user_profiles (user_id, badge_asset_id) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET badge_asset_id = EXCLUDED.badge_asset_id, updated_at = NOW()`,
      [userId, badge_asset_id],
    )

    return reply.send({ ok: true })
  })
}
