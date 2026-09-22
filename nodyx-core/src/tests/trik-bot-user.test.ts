// Módulo RPG (trik) — services/trik/bot.ts › ensureTrikBotUser.
// Achado da revisão de 2026-09-20: o INSERT usava `ON CONFLICT (username) DO UPDATE SET is_system = true`,
// então uma conta HUMANA já chamada "Trik" virava, sem aviso, o bot de sistema (e o bot passava a falar em nome dela).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../config/database', () => ({ db: { query: vi.fn() } }))
vi.mock('bcrypt', () => ({ default: { hash: vi.fn().mockResolvedValue('hash-fake') } }))
// O resto do bot (chat, reações, push) não é exercitado aqui — só precisa importar sem puxar socket/redis.
vi.mock('../models/channel',        () => ({}))
vi.mock('../models/post',           () => ({}))
vi.mock('../models/reaction',       () => ({}))
vi.mock('../models/notification',   () => ({}))
vi.mock('../socket/io',             () => ({ io: null }))
vi.mock('../utils/sanitize',        () => ({ sanitize: (s: string) => s }))
vi.mock('../utils/mentions',        () => ({ resolveMentions: vi.fn() }))
vi.mock('../routes/notifications',  () => ({ sendPushToUser: vi.fn() }))
vi.mock('../i18n/serverStrings',    () => ({ resolveServerLocale: vi.fn(), pushStrings: vi.fn() }))

const BOT_ID = 'bot-uuid'

/** O cache do bot (_botUserId) vive no módulo: recarrega tudo a cada teste. */
async function load() {
  vi.resetModules()
  const { db } = await import('../config/database')
  const { ensureTrikBotUser } = await import('../services/trik/bot')
  return { db: vi.mocked(db.query), ensureTrikBotUser }
}

const sqlsOf = (query: ReturnType<typeof vi.fn>) => query.mock.calls.map(c => c[0] as string)

describe('ensureTrikBotUser', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('bot de sistema já existe: devolve o id sem inserir nada', async () => {
    const { db, ensureTrikBotUser } = await load()
    db.mockResolvedValueOnce({ rows: [{ id: BOT_ID }] } as any)

    expect(await ensureTrikBotUser()).toBe(BOT_ID)

    expect(db).toHaveBeenCalledOnce()
    expect(sqlsOf(db)[0]).toMatch(/is_system = true AND username = \$1/) // só enxerga conta DE SISTEMA
  })

  it('username livre: cria o bot com ON CONFLICT DO NOTHING e o coloca na comunidade', async () => {
    const { db, ensureTrikBotUser } = await load()
    db.mockResolvedValueOnce({ rows: [] } as any)                    // SELECT: não há bot
      .mockResolvedValueOnce({ rows: [{ id: BOT_ID }] } as any)      // INSERT ... RETURNING id
      .mockResolvedValueOnce({ rows: [{ id: 'community-1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)                    // INSERT community_members

    expect(await ensureTrikBotUser()).toBe(BOT_ID)

    const insert = sqlsOf(db)[1]
    expect(insert).toContain('INSERT INTO users')
    expect(insert).toContain('ON CONFLICT (username) DO NOTHING')
    expect(insert).not.toContain('DO UPDATE')
    expect(sqlsOf(db)[3]).toContain('INSERT INTO community_members')
  })

  it('já existe uma conta HUMANA "Trik": não a promove a bot — devolve null e avisa no log', async () => {
    const { db, ensureTrikBotUser } = await load()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.mockResolvedValueOnce({ rows: [] } as any)   // SELECT: nenhuma conta DE SISTEMA chamada Trik
      .mockResolvedValueOnce({ rows: [] } as any)   // INSERT ... DO NOTHING: conflito, sem linha

    expect(await ensureTrikBotUser()).toBeNull()

    expect(sqlsOf(db).some(s => /is_system\s*=\s*true/.test(s) && s.includes('DO UPDATE'))).toBe(false)
    expect(sqlsOf(db).some(s => s.includes('INSERT INTO community_members'))).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('já é de uma conta que não é do sistema'))
  })
})
