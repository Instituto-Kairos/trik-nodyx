import { db } from '../config/database'

// Un message légitime ne mentionne jamais des dizaines de personnes distinctes.
// Sans plafond, un seul message pouvait porter ~1000 mentions distinctes et
// déclencher, PAR mention, un fetchSockets + un INSERT + un COUNT + un SELECT
// + un Web Push : un compte membre ordinaire pouvait ainsi amplifier un seul
// message en dizaines de milliers de requêtes (trouvé en audit le 16/09).
const MAX_MENTIONS_PER_MESSAGE = 20

// Alias de personagem (módulo trik): `@[Nome do Personagem](username)`.
// O nome visível é só um rótulo — o alvo notificado é SEMPRE o username entre
// parênteses, porque um alias é um apelido DO JOGADOR, não uma entidade
// mencionável à parte. Quem escolheu no autocomplete já validou o par
// "personagem · jogador", então não há nada a desambiguar aqui.
//
// Aditivo de propósito: `@username` continua valendo exatamente como antes, e
// as duas formas não se pisam — em `@[Kaelen](rafael)` o caractere após o `@`
// é `[`, que não é `\w`, então MENTION_RE não casa nada ali.
//
// O username aceita qualquer coisa que não seja `)` nem espaço (o fechamento
// delimita), até 50 caracteres = o máximo de users.username. A busca em base
// é por igualdade exata e parametrizada, então a permissividade do regex não
// alarga superfície de ataque.
//
// ATENÇÃO: este formato é duplicado no cliente, em
// nodyx-frontend/src/lib/linkify.ts (bundles separados, sem módulo comum).
// Mudar um exige mudar o outro; os dois têm teste.
const ALIAS_MENTION_RE = /@\[[^\]\n]{1,100}\]\(([^)\s\n]{2,50})\)/g
const MENTION_RE       = /@([\w\-]{2,30})/g

// Scan HTML content for @username mentions, return matching user IDs.
// `communityId` scope la résolution aux membres de CETTE communauté : un
// utilisateur exclu/banni ne doit pas pouvoir être notifié via une mention.
export async function resolveMentions(html: string, communityId: string): Promise<string[]> {
  const usernames = new Set<string>()
  let match: RegExpExecArray | null

  // Aliases primeiro: numa cena de RPG é a forma dominante, e o plafond deve
  // proteger o caminho mais usado em vez de sobrar para ele.
  ALIAS_MENTION_RE.lastIndex = 0
  while ((match = ALIAS_MENTION_RE.exec(html)) !== null) {
    usernames.add(match[1].toLowerCase())
    if (usernames.size >= MAX_MENTIONS_PER_MESSAGE) break
  }

  MENTION_RE.lastIndex = 0
  while (usernames.size < MAX_MENTIONS_PER_MESSAGE && (match = MENTION_RE.exec(html)) !== null) {
    usernames.add(match[1].toLowerCase())
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
