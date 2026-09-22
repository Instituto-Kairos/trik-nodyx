// Módulo RPG (trik) — models/trikMastery.ts (catálogo, acúmulo/level up/revert
// de maestria, teto diário) e o award de maestria em models/trik.ts
// (applySceneAward / revertSceneAward). Só o `db` é mockado: a lógica de level
// up roda de verdade contra as respostas que o mock devolve pra cada query.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockClient, mockDb } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() }
  const mockDb = { query: vi.fn(), connect: vi.fn() }
  return { mockClient, mockDb }
})

vi.mock('../config/database', () => ({ db: mockDb }))

import {
  normalizeCatalogName, findCatalogByName, listCatalog, createCatalogEntry, deleteCatalogEntry, getProgressionRequirement,
  applyMastery, revertMastery, getMasteryUsedToday,
} from '../models/trikMastery'
import { revertSceneAward, applySceneAward } from '../models/trik'

/** Simula o Postgres pro laço de applyMastery: `current` é a linha atual de
 *  progresso e `reqs` mapeia nível → requisito (nível fora do mapa = sem linha). */
function setupClient(current: { level: number; progress: string }, reqs: Record<number, number>) {
  const updates: any[][] = []
  mockClient.query.mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM trik_progression')) {
      const level = params[1]
      return { rows: level in reqs ? [{ req: reqs[level] }] : [] }
    }
    if (sql.includes('FOR UPDATE')) return { rows: [current] }
    if (sql.startsWith('UPDATE')) updates.push(params)
    return { rows: [] }
  })
  return updates
}

const clientSqls = () => mockClient.query.mock.calls.map(c => c[0] as string)

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.connect.mockResolvedValue(mockClient)
})

describe('normalizeCatalogName', () => {
  it('minúsculo, sem acento, só letras e dígitos', () => {
    expect(normalizeCatalogName('Espada Longa')).toBe('espadalonga')
    expect(normalizeCatalogName('  espada   longa ')).toBe('espadalonga')
    expect(normalizeCatalogName('História')).toBe('historia')
    expect(normalizeCatalogName('Arco & Flecha!')).toBe('arcoflecha') // símbolos são descartados
  })

  it('só símbolos → string vazia (nunca casaria com hashtag alguma)', () => {
    expect(normalizeCatalogName('!!!')).toBe('')
  })
})

describe('findCatalogByName', () => {
  it('acha "Espada Longa" pela hashtag #espadalonga (sem espaço, sem caixa)', async () => {
    mockDb.query.mockResolvedValue({ rows: [{ id: 'w1', name: 'Espada Longa' }, { id: 'w2', name: 'Arco' }] })
    expect(await findCatalogByName('weapon', 'espadalonga')).toEqual({ id: 'w1', name: 'Espada Longa' })
    expect(await findCatalogByName('weapon', 'ESPADALONGA')).toEqual({ id: 'w1', name: 'Espada Longa' })
  })

  it('acha matéria com acento pela hashtag sem acento', async () => {
    mockDb.query.mockResolvedValue({ rows: [{ id: 'k1', name: 'História' }] })
    expect(await findCatalogByName('knowledge', 'historia')).toEqual({ id: 'k1', name: 'História' })
  })

  it('cada tipo consulta o SEU catálogo', async () => {
    mockDb.query.mockResolvedValue({ rows: [] })
    await findCatalogByName('weapon', 'espada')
    await findCatalogByName('knowledge', 'historia')
    expect(mockDb.query.mock.calls[0][0]).toContain('trik_weapons')
    expect(mockDb.query.mock.calls[1][0]).toContain('trik_knowledges')
  })

  it('sem match → null', async () => {
    mockDb.query.mockResolvedValue({ rows: [{ id: 'w1', name: 'Espada' }] })
    expect(await findCatalogByName('weapon', 'lanca')).toBeNull()
  })

  it('nome vazio/só símbolos → null sem nem consultar o banco', async () => {
    expect(await findCatalogByName('weapon', '!!!')).toBeNull()
    expect(mockDb.query).not.toHaveBeenCalled()
  })
})

describe('listCatalog', () => {
  it('arma traz a categoria; matéria não tem a coluna', async () => {
    mockDb.query.mockResolvedValue({ rows: [] })
    await listCatalog('weapon')
    await listCatalog('knowledge')
    expect(mockDb.query.mock.calls[0][0]).toContain('id, name, category')
    expect(mockDb.query.mock.calls[1][0]).not.toContain('category')
  })
})

describe('createCatalogEntry', () => {
  it('arma: grava nome e categoria', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [] }) // categorias existentes
      .mockResolvedValueOnce({ rows: [{ id: 'w1', name: 'Espada Longa', category: 'Espadas' }] })

    expect(await createCatalogEntry('weapon', ' Espada Longa ', 'Espadas'))
      .toEqual({ id: 'w1', name: 'Espada Longa', category: 'Espadas' })

    const [sql, params] = mockDb.query.mock.calls[1]
    expect(sql).toContain('INSERT INTO trik_weapons (name, category)')
    expect(params).toEqual(['Espada Longa', 'Espadas'])
  })

  it('arma: reaproveita a grafia de uma categoria já cadastrada (caixa/acento/espaço)', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ category: 'Armas de Haste' }, { category: 'Espadas' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'w2', name: 'Lança', category: 'Armas de Haste' }] })

    await createCatalogEntry('weapon', 'Lança', '  armas   de haste ')

    expect(mockDb.query.mock.calls[1][1]).toEqual(['Lança', 'Armas de Haste'])
  })

  it('arma sem categoria (ou só símbolos) → erro, sem tocar no banco', async () => {
    await expect(createCatalogEntry('weapon', 'Espada')).rejects.toThrow('categoria')
    await expect(createCatalogEntry('weapon', 'Espada', '!!!')).rejects.toThrow('categoria')
    expect(mockDb.query).not.toHaveBeenCalled()
  })

  it('matéria: só nome, ignora categoria', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'k1', name: 'História' }] })

    await createCatalogEntry('knowledge', 'História', 'ignorada')

    expect(mockDb.query).toHaveBeenCalledTimes(1)
    const [sql, params] = mockDb.query.mock.calls[0]
    expect(sql).toContain('trik_knowledges')
    expect(sql).not.toContain('category')
    expect(params).toEqual(['História'])
  })
})

describe('deleteCatalogEntry', () => {
  it('true quando removeu, false quando o id não existia', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    expect(await deleteCatalogEntry('weapon', 'w1')).toBe(true)
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    expect(await deleteCatalogEntry('weapon', 'w1')).toBe(false)
  })
})

describe('getProgressionRequirement', () => {
  it('lê req_mastery pra weapon e req_education pra knowledge', async () => {
    mockDb.query.mockResolvedValue({ rows: [{ req: 5 }] })
    await getProgressionRequirement('weapon', 1)
    expect(mockDb.query.mock.calls[0][0]).toContain('req_mastery')
    await getProgressionRequirement('knowledge', 1)
    expect(mockDb.query.mock.calls[1][0]).toContain('req_education')
  })

  it('sem linha pro nível → 0 (nível máximo)', async () => {
    mockDb.query.mockResolvedValue({ rows: [] })
    expect(await getProgressionRequirement('weapon', 99)).toBe(0)
  })
})

describe('getMasteryUsedToday', () => {
  it('soma o mastery_awarded do mesmo personagem, tipo e dia — sem contar o próprio post', async () => {
    mockDb.query.mockResolvedValue({ rows: [{ used: '1.68' }] })
    expect(await getMasteryUsedToday('char-1', 'weapon', 'post-1')).toBe(1.68)

    const [sql, params] = mockDb.query.mock.calls[0]
    expect(params).toEqual(['char-1', 'weapon', 'post-1'])
    expect(sql).toContain('a.mastery_kind = $2')  // tipo separado: arma não conta aula
    expect(sql).toContain('a.post_id <> $3')      // reprocessar edição não conta a cena contra ela mesma
    expect(sql).toContain('created_at::date')     // dia da POSTAGEM, não "hoje"
  })

  it('sem nenhuma cena de treino no dia → 0', async () => {
    mockDb.query.mockResolvedValue({ rows: [{ used: '0' }] })
    expect(await getMasteryUsedToday('char-1', 'knowledge', 'post-1')).toBe(0)
    mockDb.query.mockResolvedValue({ rows: [] })
    expect(await getMasteryUsedToday('char-1', 'knowledge', 'post-1')).toBe(0)
  })
})

describe('applyMastery', () => {
  it('acumula sem subir de nível quando não cobre o requisito', async () => {
    const updates = setupClient({ level: 1, progress: '1.00' }, { 1: 5 })
    const result = await applyMastery('weapon', 'char-1', 'w1', 1.68)
    expect(result).toEqual({ level: 1, progress: 2.68, leveledUp: false })
    expect(updates[0]).toEqual(['char-1', 'w1', 1, 2.68])
  })

  it('sobe de nível e leva o excedente pro próximo (carry)', async () => {
    const updates = setupClient({ level: 1, progress: '3.00' }, { 1: 5, 2: 8 })
    const result = await applyMastery('weapon', 'char-1', 'w1', 3)
    expect(result).toEqual({ level: 2, progress: 1, leveledUp: true })
    expect(updates[0]).toEqual(['char-1', 'w1', 2, 1])
  })

  it('progresso EXATAMENTE igual ao requisito também sobe (>=)', async () => {
    setupClient({ level: 1, progress: '2.00' }, { 1: 5, 2: 8 })
    expect(await applyMastery('weapon', 'char-1', 'w1', 3)).toEqual({ level: 2, progress: 0, leveledUp: true })
  })

  it('pode subir mais de um nível numa cena só', async () => {
    setupClient({ level: 1, progress: '0.00' }, { 1: 5, 2: 8, 3: 10 })
    // 20 - 5 = 15; 15 - 8 = 7; nível 3 pede 10 → para
    expect(await applyMastery('weapon', 'char-1', 'w1', 20)).toEqual({ level: 3, progress: 7, leveledUp: true })
  })

  it('nível sem linha na curva = máximo: progresso represa, não sobe', async () => {
    const updates = setupClient({ level: 3, progress: '9.00' }, { 1: 5, 2: 8 })
    expect(await applyMastery('weapon', 'char-1', 'w1', 3)).toEqual({ level: 3, progress: 12, leveledUp: false })
    expect(updates[0][2]).toBe(3)
  })

  it('requisito 0 na curva NÃO vira nível grátis em laço infinito — trata como máximo', async () => {
    setupClient({ level: 1, progress: '0.00' }, { 1: 0 })
    expect(await applyMastery('weapon', 'char-1', 'w1', 3)).toEqual({ level: 1, progress: 3, leveledUp: false })
  })

  it('soma em centésimos: 0.10 + 0.20 = 0.30 exato (sem 0.30000000000000004)', async () => {
    const updates = setupClient({ level: 1, progress: '0.10' }, { 1: 5 })
    await applyMastery('weapon', 'char-1', 'w1', 0.2)
    expect(updates[0][3]).toBe(0.3)
  })

  it('cada tipo usa a tabela de progresso e a coluna de requisito próprias', async () => {
    for (const [kind, table, other, reqCol] of [
      ['weapon',    'trik_character_weapon_progress',    'trik_character_knowledge_progress', 'req_mastery'],
      ['knowledge', 'trik_character_knowledge_progress', 'trik_character_weapon_progress',    'req_education'],
    ] as const) {
      mockClient.query.mockClear()
      setupClient({ level: 1, progress: '0.00' }, { 1: 5 })
      await applyMastery(kind, 'char-1', 'item-1', 1)
      expect(clientSqls().some(s => s.includes(table))).toBe(true)
      expect(clientSqls().some(s => s.includes(other))).toBe(false)
      expect(clientSqls().some(s => s.includes(reqCol))).toBe(true)
    }
  })

  it('erro no meio → ROLLBACK, propaga o erro e devolve o client ao pool', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) throw new Error('boom')
      return { rows: [] }
    })
    await expect(applyMastery('weapon', 'char-1', 'w1', 1)).rejects.toThrow('boom')
    expect(clientSqls()).toContain('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalled()
  })
})

describe('revertMastery', () => {
  it('desconta SEM piso em 0 (progresso pode ficar negativo = dívida) e não mexe em level', async () => {
    mockDb.query.mockResolvedValue({ rows: [] })
    await revertMastery('weapon', 'char-1', 'w1', 1.68)
    const [sql, params] = mockDb.query.mock.calls[0]
    // Com GREATEST(0, …) editar um post que subiu de nível devolvia o crédito de graça.
    expect(sql).toContain('progress = progress - $3')
    expect(sql).not.toContain('GREATEST')
    expect(sql).not.toContain('level')
    expect(params).toEqual(['char-1', 'w1', 1.68])
  })

  it('usa o client da transação quando recebe um', async () => {
    const runner = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await revertMastery('knowledge', 'char-1', 'k1', 1, runner)
    expect(runner.query).toHaveBeenCalledOnce()
    expect(runner.query.mock.calls[0][0]).toContain('trik_character_knowledge_progress')
    expect(mockDb.query).not.toHaveBeenCalled()
  })
})

describe('applySceneAward — prêmio + xp + maestria numa transação só', () => {
  // Simula o Postgres pras queries do prêmio: alreadyAwarded faz o INSERT ... ON
  // CONFLICT DO NOTHING não devolver linha; xpGoal é a meta do nível 1 do personagem
  // (sem ele não há curva → nível máximo); a maestria nunca tem curva aqui (nível máx.).
  function setupAwardTx(opts: { alreadyAwarded?: boolean; xpGoal?: number; failOnMastery?: boolean } = {}) {
    mockClient.query.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('INSERT INTO trik_scene_awards')) return { rows: opts.alreadyAwarded ? [] : [{ id: 'a1' }] }
      if (sql.includes("type = 'character'")) {
        return {
          rows: opts.xpGoal && params[0] === 1
            ? [{ goal_xp: String(opts.xpGoal), reward_conduct: 0, reward_principles: 0, reward_preferences: 0, reward_goal: false }]
            : [],
        }
      }
      if (sql.includes('FROM trik_progression')) return { rows: [] }
      if (sql.includes('FROM trik_character_progress') && sql.includes('FOR UPDATE')) {
        return { rows: [{ level: 1, progress_xp: '0', points_conduct: 0, points_principles: 0, points_preferences: 0, has_goal: false }] }
      }
      if (sql.includes('FOR UPDATE')) {
        if (opts.failOnMastery) throw new Error('boom na maestria')
        return { rows: [{ level: 1, progress: '0.00' }] }
      }
      if (sql.startsWith('UPDATE')) return { rows: [{ level: 1 }] }
      return { rows: [] }
    })
  }

  it('cena normal: grava o prêmio e o xp numa transação, sem tocar em maestria', async () => {
    setupAwardTx()

    const result = await applySceneAward('char-1', 'post-1', 12)

    expect(result).toEqual({ leveledUp: false })
    const sqls = clientSqls()
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls.at(-1)).toBe('COMMIT')
    expect(sqls.filter(s => s === 'BEGIN')).toHaveLength(1) // UMA transação
    const insert = mockClient.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO trik_scene_awards'))!
    expect(insert[0]).toContain('ON CONFLICT (post_id) DO NOTHING')
    expect(insert[1]).toEqual(['char-1', 'post-1', 12, null, null, 0, null])
    expect(sqls.some(s => s.includes('weapon_progress') || s.includes('knowledge_progress'))).toBe(false)
    expect(mockDb.query).not.toHaveBeenCalled() // tudo pelo client, nada solto no pool
    expect(mockClient.release).toHaveBeenCalled()
  })

  it.each([
    ['weapon',    'w1', 'trik_character_weapon_progress',    ['char-1', 'post-1', 2, 'w1', null, 1.2, 'weapon']],
    ['knowledge', 'k1', 'trik_character_knowledge_progress', ['char-1', 'post-1', 2, null, 'k1', 1.2, 'knowledge']],
  ] as const)('com %s: grava o item, credita a maestria na MESMA transação e devolve o resultado', async (kind, itemId, table, insertParams) => {
    setupAwardTx()

    const result = await applySceneAward('char-1', 'post-1', 2, { kind, itemId, units: 1.2 })

    expect(result).toEqual({ leveledUp: false, mastery: { level: 1, progress: 1.2, leveledUp: false } })
    const insert = mockClient.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO trik_scene_awards'))!
    expect(insert[1]).toEqual(insertParams)
    expect(clientSqls().some(s => s.includes(table))).toBe(true)
    expect(clientSqls().filter(s => s === 'BEGIN')).toHaveLength(1)
    expect(clientSqls().at(-1)).toBe('COMMIT')
  })

  it('cruzar a meta do nível de personagem devolve leveledUp', async () => {
    setupAwardTx({ xpGoal: 10 })
    expect(await applySceneAward('char-1', 'post-1', 12)).toEqual({ leveledUp: true })
  })

  it('post que JÁ tem prêmio (edições concorrentes) → null, ROLLBACK e nada é creditado', async () => {
    setupAwardTx({ alreadyAwarded: true })

    const result = await applySceneAward('char-1', 'post-1', 12, { kind: 'weapon', itemId: 'w1', units: 1 })

    expect(result).toBeNull()
    const sqls = clientSqls()
    expect(sqls.at(-1)).toBe('ROLLBACK')
    expect(sqls).not.toContain('COMMIT')
    expect(sqls.some(s => s.includes('trik_character_progress') || s.includes('weapon_progress'))).toBe(false)
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('falha no crédito de maestria desfaz TUDO (o prêmio não fica sem xp), propaga e libera o client', async () => {
    setupAwardTx({ failOnMastery: true })

    await expect(applySceneAward('char-1', 'post-1', 2, { kind: 'weapon', itemId: 'w1', units: 1 }))
      .rejects.toThrow('boom na maestria')

    expect(clientSqls().at(-1)).toBe('ROLLBACK')
    expect(clientSqls()).not.toContain('COMMIT')
    expect(mockClient.release).toHaveBeenCalled()
  })
})

describe('revertSceneAward', () => {
  // O DELETE ... RETURNING devolve a linha do prêmio (ou nada, se o post não tem).
  function setupAward(award: Record<string, unknown> | null) {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM trik_scene_awards')) return { rows: award ? [award] : [] }
      return { rows: [] }
    })
  }

  it('pega e apaga o prêmio numa só query (DELETE ... RETURNING): dois reverts não descontam duas vezes', async () => {
    setupAward({ character_id: 'char-1', xp_awarded: 12, weapon_id: null, knowledge_id: null, mastery_awarded: '0.00', mastery_kind: null })
    await revertSceneAward('post-1')

    const deleteCall = mockClient.query.mock.calls.find(c => (c[0] as string).includes('DELETE FROM trik_scene_awards'))!
    expect(deleteCall[0]).toContain('RETURNING')
    expect(deleteCall[1]).toEqual(['post-1'])
    // sem SELECT solto do prêmio (era a janela de corrida)
    expect(clientSqls().some(s => s.startsWith('SELECT') && s.includes('trik_scene_awards'))).toBe(false)
  })

  it('desconta o xp SEM piso em 0: cena que cruzou o nível vira progresso negativo (dívida)', async () => {
    setupAward({ character_id: 'char-1', xp_awarded: 500, weapon_id: null, knowledge_id: null, mastery_awarded: '0.00', mastery_kind: null })
    await revertSceneAward('post-1')

    const xpCall = mockClient.query.mock.calls.find(c => (c[0] as string).includes('UPDATE trik_character_progress'))!
    expect(xpCall[0]).toContain('progress_xp = progress_xp - $2')
    expect(xpCall[0]).not.toContain('GREATEST')
    expect(xpCall[1]).toEqual(['char-1', 500])
  })

  it('award com arma: desconta xp E maestria na MESMA transação', async () => {
    setupAward({ character_id: 'char-1', xp_awarded: 2, weapon_id: 'w1', knowledge_id: null, mastery_awarded: '1.20', mastery_kind: 'weapon' })
    await revertSceneAward('post-1')

    const all = clientSqls()
    expect(all[0]).toBe('BEGIN')
    expect(all.some(s => s.includes('trik_character_progress') && s.includes('progress_xp'))).toBe(true)
    const weaponCall = mockClient.query.mock.calls.find(c => (c[0] as string).includes('trik_character_weapon_progress'))!
    expect(weaponCall[1]).toEqual(['char-1', 'w1', 1.2])
    expect(all.at(-1)).toBe('COMMIT')
    // tudo pelo client da transação — nada no pool
    expect(mockDb.query).not.toHaveBeenCalled()
  })

  it('award com matéria: desconta na tabela de knowledge', async () => {
    setupAward({ character_id: 'char-1', xp_awarded: 2, weapon_id: null, knowledge_id: 'k1', mastery_awarded: '3.00', mastery_kind: 'knowledge' })
    await revertSceneAward('post-1')
    const call = mockClient.query.mock.calls.find(c => (c[0] as string).includes('trik_character_knowledge_progress'))!
    expect(call[1]).toEqual(['char-1', 'k1', 3])
    expect(clientSqls().some(s => s.includes('trik_character_weapon_progress'))).toBe(false)
  })

  it('award antigo (sem maestria, mastery_awarded = 0): reverte só o xp, sem erro', async () => {
    setupAward({ character_id: 'char-1', xp_awarded: 12, weapon_id: null, knowledge_id: null, mastery_awarded: '0.00', mastery_kind: null })
    await revertSceneAward('post-1')
    expect(clientSqls().some(s => s.includes('weapon_progress') || s.includes('knowledge_progress'))).toBe(false)
    expect(clientSqls().at(-1)).toBe('COMMIT')
  })

  it('arma apagada do catálogo (weapon_id virou NULL, mastery > 0): não tenta reverter nada', async () => {
    setupAward({ character_id: 'char-1', xp_awarded: 2, weapon_id: null, knowledge_id: null, mastery_awarded: '1.20', mastery_kind: 'weapon' })
    await revertSceneAward('post-1')
    expect(clientSqls().some(s => s.includes('weapon_progress') || s.includes('knowledge_progress'))).toBe(false)
  })

  it('post sem prêmio: não desconta nada (só o DELETE que não achou linha)', async () => {
    setupAward(null)
    await revertSceneAward('post-1')
    expect(clientSqls().filter(s => s.startsWith('UPDATE'))).toEqual([])
    expect(clientSqls().at(-1)).toBe('COMMIT')
  })

  it('erro no meio → ROLLBACK, propaga e libera o client', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('DELETE FROM trik_scene_awards')) throw new Error('boom')
      return { rows: [] }
    })
    await expect(revertSceneAward('post-1')).rejects.toThrow('boom')
    expect(clientSqls().at(-1)).toBe('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalled()
  })
})
