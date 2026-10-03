import type { Prisma, PrismaClient } from '@prisma/client'
import { TgError, type Telegram } from './tg'

export type StaffRole = 'support' | 'admin' | 'owner'

/** OWNER задаются переменной ADMIN_TELEGRAM_IDS (команда проекта), остальные роли хранятся в БД. */
export function ownerIds(env: NodeJS.ProcessEnv): Set<number> {
  return new Set(
    (env.ADMIN_TELEGRAM_IDS ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  )
}

export function createStaff(prisma: PrismaClient, tg: Telegram, env: NodeJS.ProcessEnv) {
  const owners = ownerIds(env)

  async function roleOf(tgId: number): Promise<StaffRole | null> {
    if (owners.has(tgId)) return 'owner'
    const user = await prisma.user.findUnique({ where: { tgId: BigInt(tgId) }, select: { role: true } })
    return user && user.role !== 'user' ? user.role : null
  }

  async function staffIds(min: StaffRole = 'support'): Promise<number[]> {
    const order: StaffRole[] = ['support', 'admin', 'owner']
    const allowed = order.slice(order.indexOf(min))
    const rows = await prisma.user.findMany({ where: { role: { in: allowed } }, select: { tgId: true } })
    return [...new Set([...owners, ...rows.map((r) => Number(r.tgId))])]
  }

  /** Сообщение пользователю. Если он не запускал бота или заблокировал его, молча пропускаем. */
  async function notify(tgId: bigint | number, text: string) {
    if (!tg.enabled) return
    try {
      await tg.send(tgId, text)
    } catch (e) {
      if (!(e instanceof TgError)) console.warn('[notify]', (e as Error).message)
    }
  }

  async function notifyStaff(text: string, min: StaffRole = 'admin') {
    for (const id of await staffIds(min)) await notify(id, text)
  }

  async function audit(adminTgId: number, action: string, target?: string, details?: Record<string, unknown>) {
    await prisma.auditLog
      .create({ data: { adminTgId: BigInt(adminTgId), action, target, details: details as Prisma.InputJsonValue | undefined } })
      .catch(() => undefined)
  }

  return { roleOf, staffIds, notify, notifyStaff, audit, owners }
}

export type Staff = ReturnType<typeof createStaff>

/** Какие разделы админ-меню видит роль (ТЗ 6.3). */
export const ACCESS: Record<string, StaffRole[]> = {
  dash: ['support', 'admin', 'owner'],
  users: ['support', 'admin', 'owner'],
  subs: ['admin', 'owner'],
  pay: ['owner'],
  ref: ['owner'],
  srv: ['admin', 'owner'],
  promo: ['owner'],
  sup: ['support', 'admin', 'owner'],
  bc: ['admin', 'owner'],
  set: ['owner'],
  logs: ['owner'],
  // ТЗ v6.3
  tr: ['admin', 'owner'],
  ach: ['admin', 'owner'],
  st: ['admin', 'owner'],
  rv: ['admin', 'owner'],
}

export const can = (role: StaffRole, section: string) => (ACCESS[section] ?? ['owner']).includes(role)
