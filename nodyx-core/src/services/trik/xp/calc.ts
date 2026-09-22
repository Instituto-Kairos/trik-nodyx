/**
 * Módulo RPG (trik) — Fluxo 1 (Fase 2): cálculo de XP por tamanho de cena.
 * Ver plans/fase-dois.md, seção "Fluxo 1", item 3 — regra confirmada com o
 * usuário: acima de 800 caracteres a conta INTEIRA usa a taxa 1.8x (não é
 * progressivo, não é "os primeiros 800 numa taxa, o excedente noutra").
 */

export function calculateSceneXp(cenaLength: number): number {
  if (cenaLength < 500) return 0
  const base = (cenaLength / 500) * 10
  return Math.round(cenaLength > 800 ? base * 1.8 : base)
}

// ─── Cenas de treino/estudo (#treino / #aula) ───────────────────────────────
// Ver plans/TRIK-PROJECT.md, seção 4 (fluxo do "DETECTAR BUFFS"). Sem
// bônus de aptidão/#com ainda — isso é Fase 3.

/** Caracteres de cena que equivalem a 1.0 unidade de treino ("treino leve"). */
export const MASTERY_UNIT_CHARS = 500
/** 3.0 unidades (1500 chars) = "treino pesado": o máximo que um personagem
 *  pontua POR DIA (buffs não passam disso), somando todas as cenas do dia. */
export const DAILY_MASTERY_CAP_UNITS = 3

const round2 = (n: number) => Math.round(n * 100) / 100

/** Quanto ainda resta do teto diário depois de `usedUnits` já creditadas
 *  hoje (0 = teto atingido). */
export function remainingDailyMastery(usedUnits: number): number {
  return round2(Math.max(0, DAILY_MASTERY_CAP_UNITS - usedUnits))
}

/** Unidades de maestria de uma cena: chars / 500 (842 chars → 1.68), limitadas
 *  ao que ainda resta do teto diário — sozinha, uma cena rende no máximo 3.0. */
export function calculateMasteryUnits(
  cenaLength: number,
  remainingUnits: number = DAILY_MASTERY_CAP_UNITS
): number {
  return round2(Math.max(0, Math.min(cenaLength / MASTERY_UNIT_CHARS, remainingUnits)))
}

/**
 * XP de personagem de uma cena com #treino/#aula válido: o xp normal
 * multiplicado por 0.2 (até 1000 chars) ou 0.5 (de 1001 a 1500). Se a cena é
 * maior do que o que ainda cabe no teto diário (`remainingUnits`, 3.0 = 1500
 * chars num dia sem treino anterior), ela "não é mais treino pra fins de xp de
 * personagem" e conta o xp cheio — mesma regra do doc pra cenas de treino
 * acima do limite ("contam apenas pra desenvolvimento de personagem, ou
 * seja, xp básico de cena").
 */
export function calculateTrainingSceneXp(
  cenaLength: number,
  remainingUnits: number = DAILY_MASTERY_CAP_UNITS
): number {
  const base = calculateSceneXp(cenaLength)
  if (cenaLength > remainingUnits * MASTERY_UNIT_CHARS) return base
  return Math.round(base * (cenaLength <= 1000 ? 0.2 : 0.5))
}
