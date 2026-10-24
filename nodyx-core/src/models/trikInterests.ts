/**
 * Módulo RPG (trik) — Fase 3: interesses primário e secundário do personagem.
 * Ver trik_012_interests.sql e plans/fase-tres-bonus.md §6.5.
 *
 * Cada interesse aponta para uma categoria de arma (treino) ou de matéria
 * (aula) e entra no motor como um efeito `reduz_requisito` sintético
 * (interestEffects) — primário −2, secundário −1. O slot abre por nível
 * (points_*_interest) e pode ser trocado uma vez por semana real.
 */

import { db } from '../config/database'
import { normalizeCatalogName, type MasteryKind } from './trikMastery'
import type { TrikEffect } from './trikEffects'

export const INTEREST_SLOTS = ['primario', 'secundario'] as const
export type InterestSlot = (typeof INTEREST_SLOTS)[number]

/** Redução de requisito de cada slot (confirmado pelo usuário, 2026-10-19). */
export const INTEREST_REDUCTION: Record<InterestSlot, number> = { primario: 2, secundario: 1 }

/**
 * Fuso da "semana real" (domingo–sábado). A comunidade é brasileira; o
 * servidor pode estar em UTC, então o fuso é fixo aqui em vez do relógio dele.
 */
export const INTEREST_WEEK_TZ = 'America/Sao_Paulo'

const CATALOG: Record<MasteryKind, string> = { weapon: 'trik_weapons', knowledge: 'trik_knowledges' }

export interface CharacterInterest {
  slot:      InterestSlot
  kind:      MasteryKind
  category:  string
  chosen_at: string
  /** Já trocou nesta semana — próxima troca só no domingo. */
  locked:    boolean
}

// Domingo da semana de um timestamp, no fuso da semana real.
const weekOf = (col: string) =>
  `((${col} AT TIME ZONE '${INTEREST_WEEK_TZ}')::date
     - EXTRACT(DOW FROM ${col} AT TIME ZONE '${INTEREST_WEEK_TZ}')::int)`

export async function listCharacterInterests(characterIds: string[]): Promise<Record<string, CharacterInterest[]>> {
  const out: Record<string, CharacterInterest[]> = Object.fromEntries(characterIds.map(id => [id, []]))
  if (characterIds.length === 0) return out
  const { rows } = await db.query<CharacterInterest & { character_id: string }>(
    `SELECT character_id, slot, kind, category, chosen_at::text AS chosen_at,
            ${weekOf('chosen_at')} = ${weekOf('NOW()')} AS locked
       FROM trik_character_interests
      WHERE character_id = ANY($1)
      ORDER BY slot`,
    [characterIds]
  )
  for (const { character_id, ...interest } of rows) out[character_id]?.push(interest)
  return out
}

/** Categorias cadastradas no catálogo (as únicas que um interesse aceita). */
export async function listCategories(kind: MasteryKind): Promise<string[]> {
  const { rows } = await db.query<{ category: string }>(
    `SELECT DISTINCT category FROM ${CATALOG[kind]} WHERE category IS NOT NULL ORDER BY category`
  )
  return rows.map(r => r.category)
}

export type SetInterestResult =
  | { ok: true; interest: CharacterInterest }
  | { ok: false; code: 'LOCKED_SLOT' | 'WEEKLY_LIMIT' | 'UNKNOWN_CATEGORY' | 'DUPLICATE' | 'UNCHANGED' }

/**
 * Escolhe/troca o interesse de um slot. A trava semanal só vale para TROCA:
 * a primeira escolha de um slot recém-aberto é imediata. O UPSERT condicional
 * faz a checagem da semana e a gravação num statement só (sem corrida entre
 * dois submits); o índice único barra a mesma categoria nos dois slots.
 */
export async function setCharacterInterest(
  characterId: string, slot: InterestSlot, kind: MasteryKind, category: string
): Promise<SetInterestResult> {
  const { rows: prog } = await db.query<{ points: number }>(
    `SELECT points_${slot === 'primario' ? 'primary' : 'secondary'}_interest AS points
       FROM trik_character_progress WHERE character_id = $1`,
    [characterId]
  )
  if (!prog[0] || prog[0].points <= 0) return { ok: false, code: 'LOCKED_SLOT' }

  const key = normalizeCatalogName(category)
  const canonical = (await listCategories(kind)).find(c => normalizeCatalogName(c) === key)
  if (!canonical) return { ok: false, code: 'UNKNOWN_CATEGORY' }

  const { rows: current } = await db.query<{ kind: string; category: string }>(
    `SELECT kind, category FROM trik_character_interests WHERE character_id = $1 AND slot = $2`,
    [characterId, slot]
  )
  if (current[0] && current[0].kind === kind && normalizeCatalogName(current[0].category) === key) {
    return { ok: false, code: 'UNCHANGED' }
  }

  try {
    const { rows } = await db.query<{ chosen_at: string }>(
      `INSERT INTO trik_character_interests (character_id, slot, kind, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (character_id, slot) DO UPDATE
         SET kind = EXCLUDED.kind, category = EXCLUDED.category, chosen_at = NOW()
         WHERE ${weekOf('trik_character_interests.chosen_at')} < ${weekOf('NOW()')}
       RETURNING chosen_at::text AS chosen_at`,
      [characterId, slot, kind, canonical]
    )
    if (!rows[0]) return { ok: false, code: 'WEEKLY_LIMIT' }
    return { ok: true, interest: { slot, kind, category: canonical, chosen_at: rows[0].chosen_at, locked: true } }
  } catch (err: any) {
    if (err?.code === '23505') return { ok: false, code: 'DUPLICATE' }
    throw err
  }
}

/**
 * Interesses como efeitos do motor (bonusEngine): `reduz_requisito` sobre a
 * categoria, só na atividade dela. O id sintético (não é UUID de
 * trik_effects) vai para bonus_detail.appliedEffects e identifica o slot e a
 * categoria que valeram na cena.
 */
export function interestEffects(interests: CharacterInterest[]): TrikEffect[] {
  return interests.map(i => ({
    id:                 `interesse:${i.slot}:${i.category}`,
    effect:             'reduz_requisito',
    activity:           i.kind === 'weapon' ? 'treino' : 'aula',
    weapon_id:          null,
    knowledge_id:       null,
    weapon_category:    i.kind === 'weapon' ? i.category : null,
    knowledge_category: i.kind === 'knowledge' ? i.category : null,
    alert_kind:         null,
    condition_kind:     'sempre',
    condition_value:    null,
    value:              String(INTEREST_REDUCTION[i.slot]),
  }))
}
