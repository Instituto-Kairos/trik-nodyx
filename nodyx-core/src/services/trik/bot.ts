/**
 * Módulo RPG (trik) — usuário fantasma "Trik" e postagem de mensagens de
 * confirmação no canal após /registro e /plaquinha.
 *
 * Mesmo padrão de services/octoguard/welcome.ts (ensureOctoGuardBotUser)
 * pro usuário fantasma, e de services/streamer/streamerChat.ts
 * (ChannelModel.addMessage + io.emit('chat:message', ...)) pra postar e
 * emitir ao vivo — sem isso a mensagem só apareceria depois de um reload.
 */

import { randomBytes } from 'crypto'
import bcrypt from 'bcrypt'
import { db } from '../../config/database'
import * as ChannelModel from '../../models/channel'
import * as ReactionModel from '../../models/reaction'
import { io } from '../../socket/io'
import { sanitize } from '../../utils/sanitize'
import { resolveMentions } from '../../utils/mentions'
import { sendPushToUser } from '../../routes/notifications'
import { resolveServerLocale, pushStrings } from '../../i18n/serverStrings'

const BOT_USERNAME = 'Trik'
const BOT_EMAIL    = 'trik@nodyx.local'

let _botUserId: string | null = null

/** Garante a existência do usuário fantasma Trik. Idempotente. */
export async function ensureTrikBotUser(): Promise<string | null> {
  if (_botUserId) return _botUserId
  try {
    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE is_system = true AND username = $1 LIMIT 1`,
      [BOT_USERNAME]
    )
    if (existing[0]) {
      _botUserId = existing[0].id
      return _botUserId
    }

    const randomPwd     = randomBytes(32).toString('hex')
    const passwordHash  = await bcrypt.hash(randomPwd, 10)

    // DO NOTHING (e não "DO UPDATE SET is_system = true"): se um membro de
    // verdade já usa o username "Trik", promovê-lo a bot de sistema o tornaria
    // invisível/impessoal e faria o bot falar em nome dele. Sem linha = conflito.
    const { rows: created } = await db.query<{ id: string }>(
      `INSERT INTO users (username, email, password, email_verified, is_system, bio, avatar)
       VALUES ($1, $2, $3, true, true, $4, NULL)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [BOT_USERNAME, BOT_EMAIL, passwordHash, 'Bot do módulo RPG. Confirma /registro e /plaquinha no canal.']
    )
    if (!created[0]) {
      console.warn(`[trik:bot] o username "${BOT_USERNAME}" já é de uma conta que não é do sistema — bot não criado (renomeie a conta)`)
      return null
    }
    _botUserId = created[0].id

    const community = await db.query<{ id: string }>(
      `SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`
    )
    if (community.rows[0]) {
      await db.query(
        `INSERT INTO community_members (community_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT DO NOTHING`,
        [community.rows[0].id, _botUserId]
      )
    }

    return _botUserId
  } catch (err) {
    console.warn('[trik:bot] ensureTrikBotUser error:', err)
    return null
  }
}

export interface TrikBotProfile {
  username:  string
  avatarUrl: string | null
  bio:       string | null
}

/** Lê o perfil atual (avatar/bio) do bot Trik — pra tela de admin. */
export async function getTrikBotProfile(): Promise<TrikBotProfile | null> {
  const botId = await ensureTrikBotUser()
  if (!botId) return null
  const { rows } = await db.query<{ username: string; avatar_url: string | null; bio: string | null }>(
    `SELECT u.username, p.avatar_url, p.bio
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE u.id = $1`,
    [botId]
  )
  if (!rows[0]) return null
  return { username: rows[0].username, avatarUrl: rows[0].avatar_url, bio: rows[0].bio }
}

/**
 * Atualiza avatar/bio do bot Trik. Sincroniza users.avatar com
 * user_profiles.avatar_url — mesmo padrão de PUT /users/me/profile
 * (routes/users.ts), porque o chat/fórum leem users.avatar diretamente e o
 * MiniProfileCard/página de perfil leem user_profiles.avatar_url.
 */
export async function updateTrikBotProfile(patch: { bio?: string | null; avatarUrl?: string | null }): Promise<TrikBotProfile | null> {
  const botId = await ensureTrikBotUser()
  if (!botId) return null

  const fields: string[] = []
  const values: unknown[] = []
  let i = 1
  if (patch.bio       !== undefined) { fields.push(`bio = $${i++}`);        values.push(patch.bio) }
  if (patch.avatarUrl !== undefined) { fields.push(`avatar_url = $${i++}`); values.push(patch.avatarUrl) }

  if (fields.length > 0) {
    values.push(botId)
    await db.query(`UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = $${i}`, values)
  }
  if (patch.avatarUrl !== undefined) {
    await db.query(`UPDATE users SET avatar = $1 WHERE id = $2`, [patch.avatarUrl, botId])
  }

  return getTrikBotProfile()
}

/**
 * Posta uma mensagem do bot Trik no canal e emite ao vivo pros clientes
 * conectados — nunca lança: chamado depois de um save bem-sucedido, um
 * erro aqui não deve derrubar a resposta HTTP do /registro ou /plaquinha.
 *
 * `content` pode embutir campos digitados pelo jogador (nome do personagem,
 * nome da plaquinha) — passa por sanitize() antes de gravar, mesma função
 * usada pelo socket chat:send pra mensagens normais, pra não abrir XSS via
 * um nome de personagem malicioso.
 *
 * Notificação de @menção: postar via ChannelModel.addMessage() direto (em
 * vez do handler chat:send) pula o trecho que resolve @menções e cria a
 * notificação — mesma limitação que o bot de welcome do OctoGuard já tem.
 * Replica esse trecho aqui (resolveMentions + sinal de chat + push), senão
 * @fulano no texto do bot nunca notifica ninguém de verdade.
 */
export async function postTrikMessage(channelId: string, content: string): Promise<void> {
  try {
    const botId = await ensureTrikBotUser()
    if (!botId) return
    const safeContent = sanitize(content)
    const message = await ChannelModel.addMessage({ channel_id: channelId, author_id: botId, content: safeContent })
    io?.to(`channel:${channelId}`).emit('chat:message', message)

    // resolveMentions é escopado à comunidade (fix de segurança do upstream:
    // usuário banido/excluído não pode ser notificado por menção) — então
    // precisa do community_id do canal.
    const channel = await ChannelModel.findById(channelId).catch(() => null)
    const mentionedIds = channel
      ? await resolveMentions(safeContent, channel.community_id).catch(() => [])
      : []
    for (const notifiedUserId of mentionedIds) {
      // Já olhando o canal (aba ativa) → recebe a mensagem ao vivo, não
      // precisa de sino/push. Mesmo critério do chat:send normal.
      if (io) {
        const userSockets = await io.in(`user:${notifiedUserId}`).fetchSockets().catch(() => [])
        if (userSockets.some(s => s.data.activeChannel === channelId)) continue
      }
      // Sinal no ÍCONE DE CHAT, não no sininho: desde 24/09 o sininho
      // (/notifications) carrega só assunto de fórum, que é o que tem um
      // destino exato para o botão "Ver". Mesma regra do chat:send.
      if (io) {
        io.to(`user:${notifiedUserId}`).emit('chat:mention')
      }
      const { rows: localeRows } = await db.query<{ locale: string | null }>(
        `SELECT locale FROM users WHERE id = $1`, [notifiedUserId]
      ).catch(() => ({ rows: [] }))
      const pushLocale = resolveServerLocale(localeRows[0]?.locale, process.env.NODYX_COMMUNITY_LANGUAGE)
      sendPushToUser(notifiedUserId, {
        title: pushStrings(pushLocale).mentionTitle(BOT_USERNAME),
        body:  safeContent.replace(/<[^>]*>/g, '').slice(0, 80),
        type:  'mention',
        tag:   'chat-mention',
        url:   '/chat',
      }).catch(() => {})
    }
  } catch (err) {
    console.warn('[trik:bot] postTrikMessage error:', err)
  }
}

// Marcas do bot Trik num post de cena: ✅ = contou xp, ❌ = estava num
// tópico XP-elegível mas não gerou xp (sem estrutura, sem /registro,
// personagem não identificado, abaixo do mínimo). Reação em vez de resposta
// no tópico — não polui a conversa com um post do bot a cada cena recusada.
// Trocar um emoji aqui exige migration pras reações já gravadas
// (ver migrations/trik_008_scene_marks.sql).
const SCENE_COUNTED_EMOJI  = '✅'
const SCENE_REJECTED_EMOJI = '❌'

async function reactAsTrik(postId: string, emoji: string): Promise<void> {
  try {
    const botId = await ensureTrikBotUser()
    if (!botId) return
    await ReactionModel.addReaction(postId, botId, emoji)
  } catch (err) {
    console.warn('[trik:bot] reactAsTrik error:', err)
  }
}

/** Marca que uma cena contou xp — reversível (ver clearSceneMarks). */
export async function reactSceneCounted(postId: string): Promise<void> {
  await reactAsTrik(postId, SCENE_COUNTED_EMOJI)
}

/** Marca que uma cena num tópico XP-elegível foi recusada (não gerou xp). */
export async function reactSceneRejected(postId: string): Promise<void> {
  await reactAsTrik(postId, SCENE_REJECTED_EMOJI)
}

/** Tira as duas marcas do bot — chamado por revertScenePost (edição/remoção
 *  do post), pra não deixar um ✅ num post que não conta mais nem um ❌ num
 *  post que, editado, passou a contar. */
export async function clearSceneMarks(postId: string): Promise<void> {
  try {
    const botId = await ensureTrikBotUser()
    if (!botId) return
    await ReactionModel.removeReaction(postId, botId, SCENE_COUNTED_EMOJI)
    await ReactionModel.removeReaction(postId, botId, SCENE_REJECTED_EMOJI)
  } catch (err) {
    console.warn('[trik:bot] clearSceneMarks error:', err)
  }
}
