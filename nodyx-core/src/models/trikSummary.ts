/**
 * Módulo RPG (trik) — resumo dos personagens do jogador logado, consumido pelo
 * widget "Meus personagens" da página inicial (GET /api/v1/trik/characters/mine/summary).
 *
 * Só leitura, e só dos personagens do próprio jogador (o userId vem do token).
 * Separado de models/trik.ts pra ele não crescer mais.
 */

import { db } from '../config/database'
import { getPlayer, getCharactersByPlayer } from './trik'

/** Quantas cenas entram na "média de xp por cena". */
export const AVG_SCENES = 5

export interface MasteryLine {
  name:     string
  category: string | null
  level:    number
  progress: number
  /** treinos/aulas pra sair do nível; null = nível máximo (sem curva). */
  required: number | null
}

export interface LevelRequirement {
  label: string
  met:   boolean
}

export interface CharacterSummary {
  id:          string
  name:        string
  level:       number
  progressXp:  number
  /** xp pra sair do nível atual; null = nível máximo / sem curva. */
  goalXp:      number | null
  /** Média do xp das últimas AVG_SCENES cenas normais; null = nenhuma ainda. */
  avgSceneXp:  number | null
  sceneCount:  number
  weapons:     MasteryLine[]
  knowledges:  MasteryLine[]
  /** Pontos de level up ainda não gastos no /levelup (só os > 0). */
  unspent:     { label: string; count: number }[]
  /** Requisitos de maestria/aula do nível atual (trik_023); vazio = só xp. */
  requirements: LevelRequirement[]
}

const UNSPENT_POOLS = [
  ['Conduta',           'points_conduct',           'spent_conduct'],
  ['Princípios',        'points_principles',        'spent_principles'],
  ['Preferências',      'points_preferences',       'spent_preferences'],
  ['Aptidão natural',   'points_natural_aptitudes', 'spent_natural_aptitudes'],
  ['Aptidão adquirida', 'points_acquired_aptitudes', 'spent_acquired_aptitudes'],
] as const

async function masteryLines(
  characterId: string, kind: 'weapon' | 'knowledge',
): Promise<MasteryLine[]> {
  // Nomes de tabela/coluna vêm só deste ramo, nunca do input.
  const sql = kind === 'weapon'
    ? { progress: 'trik_character_weapon_progress',    catalog: 'trik_weapons',    item: 'weapon_id',    req: 'req_mastery' }
    : { progress: 'trik_character_knowledge_progress', catalog: 'trik_knowledges', item: 'knowledge_id', req: 'req_education' }
  const { rows } = await db.query(
    `SELECT c.name, c.category, p.level, p.progress::float AS progress, pr.${sql.req} AS required
       FROM ${sql.progress} p
       JOIN ${sql.catalog} c ON c.id = p.${sql.item}
       LEFT JOIN trik_progression pr ON pr.type = $2 AND pr.level = p.level
      WHERE p.character_id = $1
      ORDER BY p.level DESC, p.progress DESC, c.name`,
    [characterId, kind],
  )
  return rows.map(r => ({
    name: r.name, category: r.category, level: Number(r.level), progress: Number(r.progress),
    required: r.required && Number(r.required) > 0 ? Number(r.required) : null,
  }))
}

async function summarize(characterId: string, name: string): Promise<CharacterSummary> {
  const [progressRes, avgRes, weapons, knowledges] = await Promise.all([
    db.query(`SELECT * FROM trik_character_progress WHERE character_id = $1`, [characterId]),
    db.query(
      // Só cenas normais (sem #treino/#aula: mastery_kind nulo) — a de treino
      // rende xp reduzido e puxaria a média pra baixo.
      `SELECT COUNT(*)::int AS n, AVG(xp_awarded)::float AS avg
         FROM (SELECT xp_awarded FROM trik_scene_awards
                WHERE character_id = $1 AND mastery_kind IS NULL
                ORDER BY created_at DESC LIMIT ${AVG_SCENES}) last`,
      [characterId],
    ),
    masteryLines(characterId, 'weapon'),
    masteryLines(characterId, 'knowledge'),
  ])

  const progress = progressRes.rows[0] ?? null
  const level = progress ? Number(progress.level) : 1

  const { rows: levelRows } = await db.query(
    `SELECT pr.goal_xp, pr.req_weapon_level, pr.req_knowledge_level, k.name AS knowledge_name,
            COALESCE((SELECT MAX(level) FROM trik_character_weapon_progress WHERE character_id = $1), 0) AS best_weapon,
            COALESCE((SELECT level FROM trik_character_knowledge_progress
                       WHERE character_id = $1 AND knowledge_id = pr.req_knowledge_id), 0) AS knowledge_level
       FROM trik_progression pr
       LEFT JOIN trik_knowledges k ON k.id = pr.req_knowledge_id
      WHERE pr.type = 'character' AND pr.level = $2`,
    [characterId, level],
  )
  const lv = levelRows[0]

  const requirements: LevelRequirement[] = []
  if (lv && Number(lv.req_weapon_level) > 0) {
    requirements.push({
      label: `Maestria nível ${lv.req_weapon_level} em qualquer arma`,
      met:   Number(lv.best_weapon) >= Number(lv.req_weapon_level),
    })
  }
  if (lv?.knowledge_name && Number(lv.req_knowledge_level) > 0) {
    requirements.push({
      label: `${lv.knowledge_name} nível ${lv.req_knowledge_level}`,
      met:   Number(lv.knowledge_level) >= Number(lv.req_knowledge_level),
    })
  }

  const unspent = progress
    ? UNSPENT_POOLS
        .map(([label, total, spent]) => ({ label, count: Number(progress[total] ?? 0) - Number(progress[spent] ?? 0) }))
        .filter(p => p.count > 0)
    : []

  const avg = avgRes.rows[0]
  return {
    id: characterId,
    name,
    level,
    progressXp: progress ? Number(progress.progress_xp) : 0,
    goalXp:     lv ? Number(lv.goal_xp) : null,
    avgSceneXp: avg?.n > 0 ? Math.round(Number(avg.avg) * 10) / 10 : null,
    sceneCount: Number(avg?.n ?? 0),
    weapons, knowledges, unspent, requirements,
  }
}

/** Resumo de todos os personagens do jogador (vazio se ele não tem /registro). */
export async function getPlayerSummary(userId: string): Promise<CharacterSummary[]> {
  const player = await getPlayer(userId)
  if (!player) return []
  const characters = await getCharactersByPlayer(player.id)
  return Promise.all(characters.map(c => summarize(c.id, c.name)))
}
