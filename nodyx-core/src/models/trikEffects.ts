/**
 * Módulo RPG (trik) — Fase 3: catálogos com efeito (aptidões, preferências,
 * objetivos e as listas desbloqueáveis), efeitos, regiões, clima e semana de
 * jogo. Ver trik_010_effects.sql e plans/fase-tres-bonus.md.
 *
 * Separado de models/trik.ts pra ele não crescer mais (mesmo motivo de
 * models/trikMastery.ts). Panteões/divindades continuam em models/trik.ts —
 * aqui só entram como dono de efeito.
 */

import { db } from '../config/database'
import { listCharacterInterests, interestEffects } from './trikInterests'

// ─── Catálogos que são dono de efeito ──────────────────────────────────────
// Nomes de tabela/coluna vêm SÓ destes mapas (nunca de input do usuário) — por
// isso é seguro interpolar nas queries abaixo.

/** Catálogos genéricos (id, category, name) — cadastro na aba Bônus. */
export const BONUS_CATALOG_KINDS = [
  'aptitude', 'preference', 'goal',
  'disorder', 'disturbance', 'unique_ability', 'peculiarity',
] as const
export type BonusCatalogKind = (typeof BONUS_CATALOG_KINDS)[number]

/** Listas que o admin/narrador desbloqueia pro personagem (N:N). */
export const TRAIT_KINDS = ['disorder', 'disturbance', 'unique_ability', 'peculiarity'] as const
export type TraitKind = (typeof TRAIT_KINDS)[number]

/** Todo dono possível de efeito = catálogos genéricos + panteão/divindade. */
export const EFFECT_OWNER_KINDS = [...BONUS_CATALOG_KINDS, 'pantheon', 'deity'] as const
export type EffectOwnerKind = (typeof EFFECT_OWNER_KINDS)[number]

const CATALOG_TABLE: Record<BonusCatalogKind, string> = {
  aptitude:       'trik_aptitudes',
  preference:     'trik_preferences',
  goal:           'trik_goals',
  disorder:       'trik_disorders',
  disturbance:    'trik_disturbances',
  unique_ability: 'trik_unique_abilities',
  peculiarity:    'trik_peculiarities',
}

/** Coluna de trik_effects que aponta pro dono. */
const OWNER_COLUMN: Record<EffectOwnerKind, string> = {
  aptitude:       'aptitude_id',
  preference:     'preference_id',
  goal:           'goal_id',
  pantheon:       'pantheon_id',
  deity:          'deity_id',
  disorder:       'disorder_id',
  disturbance:    'disturbance_id',
  unique_ability: 'unique_ability_id',
  peculiarity:    'peculiarity_id',
}

const TRAIT_LINK: Record<TraitKind, { table: string; itemCol: string }> = {
  disorder:       { table: 'trik_character_disorders',        itemCol: 'disorder_id' },
  disturbance:    { table: 'trik_character_disturbances',     itemCol: 'disturbance_id' },
  unique_ability: { table: 'trik_character_unique_abilities', itemCol: 'unique_ability_id' },
  peculiarity:    { table: 'trik_character_peculiarities',    itemCol: 'peculiarity_id' },
}

// ─── Efeitos ────────────────────────────────────────────────────────────────
// Listas espelham os CHECKs de trik_010 — o banco é a última barreira, o zod
// da rota usa estas constantes pra devolver 400 legível antes.

export const EFFECTS = [
  'reduz_requisito', 'multiplica', 'limite_diario',
  'anula_alerta', 'sensibilidade', 'espelho',
] as const
export type EffectType = (typeof EFFECTS)[number]

/** Efeitos que carregam número em `value`. */
export const NUMERIC_EFFECTS: readonly EffectType[] = ['reduz_requisito', 'multiplica', 'limite_diario']
/** Efeitos de temperatura — exigem `alert_kind`. */
export const ALERT_EFFECTS: readonly EffectType[] = ['anula_alerta', 'sensibilidade']

export const ACTIVITIES = ['treino', 'aula', 'todas'] as const
export const ALERT_KINDS = ['calor', 'frio', 'umidade'] as const
export const CONDITION_KINDS = ['sempre', 'clima', 'periodo', 'companhia'] as const
export const PERIODS = ['dia', 'noite'] as const
/** Climas que podem ser condição de bônus. Garoa existe no aviso, mas é só
 *  narrativa — fica de fora daqui (e do CHECK do banco). */
export const BONUS_CLIMATES = ['sol', 'nublado', 'neblina', 'chuva', 'tempestade', 'neve'] as const

export interface TrikEffect {
  id:                 string
  effect:             EffectType
  activity:           (typeof ACTIVITIES)[number]
  weapon_id:          string | null
  knowledge_id:       string | null
  weapon_category:    string | null
  knowledge_category: string | null
  alert_kind:         (typeof ALERT_KINDS)[number] | null
  condition_kind:     (typeof CONDITION_KINDS)[number]
  condition_value:    string | null
  value:              string | null // NUMERIC — pg devolve como string
}

export interface EffectInput {
  effect:            EffectType
  activity:          (typeof ACTIVITIES)[number]
  weaponId?:         string | null
  knowledgeId?:      string | null
  weaponCategory?:   string | null
  knowledgeCategory?: string | null
  alertKind?:        (typeof ALERT_KINDS)[number] | null
  conditionKind:     (typeof CONDITION_KINDS)[number]
  conditionValue?:   string | null
  value?:            number | null
}

const EFFECT_COLS = `e.id, e.effect, e.activity, e.weapon_id, e.knowledge_id, e.weapon_category,
  e.knowledge_category, e.alert_kind, e.condition_kind, e.condition_value, e.value`

/** Agregado JSON dos efeitos de um dono, pra usar dentro de um SELECT do
 *  catálogo (`ownerCol` vem de OWNER_COLUMN, `alias` é o alias da tabela). */
function effectsAgg(ownerCol: string, alias: string): string {
  return `COALESCE((
    SELECT json_agg(json_build_object(
      'id', e.id, 'effect', e.effect, 'activity', e.activity,
      'weapon_id', e.weapon_id, 'knowledge_id', e.knowledge_id,
      'weapon_category', e.weapon_category, 'knowledge_category', e.knowledge_category,
      'alert_kind', e.alert_kind, 'condition_kind', e.condition_kind,
      'condition_value', e.condition_value, 'value', e.value
    ) ORDER BY e.created_at)
    FROM trik_effects e WHERE e.${ownerCol} = ${alias}.id
  ), '[]')`
}

/** null = dono não existe (a FK estoura com 23503 — traduzido aqui). */
export async function createEffect(
  ownerKind: EffectOwnerKind, ownerId: string, input: EffectInput
): Promise<TrikEffect | null> {
  try {
    const { rows } = await db.query<TrikEffect>(
      `INSERT INTO trik_effects AS e
         (${OWNER_COLUMN[ownerKind]}, effect, activity, weapon_id, knowledge_id,
          weapon_category, knowledge_category, alert_kind, condition_kind, condition_value, value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${EFFECT_COLS}`,
      [ownerId, input.effect, input.activity, input.weaponId ?? null, input.knowledgeId ?? null,
       input.weaponCategory?.trim() || null, input.knowledgeCategory?.trim() || null,
       input.alertKind ?? null, input.conditionKind, input.conditionValue ?? null, input.value ?? null]
    )
    return rows[0]
  } catch (err: any) {
    // Dono inexistente. Alvo (arma/matéria) inexistente também é 23503, mas
    // aí o constraint é o do alvo — esse sobe como erro de validação.
    if (err?.code === '23503' && String(err.constraint ?? '').includes(OWNER_COLUMN[ownerKind])) return null
    throw err
  }
}

export async function deleteEffect(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM trik_effects WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}

// ─── Catálogos genéricos (aba Bônus) ────────────────────────────────────────

export interface BonusCatalogItem {
  id:       string
  category: string | null
  name:     string
  effects:  TrikEffect[]
}

export async function listBonusCatalog(kind: BonusCatalogKind): Promise<BonusCatalogItem[]> {
  const { rows } = await db.query<BonusCatalogItem>(
    `SELECT c.id, c.category, c.name, ${effectsAgg(OWNER_COLUMN[kind], 'c')} AS effects
       FROM ${CATALOG_TABLE[kind]} c
      ORDER BY c.category NULLS LAST, c.name`
  )
  return rows
}

/** Categoria com a grafia que já existe na lista ("mental" → "Mental"), pra
 *  o dropdown e as validações por categoria não verem duas categorias onde
 *  há uma. Nova → como digitada. */
async function canonicalBonusCategory(kind: BonusCatalogKind, category: string): Promise<string> {
  const { rows } = await db.query<{ category: string }>(
    `SELECT category FROM ${CATALOG_TABLE[kind]} WHERE LOWER(TRIM(category)) = LOWER($1) LIMIT 1`,
    [category.trim()]
  )
  return rows[0]?.category ?? category.trim()
}

/** Nome duplicado sobe como 23505 nas listas desbloqueáveis (UNIQUE); em
 *  aptidão/preferência/objetivo o banco não tem UNIQUE, então a checagem é
 *  aqui, case-insensitive. null = já existe. */
export async function createBonusCatalogItem(
  kind: BonusCatalogKind, name: string, category: string
): Promise<BonusCatalogItem | null> {
  const table = CATALOG_TABLE[kind]
  const { rows } = await db.query<Omit<BonusCatalogItem, 'effects'>>(
    // ::varchar explícito: sem ele o Postgres deduz $1 como varchar (coluna)
    // e como text (LOWER) e recusa — "inconsistent types deduced".
    `INSERT INTO ${table} (name, category)
     SELECT $1::varchar, $2::varchar
      WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE LOWER(name) = LOWER($1::varchar))
     RETURNING id, category, name`,
    [name.trim(), await canonicalBonusCategory(kind, category)]
  )
  return rows[0] ? { ...rows[0], effects: [] } : null
}

/** Troca a categoria de um item já cadastrado. false = item não existe. */
export async function setBonusCatalogCategory(kind: BonusCatalogKind, id: string, category: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE ${CATALOG_TABLE[kind]} SET category = $2 WHERE id = $1`,
    [id, await canonicalBonusCategory(kind, category)]
  )
  return (rowCount ?? 0) > 0
}

export async function deleteBonusCatalogItem(kind: BonusCatalogKind, id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM ${CATALOG_TABLE[kind]} WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}

/** Efeitos de panteões e divindades, agrupados por dono — a tela de Panteões
 *  junta com listPantheons (models/trik.ts). */
export async function listPantheonEffects(): Promise<Record<string, TrikEffect[]>> {
  const { rows } = await db.query<TrikEffect & { owner_id: string }>(
    `SELECT COALESCE(e.pantheon_id, e.deity_id) AS owner_id, ${EFFECT_COLS}
       FROM trik_effects e
      WHERE e.pantheon_id IS NOT NULL OR e.deity_id IS NOT NULL
      ORDER BY e.created_at`
  )
  const byOwner: Record<string, TrikEffect[]> = {}
  for (const { owner_id, ...effect } of rows) (byOwner[owner_id] ??= []).push(effect)
  return byOwner
}

// ─── Listas desbloqueadas no personagem ────────────────────────────────────

export interface CharacterTrait {
  kind:        TraitKind
  id:          string
  name:        string
  category:    string | null
  unlocked_at: string
}

export async function listCharacterTraits(characterId: string): Promise<CharacterTrait[]> {
  const parts = TRAIT_KINDS.map(kind => {
    const { table, itemCol } = TRAIT_LINK[kind]
    return `SELECT '${kind}' AS kind, c.id, c.name, c.category, l.unlocked_at
              FROM ${table} l JOIN ${CATALOG_TABLE[kind]} c ON c.id = l.${itemCol}
             WHERE l.character_id = $1`
  })
  const { rows } = await db.query<CharacterTrait>(
    `${parts.join(' UNION ALL ')} ORDER BY kind, name`,
    [characterId]
  )
  return rows
}

/** Desbloqueios de todos os personagens, agrupados por personagem — a aba
 *  Registros mostra/edita na mesma tela da lista. */
export async function listAllCharacterTraits(): Promise<Record<string, CharacterTrait[]>> {
  const parts = TRAIT_KINDS.map(kind => {
    const { table, itemCol } = TRAIT_LINK[kind]
    return `SELECT l.character_id, '${kind}' AS kind, c.id, c.name, c.category, l.unlocked_at
              FROM ${table} l JOIN ${CATALOG_TABLE[kind]} c ON c.id = l.${itemCol}`
  })
  const { rows } = await db.query<CharacterTrait & { character_id: string }>(
    `${parts.join(' UNION ALL ')} ORDER BY kind, name`
  )
  const byCharacter: Record<string, CharacterTrait[]> = {}
  for (const { character_id, ...trait } of rows) (byCharacter[character_id] ??= []).push(trait)
  return byCharacter
}

/** false = já estava desbloqueado. Personagem/item inexistente sobe como 23503. */
export async function unlockTrait(
  characterId: string, kind: TraitKind, itemId: string, unlockedBy: string
): Promise<boolean> {
  const { table, itemCol } = TRAIT_LINK[kind]
  const { rowCount } = await db.query(
    `INSERT INTO ${table} (character_id, ${itemCol}, unlocked_by) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [characterId, itemId, unlockedBy]
  )
  return (rowCount ?? 0) > 0
}

export async function removeTrait(characterId: string, kind: TraitKind, itemId: string): Promise<boolean> {
  const { table, itemCol } = TRAIT_LINK[kind]
  const { rowCount } = await db.query(
    `DELETE FROM ${table} WHERE character_id = $1 AND ${itemCol} = $2`,
    [characterId, itemId]
  )
  return (rowCount ?? 0) > 0
}

// ─── Regiões ────────────────────────────────────────────────────────────────

export interface TrikLocation {
  id:        string
  name:      string
  latitude:  string // NUMERIC
  longitude: string
}

export async function listLocations(): Promise<TrikLocation[]> {
  const { rows } = await db.query<TrikLocation>(
    `SELECT id, name, latitude, longitude FROM trik_locations ORDER BY name`
  )
  return rows
}

/** Nome duplicado sobe como 23505. */
export async function createLocation(name: string, latitude: number, longitude: number): Promise<TrikLocation> {
  const { rows } = await db.query<TrikLocation>(
    `INSERT INTO trik_locations (name, latitude, longitude) VALUES ($1, $2, $3)
     RETURNING id, name, latitude, longitude`,
    [name.trim(), latitude, longitude]
  )
  return rows[0]
}

export async function deleteLocation(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM trik_locations WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}

/** Região de um tópico de XP. false = o tópico não está marcado pra XP
 *  (região só existe em trik_threads). Região inexistente sobe como 23503. */
export async function setThreadLocation(threadId: string, locationId: string | null): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE trik_threads SET location_id = $2 WHERE thread_id = $1`,
    [threadId, locationId]
  )
  return (rowCount ?? 0) > 0
}

/** Região do tópico (null = sem região ou tópico fora de trik_threads). */
export async function getThreadLocation(threadId: string): Promise<string | null> {
  const { rows } = await db.query<{ location_id: string | null }>(
    `SELECT location_id FROM trik_threads WHERE thread_id = $1`, [threadId]
  )
  return rows[0]?.location_id ?? null
}

// ─── Semana de jogo ─────────────────────────────────────────────────────────

/** Domingo que abre a semana em jogo (YYYY-MM-DD), ou null se nenhuma foi
 *  selecionada ainda — aí nenhuma cena é recusada por data. */
export async function getGameWeek(): Promise<string | null> {
  const { rows } = await db.query<{ week_start: string | null }>(
    `SELECT week_start::text AS week_start FROM trik_game_state WHERE id`
  )
  return rows[0]?.week_start ?? null
}

/** `weekStart` precisa ser domingo — o CHECK do banco garante (23514). */
export async function setGameWeek(weekStart: string, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO trik_game_state (id, week_start, updated_by, updated_at) VALUES (TRUE, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET week_start = EXCLUDED.week_start, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [weekStart, userId]
  )
}

// ─── Clima gravado (trik_weather) ───────────────────────────────────────────
// Escrita: services/trik/weather.ts (Open-Meteo).

export interface TrikWeatherDay {
  location_id:  string
  game_date:    string
  weather_code: number | null
  climate:      string | null
  sunrise:      string | null
  sunset:       string | null
  temp_max:     string | null
  temp_min:     string | null
  humidity_min: number | null
  rain_hours:   string | null
}

/** Os 7 dias da semana que começa em `weekStart`, de todas as regiões. */
export async function listWeatherWeek(weekStart: string): Promise<TrikWeatherDay[]> {
  const { rows } = await db.query<TrikWeatherDay>(
    `SELECT location_id, game_date::text AS game_date, weather_code, climate,
            sunrise::text AS sunrise, sunset::text AS sunset, temp_max, temp_min,
            humidity_min, rain_hours
       FROM trik_weather
      WHERE game_date BETWEEN $1::date AND $1::date + 6
      ORDER BY location_id, game_date`,
    [weekStart]
  )
  return rows
}

export type WeatherDayInput = Omit<TrikWeatherDay, 'temp_max' | 'temp_min'> & {
  temp_max: number | null
  temp_min: number | null
}

/** Grava (ou substitui) os dias vindos da Open-Meteo numa transação só. */
export async function saveWeatherDays(days: WeatherDayInput[]): Promise<void> {
  if (days.length === 0) return
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    for (const d of days) {
      await client.query(
        `INSERT INTO trik_weather (location_id, game_date, weather_code, climate, sunrise, sunset,
                                   temp_max, temp_min, humidity_min, rain_hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (location_id, game_date) DO UPDATE SET
           weather_code = EXCLUDED.weather_code, climate = EXCLUDED.climate,
           sunrise = EXCLUDED.sunrise, sunset = EXCLUDED.sunset,
           temp_max = EXCLUDED.temp_max, temp_min = EXCLUDED.temp_min,
           humidity_min = EXCLUDED.humidity_min, rain_hours = EXCLUDED.rain_hours,
           fetched_at = NOW()`,
        [d.location_id, d.game_date, d.weather_code, d.climate, d.sunrise, d.sunset,
         d.temp_max, d.temp_min, d.humidity_min, d.rain_hours]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// ─── Motor de bônus (processScenePost) ──────────────────────────────────────

const EFFECT_SELECT = `e.id, e.effect, e.activity, e.weapon_id, e.knowledge_id, e.weapon_category,
  e.knowledge_category, e.alert_kind, e.condition_kind, e.condition_value, e.value`

/**
 * Efeitos de cada personagem, juntando os 9 donos: aptidões (4 slots),
 * preferências, objetivo, panteão, vínculo divino e as 4 listas desbloqueadas
 * — mais os interesses (trik_012), que viram efeitos sintéticos.
 */
export async function listCharacterEffects(characterIds: string[]): Promise<Record<string, TrikEffect[]>> {
  const out: Record<string, TrikEffect[]> = Object.fromEntries(characterIds.map(id => [id, []]))
  if (characterIds.length === 0) return out
  const traitParts = TRAIT_KINDS.map(kind => {
    const { table, itemCol } = TRAIT_LINK[kind]
    return `SELECT l.character_id, ${EFFECT_SELECT}
              FROM ${table} l JOIN trik_effects e ON e.${OWNER_COLUMN[kind]} = l.${itemCol}
             WHERE l.character_id = ANY($1)`
  })
  const { rows } = await db.query<TrikEffect & { character_id: string }>(
    `SELECT b.character_id, ${EFFECT_SELECT}
       FROM trik_character_bonuses b
       JOIN trik_effects e ON
            e.aptitude_id IN (b.first_natural_aptitude_id, b.second_natural_aptitude_id,
                              b.first_acquired_aptitude_id, b.second_acquired_aptitude_id)
         OR e.preference_id IN (b.first_preference_id, b.second_preference_id)
         OR e.goal_id = b.goal_id
         OR e.pantheon_id = b.pantheon_id
         OR e.deity_id = b.divine_bond_id
      WHERE b.character_id = ANY($1)
     UNION ALL
     ${traitParts.join('\n     UNION ALL\n     ')}`,
    [characterIds]
  )
  for (const { character_id, ...effect } of rows) out[character_id]?.push(effect)
  const interests = await listCharacterInterests(characterIds)
  for (const [id, list] of Object.entries(interests)) out[id]?.push(...interestEffects(list))
  return out
}

/** Personagens de OUTROS jogadores cujo nome bate (sem diferenciar
 *  maiúsculas) com algum nome do #com — os parceiros do espelho. */
export async function findPartnerCharacters(names: string[], excludePlayerId: string): Promise<string[]> {
  if (names.length === 0) return []
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM trik_characters
      WHERE LOWER(TRIM(name)) = ANY($1) AND player_id <> $2`,
    [names.map(n => n.trim().toLowerCase()), excludePlayerId]
  )
  return rows.map(r => r.id)
}

/** Região do tópico + clima do dia (null quando falta qualquer um). */
export async function getThreadWeatherDay(threadId: string, gameDate: string): Promise<TrikWeatherDay | null> {
  const { rows } = await db.query<TrikWeatherDay>(
    `SELECT w.location_id, w.game_date::text AS game_date, w.weather_code, w.climate,
            w.sunrise::text AS sunrise, w.sunset::text AS sunset, w.temp_max, w.temp_min,
            w.humidity_min, w.rain_hours
       FROM trik_threads t JOIN trik_weather w ON w.location_id = t.location_id
      WHERE t.thread_id = $1 AND w.game_date = $2`,
    [threadId, gameDate]
  )
  return rows[0] ?? null
}
