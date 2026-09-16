import { db } from '../config/database'

// Un message légitime ne mentionne jamais des dizaines de personnes distinctes.
// Sans plafond, un seul message pouvait porter ~1000 mentions distinctes et
// déclencher, PAR mention, un fetchSockets + un INSERT + un COUNT + un SELECT
// + un Web Push : un compte membre ordinaire pouvait ainsi amplifier un seul
// message en dizaines de milliers de requêtes (trouvé en audit le 16/09).
const MAX_MENTIONS_PER_MESSAGE = 20

// Scan HTML content for @username mentions, return matching user IDs.
// `communityId` scope la résolution aux membres de CETTE communauté : un
// utilisateur exclu/banni ne doit pas pouvoir être notifié via une mention.
export async function resolveMentions(html: string, communityId: string): Promise<string[]> {
  const mentionRegex = /@([\w\-]{2,30})/g
  const usernames    = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = mentionRegex.exec(html)) !== null) {
    usernames.add(match[1].toLowerCase())
    if (usernames.size >= MAX_MENTIONS_PER_MESSAGE) break
  }

  if (usernames.size === 0) return []

  // Exclut les utilisateurs système (bots OctoGuard et autres) :
  // un user humain ne peut pas mentionner un bot pour le notifier.
  const { rows } = await db.query<{ id: string }>(
    `SELECT u.id FROM users u
     JOIN community_members cm ON cm.user_id = u.id
     WHERE LOWER(u.username) = ANY($1) AND u.is_system = false AND cm.community_id = $2`,
    [Array.from(usernames), communityId]
  )
  return rows.map(r => r.id)
}
