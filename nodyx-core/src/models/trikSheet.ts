// Módulo RPG (trik) — ficha completa de um personagem pro admin (aba
// Registros → "Ficha completa"). Só leitura; junta o que hoje está espalhado:
// registro, progresso, slots do /levelup, vínculo divino, desbloqueios,
// maestrias e as últimas cenas (com o bonus_detail da Fase 3).

import { db } from '../config/database'
import {
  listBonusCatalog, listCharacterTraits, listPantheonEffects,
  type BonusCatalogKind, type TrikEffect, type CharacterTrait,
} from './trikEffects'

export interface SheetItem {
  id:       string
  name:     string
  category: string | null
  effects:  TrikEffect[]
}

export interface CharacterSheet {
  character: Record<string, unknown> & { id: string; name: string }
  player:    { name: string; username: string }
  progress:  Record<string, unknown> | null
  /** XP pra sair do nível atual (null = nível máximo / sem curva). */
  goalXp:    number | null
  slots: {
    naturalAptitudes:  (SheetItem | null)[]
    acquiredAptitudes: (SheetItem | null)[]
    preferences:       (SheetItem | null)[]
    goal:              SheetItem | null
  }
  pantheon: { id: string; name: string; effects: TrikEffect[] } | null
  deity:    { id: string; name: string; effects: TrikEffect[] } | null
  traits:   (CharacterTrait & { effects: TrikEffect[] })[]
  mastery: {
    weapons:    { id: string; name: string; category: string | null; level: number; progress: string }[]
    knowledges: { id: string; name: string; category: string | null; level: number; progress: string }[]
  }
  recentScenes: {
    post_id: string; xp_awarded: number; mastery_kind: string | null; mastery_awarded: string
    item_name: string | null; game_date: string | null; bonus_detail: unknown; created_at: string
  }[]
}

/** null = personagem não existe. */
export async function getCharacterSheet(characterId: string): Promise<CharacterSheet | null> {
  const { rows: charRows } = await db.query(
    `SELECT c.*, c.birth_date::text AS birth_date, c.faceclaim_birth_date::text AS faceclaim_birth_date,
            p.name AS player_name, u.username
       FROM trik_characters c
       JOIN trik_players p ON p.id = c.player_id
       JOIN users u ON u.id = p.id
      WHERE c.id = $1`,
    [characterId]
  )
  const row = charRows[0]
  if (!row) return null
  const { player_name, username, ...character } = row

  const [progressRes, bonusesRes, weaponsRes, knowledgesRes, scenesRes, traits, pantheonEffects, ...catalogs] = await Promise.all([
    db.query(`SELECT * FROM trik_character_progress WHERE character_id = $1`, [characterId]),
    db.query(
      `SELECT b.*, pa.name AS pantheon_name, d.name AS deity_name
         FROM trik_character_bonuses b
         LEFT JOIN trik_pantheons pa ON pa.id = b.pantheon_id
         LEFT JOIN trik_deities d ON d.id = b.divine_bond_id
        WHERE b.character_id = $1`,
      [characterId]
    ),
    db.query(
      `SELECT w.id, w.name, w.category, p.level, p.progress::text AS progress
         FROM trik_character_weapon_progress p JOIN trik_weapons w ON w.id = p.weapon_id
        WHERE p.character_id = $1 ORDER BY p.level DESC, w.name`,
      [characterId]
    ),
    db.query(
      `SELECT k.id, k.name, k.category, p.level, p.progress::text AS progress
         FROM trik_character_knowledge_progress p JOIN trik_knowledges k ON k.id = p.knowledge_id
        WHERE p.character_id = $1 ORDER BY p.level DESC, k.name`,
      [characterId]
    ),
    db.query(
      `SELECT a.post_id, a.xp_awarded, a.mastery_kind, a.mastery_awarded::text AS mastery_awarded,
              COALESCE(w.name, k.name) AS item_name, a.game_date::text AS game_date,
              a.bonus_detail, a.created_at
         FROM trik_scene_awards a
         LEFT JOIN trik_weapons w ON w.id = a.weapon_id
         LEFT JOIN trik_knowledges k ON k.id = a.knowledge_id
        WHERE a.character_id = $1
        ORDER BY a.created_at DESC LIMIT 15`,
      [characterId]
    ),
    listCharacterTraits(characterId),
    listPantheonEffects(),
    ...(['aptitude', 'preference', 'goal', 'disorder', 'disturbance', 'unique_ability', 'peculiarity'] as BonusCatalogKind[])
      .map(kind => listBonusCatalog(kind)),
  ])

  const [aptitudes, preferences, goals, ...traitCatalogs] = catalogs
  const traitEffects = new Map(traitCatalogs.flat().map(i => [i.id, i.effects]))
  const pick = (list: SheetItem[], id: string | null) => (id ? list.find(i => i.id === id) ?? null : null)

  const progress = progressRes.rows[0] ?? null
  let goalXp: number | null = null
  if (progress) {
    const { rows } = await db.query<{ goal_xp: string }>(
      `SELECT goal_xp FROM trik_progression WHERE type = 'character' AND level = $1`, [progress.level]
    )
    goalXp = rows[0] ? Number(rows[0].goal_xp) : null
  }

  const b = bonusesRes.rows[0] ?? {}
  return {
    character: character as CharacterSheet['character'],
    player:    { name: player_name, username },
    progress,
    goalXp,
    slots: {
      naturalAptitudes:  [pick(aptitudes, b.first_natural_aptitude_id), pick(aptitudes, b.second_natural_aptitude_id)],
      acquiredAptitudes: [pick(aptitudes, b.first_acquired_aptitude_id), pick(aptitudes, b.second_acquired_aptitude_id)],
      preferences:       [pick(preferences, b.first_preference_id), pick(preferences, b.second_preference_id)],
      goal:              pick(goals, b.goal_id),
    },
    pantheon: b.pantheon_id ? { id: b.pantheon_id, name: b.pantheon_name, effects: pantheonEffects[b.pantheon_id] ?? [] } : null,
    deity:    b.divine_bond_id ? { id: b.divine_bond_id, name: b.deity_name, effects: pantheonEffects[b.divine_bond_id] ?? [] } : null,
    traits:   traits.map(t => ({ ...t, effects: traitEffects.get(t.id) ?? [] })),
    mastery:  { weapons: weaponsRes.rows, knowledges: knowledgesRes.rows },
    recentScenes: scenesRes.rows,
  }
}
