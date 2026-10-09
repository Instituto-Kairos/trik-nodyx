/**
 * Módulo RPG (trik) — Fase 2, Fluxo 1: orquestra parse → match → cálculo →
 * gravação de XP por post de cena, e o aviso de level up no chat.
 * Ver plans/fase-dois.md ("Fluxo 1"/"Fluxo 2") e
 * plans/fase-dois-passo-a-passo.md, passos 3–5.
 *
 * Convenção da Fase 1 mantida: nunca lança — o chamador (routes/forums.ts)
 * não pode ter a resposta de criar/editar um post derrubada por um erro no
 * RPG. Qualquer falha interna vira log + resultado "not awarded".
 */

import { parseScenePost, parseFooterTags, stripTags, hasLoreTag } from './sceneParser'
import { matchCharacterByHeader } from './matcher'
import {
  calculateSceneXp, calculateTrainingSceneXp, calculateMasteryUnits, remainingDailyMastery,
  calculateNarratorXp,
} from './calc'
import {
  getPlayer, isXpThread, applySceneAward, revertSceneAward, listAwardedPostIdsByThread,
  getChannelPurposes, getOrCreateProgress, setSceneRejection, clearSceneRejection,
} from '../../../models/trik'
import {
  findCatalogByName, getMasteryUsedToday, type CatalogEntry, type MasteryKind,
} from '../../../models/trikMastery'
import {
  getNarratorUserId, applyNarratorAward, revertNarratorAward, listNarratorAwardedPostIdsByThread,
} from '../../../models/trikNarrador'
import { postTrikMessage, reactSceneCounted, reactSceneRejected, clearSceneMarks } from '../bot'
import { botSafe } from '../text'

export type SceneRejectionReason = 'no_structure' | 'no_player' | 'no_match' | 'below_minimum'

/** Crédito de maestria de uma cena #treino/#aula (só presente quando a cena
 *  teve tag válida — ver planTraining). */
export interface SceneMasteryResult {
  kind:      MasteryKind
  name:      string
  units:     number
  level:     number
  leveledUp: boolean
}

export type SceneXpResult =
  // already_awarded: o post já tinha prêmio (edições concorrentes) — nada foi creditado de novo.
  | { awarded: false; reason: 'not_xp_thread' | SceneRejectionReason | 'already_awarded' | 'error' }
  | { awarded: true; characterId: string; xp: number; leveledUp: boolean; mastery?: SceneMasteryResult }
  // Cena de narrador (#lore): o xp foi pro pool do narrador, não pra um personagem.
  | { awarded: true; narrator: true; xp: number }

async function getAnnounceChannel(): Promise<string | null> {
  const purposes = await getChannelPurposes()
  return purposes.find(p => p.purpose === 'anuncio')?.channel_id ?? null
}

/** Marca com ❌ (reação do bot Trik no próprio post) quando um post num
 *  tópico XP-elegível não gera xp — mas só pelos motivos "isso deveria ter
 *  funcionado e não funcionou" (nunca pra 'not_xp_thread', que é o caso
 *  normal da maioria das respostas de um fórum). O motivo fica gravado pro
 *  frontend mostrar ao clicar no ❌. */
async function notifySceneRejected(postId: string, reason: SceneRejectionReason): Promise<void> {
  await setSceneRejection(postId, reason)
  await reactSceneRejected(postId)
}

export async function notifyLevelUp(characterId: string, characterName: string): Promise<void> {
  const announceChannel = await getAnnounceChannel()
  if (!announceChannel) return // nenhum canal configurado — não é erro, só não avisa
  await postTrikMessage(announceChannel, `🎉 <strong>${botSafe(characterName)}</strong> subiu de nível!`)

  // Decisão assumida (ver fase-dois-passo-a-passo.md, passo 0): aviso de
  // "pontos disponíveis" reusa o mesmo canal de anúncio.
  const progress = await getOrCreateProgress(characterId)
  const hasAvailablePoints =
    progress.points_conduct     > progress.spent_conduct ||
    progress.points_principles  > progress.spent_principles ||
    progress.points_preferences > progress.spent_preferences
  if (hasAvailablePoints) {
    await postTrikMessage(
      announceChannel,
      `✨ <strong>${botSafe(characterName)}</strong> tem pontos disponíveis pra distribuir — use /levelup.`
    )
  }
}

interface TrainingPlan {
  kind:  MasteryKind
  entry: CatalogEntry
  /** xp de personagem da cena, já com a redução de cena de treino. */
  xp:    number
  units: number
}

/**
 * Decide se a cena conta como treino/estudo e quanto rende. Devolve null (cena
 * normal, sem redução de xp nem crédito de maestria) quando:
 *  - não há tag, ou a tag não tem nome logo depois;
 *  - #treino e #aula aparecem juntos (o plano não define prioridade, então
 *    não inventa uma regra);
 *  - o nome não existe no catálogo (só pré-cadastrado — hashtag solta é
 *    ignorada, não cria arma/matéria);
 *  - o teto diário do personagem nesse tipo já foi atingido (3.0 unidades =
 *    1500 chars por dia; treino de arma e aula têm tetos separados) — a cena
 *    vira xp básico.
 */
async function planTraining(
  characterId: string, postId: string, cenaLength: number, footer: string
): Promise<TrainingPlan | null> {
  const tags = parseFooterTags(footer)
  let kind: MasteryKind
  let name: string
  if (tags.treino && !tags.aula)      { kind = 'weapon';    name = tags.treino }
  else if (tags.aula && !tags.treino) { kind = 'knowledge'; name = tags.aula }
  else return null

  const entry = await findCatalogByName(kind, name)
  if (!entry) return null

  const remaining = remainingDailyMastery(await getMasteryUsedToday(characterId, kind, postId))
  if (remaining <= 0) return null

  return {
    kind, entry,
    xp:    calculateTrainingSceneXp(cenaLength, remaining),
    units: calculateMasteryUnits(cenaLength, remaining),
  }
}

async function notifyMasteryLevelUp(characterName: string, mastery: SceneMasteryResult): Promise<void> {
  const announceChannel = await getAnnounceChannel()
  if (!announceChannel) return
  const { kind, level } = mastery
  const who  = botSafe(characterName)
  const what = botSafe(mastery.name)
  await postTrikMessage(
    announceChannel,
    kind === 'weapon'
      ? `🗡️ <strong>${who}</strong> subiu de maestria em <strong>${what}</strong> (nível ${level})!`
      : `📚 <strong>${who}</strong> subiu de nível em <strong>${what}</strong> (nível ${level})!`
  )
}

export async function processScenePost(params: {
  threadId: string
  postId: string
  authorUserId: string
  content: string
}): Promise<SceneXpResult> {
  try {
    if (!await isXpThread(params.threadId)) return { awarded: false, reason: 'not_xp_thread' }

    const parsed = parseScenePost(params.content)

    // Cena de narrador: post do narrador com #lore. Testa a tag antes (sem
    // custo) pra só ir ao banco atrás do narrador quando ela existe. Não exige
    // estrutura de plaquinha: com estrutura conta só a cena, sem ela o post todo.
    const plain = stripTags(params.content)
    if (hasLoreTag(plain)) {
      const narratorId = await getNarratorUserId()
      if (narratorId && narratorId === params.authorUserId) {
        return await processNarratorPost(narratorId, params.postId, parsed?.cena ?? plain)
      }
    }

    if (!parsed) {
      await notifySceneRejected(params.postId, 'no_structure')
      return { awarded: false, reason: 'no_structure' }
    }

    const player = await getPlayer(params.authorUserId)
    if (!player) {
      await notifySceneRejected(params.postId, 'no_player')
      return { awarded: false, reason: 'no_player' }
    }

    const character = await matchCharacterByHeader(player.id, parsed.header)
    if (!character) {
      await notifySceneRejected(params.postId, 'no_match')
      return { awarded: false, reason: 'no_match' }
    }

    const baseXp = calculateSceneXp(parsed.cena.length)
    if (baseXp <= 0) {
      await notifySceneRejected(params.postId, 'below_minimum')
      return { awarded: false, reason: 'below_minimum' }
    }

    // O gate de 500 caracteres acima vale pra qualquer cena; só depois dele é
    // que o footer importa (cena curta demais já foi rejeitada).
    const training = await planTraining(character.id, params.postId, parsed.cena.length, parsed.footer)
    const xp = training?.xp ?? baseXp

    // Prêmio + xp + maestria numa transação só. null = o post já tinha prêmio
    // (edições concorrentes): não credita de novo nem mexe na reação.
    const applied = await applySceneAward(
      character.id, params.postId, xp,
      training ? { kind: training.kind, itemId: training.entry.id, units: training.units } : undefined
    )
    if (!applied) return { awarded: false, reason: 'already_awarded' }

    const { leveledUp } = applied
    const mastery: SceneMasteryResult | undefined = training && applied.mastery
      ? {
          kind: training.kind, name: training.entry.name, units: training.units,
          level: applied.mastery.level, leveledUp: applied.mastery.leveledUp,
        }
      : undefined
    await reactSceneCounted(params.postId)

    if (leveledUp) {
      await notifyLevelUp(character.id, character.name)
    }
    if (mastery?.leveledUp) {
      await notifyMasteryLevelUp(character.name, mastery)
    }

    return { awarded: true, characterId: character.id, xp, leveledUp, ...(mastery && { mastery }) }
  } catch (err) {
    console.warn('[trik:xp] processScenePost error:', err)
    return { awarded: false, reason: 'error' }
  }
}

async function processNarratorPost(narratorId: string, postId: string, text: string): Promise<SceneXpResult> {
  const xp = calculateNarratorXp(text.length)
  if (xp <= 0) {
    await notifySceneRejected(postId, 'below_minimum')
    return { awarded: false, reason: 'below_minimum' }
  }
  if (!await applyNarratorAward(narratorId, postId, xp)) return { awarded: false, reason: 'already_awarded' }
  await reactSceneCounted(postId)
  return { awarded: true, narrator: true, xp }
}

/**
 * Desfaz o prêmio de um post. Chamadores (routes/forums.ts):
 *  - PUT /posts/:id: `await` o revert ANTES de reprocessar (o reprocesso põe
 *    ✅ ou ❌ de novo conforme a nova versão — aqui só tira as duas);
 *  - DELETE /posts/:id: ANTES de apagar o post — trik_scene_awards tem
 *    ON DELETE CASCADE, e com o post já removido não sobra linha pra reverter.
 * Nunca lança (convenção do módulo): erro vira log.
 */
export async function revertScenePost(postId: string): Promise<void> {
  try {
    await revertSceneAward(postId)
    await revertNarratorAward(postId)
    await clearSceneRejection(postId)
    await clearSceneMarks(postId)
  } catch (err) {
    console.warn('[trik:xp] revertScenePost error:', err)
  }
}

/** Desfaz o prêmio de TODOS os posts de um tópico — chamar antes de apagar o
 *  tópico (o CASCADE apaga os posts e, com eles, os prêmios). Nunca lança. */
export async function revertThreadScenes(threadId: string): Promise<void> {
  try {
    const postIds = new Set([
      ...await listAwardedPostIdsByThread(threadId),
      ...await listNarratorAwardedPostIdsByThread(threadId),
    ])
    for (const postId of postIds) {
      await revertScenePost(postId)
    }
  } catch (err) {
    console.warn('[trik:xp] revertThreadScenes error:', err)
  }
}
