/**
 * Módulo RPG (trik) — maestria de arma (#treino) e de conhecimento (#aula).
 * Ver plans/TRIK-PROJECT.md, seção 4, e trik_002_xp.sql.
 *
 * Separado de models/trik.ts pra ele não crescer mais. Os dois "kinds" têm
 * mecânica idêntica — só muda a tabela de catálogo, a de progresso e a coluna
 * de trik_progression que guarda o requisito ("treinos necessários" pra ir do
 * nível N ao N+1): `req_mastery` pra arma, `req_education` pra conhecimento.
 * Por isso toda função aqui recebe o `kind` em vez de existir em duas versões.
 */

import { db } from '../config/database'

export const MASTERY_KINDS = ['weapon', 'knowledge'] as const
export type MasteryKind = (typeof MASTERY_KINDS)[number]

/** Aceita o `db` (pool) ou um client de transação — o revert roda dentro da
 *  transação de revertSceneAward (models/trik.ts). */
interface Queryable {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}
const pool = db as unknown as Queryable

// Nomes de tabela/coluna vêm SÓ deste mapa (nunca de input do usuário) — por
// isso é seguro interpolar nas queries abaixo.
const KIND_CONFIG = {
  weapon:    { catalog: 'trik_weapons',    progress: 'trik_character_weapon_progress',    itemCol: 'weapon_id',    reqCol: 'req_mastery' },
  knowledge: { catalog: 'trik_knowledges', progress: 'trik_character_knowledge_progress', itemCol: 'knowledge_id', reqCol: 'req_education' },
} as const

// ─── Catálogo (armas / matérias) ────────────────────────────────────────────

export interface CatalogEntry {
  id:   string
  name: string
  /** Registro no banco pra validar bônus por categoria (Fase 3). Arma
   *  sempre tem; matéria ganhou na trik_010 — as antigas ficam null. */
  category: string | null
}

/**
 * Chave de comparação de nome de catálogo: minúsculo, sem acento, só letras e
 * dígitos. É o que faz `#espadalonga` (hashtag não tem espaço) bater com
 * "Espada Longa" cadastrada no admin, e o que o POST do catálogo usa pra
 * detectar duplicata ("Espada Longa" vs "espada  longa" vs "ESPADALONGA").
 */
export function normalizeCatalogName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export async function listCatalog(kind: MasteryKind): Promise<CatalogEntry[]> {
  const { rows } = await pool.query(`SELECT id, name, category FROM ${KIND_CONFIG[kind].catalog} ORDER BY name`)
  return rows
}

// O catálogo é uma lista curta (dezenas de linhas) e a comparação precisa da
// normalização acima, que o Postgres sem a extensão `unaccent` não faz —
// então busca tudo e compara em JS em vez de tentar uma query por nome.
export async function findCatalogByName(kind: MasteryKind, name: string): Promise<CatalogEntry | null> {
  const key = normalizeCatalogName(name)
  if (!key) return null
  const entries = await listCatalog(kind)
  return entries.find(e => normalizeCatalogName(e.name) === key) ?? null
}

/**
 * Categoria como vai ser gravada: se já existe uma com a mesma chave
 * normalizada ("espada" / "Espada " / "ESPADA"), reaproveita a grafia dela —
 * senão a validação de bônus por categoria (Fase 3) veria categorias distintas
 * onde o admin só errou a caixa.
 */
async function canonicalCategory(kind: MasteryKind, category: string): Promise<string> {
  const key = normalizeCatalogName(category)
  const { rows } = await pool.query(
    `SELECT DISTINCT category FROM ${KIND_CONFIG[kind].catalog} WHERE category IS NOT NULL`
  )
  const existing = rows.find(r => normalizeCatalogName(r.category) === key)
  return existing ? existing.category : category.trim()
}

/** `category` é obrigatória pros dois tipos (matéria passou a ter na trik_010). */
export async function createCatalogEntry(
  kind: MasteryKind, name: string, category: string
): Promise<CatalogEntry> {
  if (!category || !normalizeCatalogName(category)) throw new Error('Item do catálogo precisa de categoria')
  const { rows } = await pool.query(
    `INSERT INTO ${KIND_CONFIG[kind].catalog} (name, category) VALUES ($1, $2) RETURNING id, name, category`,
    [name.trim(), await canonicalCategory(kind, category)]
  )
  return rows[0]
}

export async function deleteCatalogEntry(kind: MasteryKind, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM ${KIND_CONFIG[kind].catalog} WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}

// ─── Curva de maestria (trik_progression) ───────────────────────────────────

/**
 * "Treinos/aulas necessários" pra sair de `level`. Devolve 0 quando não há
 * linha pro nível ou o requisito é 0 — o chamador trata 0 como "nível
 * máximo" (progresso represa, nunca sobe). Tratar 0 como "sem requisito" em
 * vez de "sobe de graça" é o que evita um laço infinito de level up.
 */
export async function getProgressionRequirement(
  kind: MasteryKind,
  level: number,
  runner: Queryable = pool
): Promise<number> {
  const { rows } = await runner.query(
    `SELECT ${KIND_CONFIG[kind].reqCol} AS req FROM trik_progression WHERE type = $1 AND level = $2`,
    [kind, level]
  )
  return Number(rows[0]?.req ?? 0)
}

// ─── Teto diário ────────────────────────────────────────────────────────────

/**
 * Unidades de maestria que o personagem JÁ creditou no mesmo dia da cena
 * `postId`, no mesmo `kind` (treino de arma e aula têm tetos separados). O
 * dia é o da postagem (`posts.created_at::date`, horário do servidor — a
 * coluna é TIMESTAMP sem fuso), não o de hoje: editar no dia seguinte um post
 * de ontem continua contando contra o teto de ontem. Exclui o próprio post,
 * pra reprocessar uma edição não contar a cena contra ela mesma.
 *
 * Fase 3: o dia é a data IN-GAME (`gameDate`, do footer); cena sem Data cai
 * na data real do post, dos dois lados da comparação. Soma as unidades
 * BRUTAS (mastery_raw) — bônus não gastam teto; cena penalizada grava 0.
 */
export async function getMasteryUsedToday(
  characterId: string,
  kind: MasteryKind,
  postId: string,
  gameDate: string | null = null
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(a.mastery_raw, a.mastery_awarded)), 0) AS used
       FROM trik_scene_awards a
       JOIN posts p ON p.id = a.post_id
      WHERE a.character_id = $1
        AND a.mastery_kind = $2
        AND a.post_id <> $3
        AND COALESCE(a.game_date, p.created_at::date)
            = COALESCE($4::date, (SELECT created_at::date FROM posts WHERE id = $3))`,
    [characterId, kind, postId, gameDate]
  )
  return Number(rows[0]?.used ?? 0)
}

// ─── Aplicar / reverter progresso ───────────────────────────────────────────

export interface MasteryResult {
  level:     number
  progress:  number
  leveledUp: boolean
}

// A unidade de treino é fracionária (842 chars = 1.68) e o progresso é
// NUMERIC(_,2). Toda a conta roda em centésimos inteiros pra não acumular
// erro de ponto flutuante (0.1 + 0.2) a cada cena.
const toCents = (v: number | string) => Math.round(Number(v) * 100)

/**
 * Soma `units` ao progresso do personagem naquela arma/matéria e sobe de
 * nível enquanto o acumulado cobrir o requisito do nível atual (o excedente
 * fica como progresso do próximo — mesmo padrão do xp de personagem).
 * SELECT ... FOR UPDATE evita race entre duas cenas do mesmo personagem.
 *
 * Sem BEGIN/COMMIT: roda dentro da transação do chamador (`client`), pra o
 * crédito de maestria entrar na mesma transação do prêmio da cena — ver
 * applySceneAward em models/trik.ts. applyMastery abaixo é o atalho com
 * transação própria.
 */
export async function applyMasteryInTx(
  client: Queryable,
  kind: MasteryKind,
  characterId: string,
  itemId: string,
  units: number,
  reqReduction = 0
): Promise<MasteryResult> {
  const { progress: table, itemCol } = KIND_CONFIG[kind]

  await client.query(
    `INSERT INTO ${table} (character_id, ${itemCol}) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [characterId, itemId]
  )
  const { rows } = await client.query(
    `SELECT level, progress FROM ${table} WHERE character_id = $1 AND ${itemCol} = $2 FOR UPDATE`,
    [characterId, itemId]
  )
  let level     = Number(rows[0].level)
  let cents     = toCents(rows[0].progress) + toCents(units)
  let leveledUp = false

  while (true) {
    const req = await getProgressionRequirement(kind, level, client)
    if (req <= 0) break // sem curva pro nível atual — nível máximo, progresso represa
    // Fase 3: reduz_requisito, com piso 1 (plano §2.1).
    const reqCents = toCents(Math.max(1, req - reqReduction))
    if (cents < reqCents) break
    cents -= reqCents
    level += 1
    leveledUp = true
  }

  await client.query(
    `UPDATE ${table} SET level = $3, progress = $4, updated_at = NOW()
      WHERE character_id = $1 AND ${itemCol} = $2`,
    [characterId, itemId, level, cents / 100]
  )

  return { level, progress: cents / 100, leveledUp }
}

export async function applyMastery(
  kind: MasteryKind,
  characterId: string,
  itemId: string,
  units: number
): Promise<MasteryResult> {
  const client = await (db as any).connect()
  try {
    await client.query('BEGIN')
    const result = await applyMasteryInTx(client, kind, characterId, itemId, units)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Desconta o progresso creditado por uma cena (PUT/DELETE /posts/:id) SEM
 * desfazer nível já ganho (mesma política de revertSceneAward pro xp de
 * personagem) e SEM piso em 0: se a cena tinha empurrado o personagem pra um
 * nível novo, o progresso fica NEGATIVO — uma "dívida" que as próximas cenas
 * pagam antes de contar pro nível seguinte. Com piso em 0, editar um post que
 * subiu de nível devolvia o crédito de graça no reprocessamento.
 */
export async function revertMastery(
  kind: MasteryKind,
  characterId: string,
  itemId: string,
  units: number,
  runner: Queryable = pool
): Promise<void> {
  const { progress: table, itemCol } = KIND_CONFIG[kind]
  await runner.query(
    `UPDATE ${table} SET progress = progress - $3, updated_at = NOW()
      WHERE character_id = $1 AND ${itemCol} = $2`,
    [characterId, itemId, units]
  )
}
