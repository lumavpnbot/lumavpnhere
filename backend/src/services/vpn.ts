import type { PrismaClient, SubscriptionPlan, User } from '@prisma/client'
import type { PanelProvider } from '@/panel'

const DAY = 24 * 60 * 60 * 1000

export const TRIAL_DAYS = 7
export const TRIAL_DAYS_REFERRAL = 10

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

  return {
    activate,

    async startTrial(user: User, viaReferral: boolean) {
      if (user.trialUsed) return null
      const sub = await activate(user, 'start', viaReferral ? TRIAL_DAYS_REFERRAL : TRIAL_DAYS, 'trial')
      await prisma.user.update({ where: { id: user.id }, data: { trialUsed: true } })
      return sub
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
