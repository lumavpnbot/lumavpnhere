import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { PanelProvider } from '@/panel'
import { ownerIds } from '@/bot/staff'
import { rateLimit } from '@/plugins/rateLimit'
import { LEVEL_NAMES, type SettingsService } from '@/services/settings'
import type { UserService } from '@/services/users'
import { PLAN_LIMITS, type VpnService } from '@/services/vpn'
import { happOpenUrl, subscriptionUrl } from './subscription'

const TX_KIND: Record<string, string> = { referral: 'referral', purchase: 'purchase', admin: 'bonus', bonus: 'bonus', refund: 'refund' }

/**
 * /me: профиль, подписка, баланс и рефералка одним запросом.
 * При первом входе создаёт пользователя и автоматически выдаёт Trial (ТЗ 4).
 */
export function registerMeRoutes(
  app: FastifyInstance,
  deps: { prisma: PrismaClient; panel: PanelProvider; vpn: VpnService; users: UserService; settings: SettingsService; env: NodeJS.ProcessEnv },
) {
  const { prisma, panel, vpn, users, settings, env } = deps
  const botUsername = (env.BOT_USERNAME || 'lynkorobot').replace(/^@/, '')

  app.get('/me', { preHandler: [app.authenticate, rateLimit(60, 60_000, 'api')] }, async (request, reply) => {
    const { tgId, username, startParam } = request.tgUser!
    const s = await settings.get()
    const isAdmin = ownerIds(env).has(tgId)

    const ensured = await users.ensureUser({ tgId, username, refPayload: startParam })
    let user = ensured.user
    if (ensured.attached && !ensured.created && user.trialUsed && !isAdmin) {
      await vpn.grant(user, 'start', Math.max(0, s.trialDaysReferral - s.trialDays)).catch(() => undefined)
    }
    if (user.banned) return reply.code(403).send({ error: 'Доступ к сервису ограничен. Напишите в поддержку.' })
    user = await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })

    if (!isAdmin && !user.trialUsed) {
      const hasAny = await prisma.subscription.count({ where: { userId: user.id } })
      if (!hasAny) {
        await vpn
          .startTrial(user, user.referrerId ? s.trialDaysReferral : s.trialDays)
          .catch((err) => request.log.error({ err }, 'trial provisioning failed'))
      }
    }
    // Для команды показываем ошибку выдачи прямо в приложении: так проще отлаживать панель.
    let provisionError: string | null = null
    if (isAdmin) {
      await vpn.ensureAdmin(user).catch((err: Error) => {
        request.log.error({ err }, 'admin provisioning failed')
        provisionError = err.message
      })
    }

    const subscription = await prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { expiresAt: 'desc' } })
    const [client, referrals, referralsActive, earned, txs, devices] = await Promise.all([
      panel.getClient(Number(tgId)).catch(() => null),
      prisma.user.count({ where: { referrerId: user.id } }),
      prisma.user.count({ where: { referrerId: user.id, payments: { some: { status: 'paid' } } } }),
      prisma.referralPayout.aggregate({ where: { referrerId: user.id, status: { in: ['hold', 'paid'] } }, _sum: { amountRub: true } }),
      prisma.balanceTx.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.device.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: 'desc' } }),
    ])
    const limits = subscription ? PLAN_LIMITS[subscription.plan] : null
    const active = !!subscription && subscription.status !== 'expired' && subscription.expiresAt > new Date()
    const promoUsed = s.defaultPromo
      ? await prisma.promoUse.count({ where: { userId: user.id, promo: { code: s.defaultPromo } } })
      : 1

    return {
      countries: panel.countries,
      maintenance: s.maintenance,
      prices: s.prices,
      profile: {
        tgId: Number(user.tgId),
        username: user.username,
        email: user.email,
        registeredAt: user.createdAt,
        devicesLimit: isAdmin ? 99 : limits?.devices ?? 0,
        isAdmin,
        provisionError,
        balance: Number(user.balanceRub),
        referralsCount: referrals,
        referralsActive,
        referralEarned: Number(earned._sum.amountRub ?? 0),
        referralLevel: user.referralLevel,
        referralLevelName: LEVEL_NAMES[user.referralLevel],
        referralPercent: s.referralPercents[user.referralLevel],
        refCode: user.refCode,
        referralLink: user.refCode ? `https://t.me/${botUsername}?start=REF_${user.refCode}` : null,
        defaultPromo: promoUsed ? null : s.defaultPromo || null,
      },
      subscription: subscription && {
        status: active ? subscription.status : 'expired',
        plan: subscription.plan === 'free' ? null : subscription.plan,
        startedAt: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        autoRenew: subscription.autoRenew,
        trafficUsedGb: client?.trafficUsedGb ?? 0,
        trafficLimitGb: limits?.trafficGb ?? null,
        subscriptionUrl: active ? subscriptionUrl(env, user.subToken) : null,
        happUrl: active ? happOpenUrl(env, user.subToken) : null,
      },
      devices: devices.map((d) => ({
        id: d.id.toString(),
        label: d.label ?? 'Устройство',
        platform: [d.platform, d.app?.split(/[\s/]/)[0]].filter(Boolean).join(', ') || 'Happ',
        lastSeenAt: d.lastSeenAt.toISOString(),
      })),
      transactions: txs.map((t) => ({
        id: t.id.toString(),
        kind: TX_KIND[t.kind] ?? 'bonus',
        amount: Number(t.amountRub),
        plan: t.note === 'start' || t.note === 'pro' ? t.note : undefined,
        at: t.createdAt.toISOString(),
      })),
    }
  })
}
