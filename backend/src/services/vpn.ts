import type { PrismaClient, SubscriptionPlan, User } from '@prisma/client'
import type { PanelProvider } from '@/panel'

const DAY = 24 * 60 * 60 * 1000


// Лимиты тарифов (ТЗ раздел 5). null = без ограничения.
export const PLAN_LIMITS: Record<SubscriptionPlan, { devices: number | null; trafficGb: number | null }> = {
  free: { devices: 1, trafficGb: 5 },
  start: { devices: 3, trafficGb: 100 },
  pro: { devices: 5, trafficGb: null },
}

/**
 * Единая точка, через которую бизнес-логика выдаёт или продлевает VPN.
 * Сначала создаём/обновляем клиента на панели, потом пишем подписку в БД:
 * если панель недоступна, пользователь не получит «оплачено, но не работает».
 */
export function createVpnService(prisma: PrismaClient, panel: PanelProvider) {
  async function activate(user: User, plan: SubscriptionPlan, days: number, status: 'trial' | 'active') {
    const current = await prisma.subscription.findFirst({
      where: { userId: user.id, status: { in: ['trial', 'active'] }, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    })
    // Продление: добавляем дни к текущему сроку, а не с сегодняшнего дня.
    const from = current ? current.expiresAt.getTime() : Date.now()
    const expiresAt = new Date(from + days * DAY)
    const limits = PLAN_LIMITS[plan]

    await panel.provision({
      tgId: Number(user.tgId),
      expiresAt,
      trafficLimitGb: limits.trafficGb,
      deviceLimit: limits.devices,
    })

    return prisma.subscription.create({
      data: { userId: user.id, plan, status, expiresAt },
    })
  }

  /**
   * Команда проекта (ADMIN_TELEGRAM_IDS): постоянный «Премиум» без оплаты.
   * Срок год вперёд, продлеваем автоматически при входе, когда осталось меньше 60 дней.
   */
  async function ensureAdmin(user: User) {
    const current = await prisma.subscription.findFirst({
      where: { userId: user.id, plan: 'pro', status: 'active' },
      orderBy: { expiresAt: 'desc' },
    })
    if (current && current.expiresAt.getTime() - Date.now() > 60 * DAY) {
      // Срок большой, но инбаунды могли добавиться: обновляем клиента на панели с тем же сроком.
      await panel.provision({ tgId: Number(user.tgId), expiresAt: current.expiresAt, trafficLimitGb: null, deviceLimit: null })
      return current
    }
    const expiresAt = new Date(Date.now() + 365 * DAY)
    await panel.provision({ tgId: Number(user.tgId), expiresAt, trafficLimitGb: null, deviceLimit: null })
    return prisma.subscription.create({ data: { userId: user.id, plan: 'pro', status: 'active', expiresAt } })
  }

  /** Текущая действующая подписка (последняя по сроку). */
  async function current(userId: bigint) {
    return prisma.subscription.findFirst({
      where: { userId, status: { in: ['trial', 'active'] }, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    })
  }

  /**
   * Подарочные дни (бонус уровня, ручное продление из админки).
   * Премиум не понижаем до Старта: если сейчас Премиум, продлеваем Премиум.
   */
  async function grant(user: User, plan: SubscriptionPlan, days: number) {
    const cur = await current(user.id)
    const effective: SubscriptionPlan = cur?.plan === 'pro' ? 'pro' : plan
    return activate(user, effective, days, 'active')
  }

  return {
    activate,
    ensureAdmin,
    grant,
    current,

    async startTrial(user: User, days: number, force = false) {
      if (user.trialUsed && !force) return null
      const sub = await activate(user, 'start', days, 'trial')
      await prisma.user.update({ where: { id: user.id }, data: { trialUsed: true } })
      return sub
    },

    /** Досрочно завершить подписку (админ) и отключить клиента на панели. */
    async cancel(user: User) {
      await prisma.subscription.updateMany({
        where: { userId: user.id, status: { in: ['trial', 'active'] } },
        data: { status: 'expired', expiresAt: new Date() },
      })
      await panel.disable(Number(user.tgId)).catch(() => undefined)
    },

    /** Раз в N минут: отключить на панели тех, у кого подписка закончилась. */
    async expireOverdue() {
      const overdue = await prisma.subscription.findMany({
        where: { status: { in: ['trial', 'active'] }, expiresAt: { lte: new Date() } },
        include: { user: true },
      })
      for (const sub of overdue) {
        const stillActive = await prisma.subscription.count({
          where: { userId: sub.userId, status: { in: ['trial', 'active'] }, expiresAt: { gt: new Date() } },
        })
        if (!stillActive) await panel.disable(Number(sub.user.tgId)).catch(() => {})
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } })
      }
      return overdue.length
    },
  }
}

export type VpnService = ReturnType<typeof createVpnService>
