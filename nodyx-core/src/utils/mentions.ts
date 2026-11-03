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
// O username aceita qualquer coisa que não seja `)` nem quebra de linha —
// espaço inclusive, para usernames como "Nome Sobrenome" (o fechamento
// delimita), até 50 caracteres = o máximo de users.username. A busca em base
// é por igualdade exata e parametrizada, então a permissividade do regex não
// alarga superfície de ataque.
//
// ATENÇÃO: este formato é duplicado no cliente, em
// nodyx-frontend/src/lib/linkify.ts (bundles separados, sem módulo comum).
// Mudar um exige mudar o outro; os dois têm teste.
const ALIAS_MENTION_RE = /@\[[^\]\n]{1,100}\]\(([^)\n]{2,50})\)/g
const MENTION_RE       = /@([\w\-]{2,30})/g

// Scan HTML content for @username mentions, return matching user IDs.
// `communityId` scope la résolution aux membres de CETTE communauté : un
// utilisateur exclu/banni ne doit pas pouvoir être notifié via une mention.
export async function resolveMentions(html: string, communityId: string): Promise<string[]> {
  const usernames = new Set<string>()
  const characterImages = new Set<string>()
  let match: RegExpExecArray | null

  // Aliases primeiro: numa cena de RPG é a forma dominante, e o plafond deve
  // proteger o caminho mais usado em vez de sobrar para ele.
  ALIAS_MENTION_RE.lastIndex = 0
  while ((match = ALIAS_MENTION_RE.exec(html)) !== null) {
    // `@[Nome](npcc:<thread id>)` aponta um tópico de NPCC e
    // `@[Nome](npc:<image id>)` uma imagem do álbum NPC da galeria, não um
    // jogador : ninguém a notificar (cf GET /trik/npcc e /trik/npc).
    if (match[1].startsWith('npcc:') || match[1].startsWith('npc:')) continue
    // `@[Nome](pc:<image id>)`: post do personagem no álbum Personagens da
    // galeria. Notifica o jogador dono, resolvido abaixo pela imagem.
    if (match[1].startsWith('pc:')) {
      const id = match[1].slice(3)
      if (/^[0-9a-f-]{36}$/i.test(id)) characterImages.add(id)
      if (usernames.size + characterImages.size >= MAX_MENTIONS_PER_MESSAGE) break
      continue
    }
    usernames.add(match[1].toLowerCase())
    if (usernames.size >= MAX_MENTIONS_PER_MESSAGE) break
  }

  MENTION_RE.lastIndex = 0
  while (usernames.size + characterImages.size < MAX_MENTIONS_PER_MESSAGE && (match = MENTION_RE.exec(html)) !== null) {
    usernames.add(match[1].toLowerCase())
  }

  // pc:<image id> → jogador do personagem com o mesmo nome do título da imagem,
  // no universo do álbum (personagem do /registro ou do /registro-au).
  if (characterImages.size > 0) {
    const { rows } = await db.query<{ username: string }>(
      `SELECT DISTINCT u.username
         FROM galeria_images i
         JOIN galeria_albums a ON a.id = i.album_id
         JOIN (SELECT c.player_id AS user_id, c.name, false AS au FROM trik_characters c
               UNION ALL
               SELECT ac.user_id, ac.name, true AS au FROM trik_au_characters ac) ch
           ON LOWER(ch.name) = LOWER(i.title) AND ch.au = a.is_au
         JOIN users u ON u.id = ch.user_id
        WHERE i.id = ANY($1::uuid[])`,
      [Array.from(characterImages)],
    )
    for (const r of rows) usernames.add(r.username.toLowerCase())
  }

  if (usernames.size === 0) return []

  // Exclut les utilisateurs système (bots OctoGuard et autres) :
  // un user humain ne peut pas mentionner un bot pour le notifier.
  // Nome antigo (username_history) também resolve: quem trocou de nome
  // continua sendo notificado por quem ainda usa o @ de antes.
  const { rows } = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u
     JOIN community_members cm ON cm.user_id = u.id
     WHERE u.is_system = false AND cm.community_id = $2
       AND (LOWER(u.username) = ANY($1)
            OR u.id IN (SELECT h.user_id FROM username_history h WHERE LOWER(h.old_username) = ANY($1)))`,
    [Array.from(usernames), communityId]
  )
  return rows.map(r => r.id)
}
