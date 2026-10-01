import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { PanelProvider } from '@/panel'
import { ownerIds } from '@/bot/staff'
import { rateLimit } from '@/plugins/rateLimit'
import type { AchievementService } from '@/services/achievements'
import { LEVEL_NAMES, type SettingsService } from '@/services/settings'
import type { UserService } from '@/services/users'
import { LATEST_FIRST, PLAN_LIMITS, type VpnService } from '@/services/vpn'
import { clientOpenUrls, happOpenUrl, subscriptionUrl } from './subscription'

const TX_KIND: Record<string, string> = { referral: 'referral', purchase: 'purchase', admin: 'bonus', bonus: 'bonus', refund: 'refund' }

/**
 * /me: профиль, подписка, баланс и рефералка одним запросом.
 * При первом входе создаёт пользователя и автоматически выдаёт Trial (ТЗ 4).
 */
export function registerMeRoutes(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient
    panel: PanelProvider
    vpn: VpnService
    users: UserService
    settings: SettingsService
    achievements?: AchievementService
    env: NodeJS.ProcessEnv
  },
) {
  const { prisma, panel, vpn, users, settings, achievements, env } = deps
  const botUsername = (env.BOT_USERNAME || 'lynkorobot').replace(/^@/, '')

  app.get('/me', { preHandler: [app.authenticate, rateLimit(60, 60_000, 'api')] }, async (request, reply) => {
    const { tgId, username, startParam } = request.tgUser!
    const s = await settings.get()
    const isAdmin = ownerIds(env).has(tgId)

    const ensured = await users.ensureUser({ tgId, username, refPayload: startParam })
    let user = ensured.user
    if (user.banned) return reply.code(403).send({ error: 'Доступ к сервису ограничен. Напишите в поддержку.' })
    if (ensured.attached && !ensured.created && user.trialUsed && !isAdmin) {
      await vpn.grant(user, 'start', Math.max(0, s.trialDaysReferral - s.trialDays)).catch(() => undefined)
    }
    // Кто-то пришёл по ссылке друга: у пригласившего засчитывается «Шеринг».
    if (ensured.attached && user.referrerId && achievements) void achievements.evaluateById(user.referrerId).catch(() => undefined)
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

    // Действующая подписка, а если её нет, последняя истёкшая (чтобы показать «закончилась»).
    const subscription =
      (await vpn.current(user.id)) ?? (await prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: LATEST_FIRST }))
    const active = !!subscription && subscription.status !== 'expired' && subscription.expiresAt > new Date()
    const [panelClient, referrals, referralsActive, earned, txs, devices] = await Promise.all([
      panel.getClient(Number(tgId)).catch(() => null),
      prisma.user.count({ where: { referrerId: user.id } }),
      prisma.user.count({ where: { referrerId: user.id, payments: { some: { status: 'paid' } } } }),
      prisma.referralPayout.aggregate({ where: { referrerId: user.id, status: { in: ['hold', 'paid'] } }, _sum: { amountRub: true } }),
      prisma.balanceTx.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.device.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: 'desc' } }),
    ])
    // Подписка есть в БД, а на панели клиента нет или срок меньше: чиним сразу,
    // иначе оплаченное продление не доходит до VPN («подписка не обновляется»).
    let client = panelClient
    if (active && !isAdmin) {
      client = await vpn.sync(user, panelClient).then(
        (r) => r.client,
        (err: Error) => {
          request.log.error({ err }, 'panel sync failed')
          return panelClient
        },
      )
    }
    const limits = subscription ? PLAN_LIMITS[subscription.plan] : null
    // Лимит устройств с бонусами за достижения, скидка на следующий платёж, закреплённые бейджи.
    const [deviceLimit, bonusDevices, discount, showcase, badges] = await Promise.all([
      active && subscription ? vpn.deviceLimit(user, subscription.plan) : Promise.resolve(0),
      vpn.bonusDevices(user.id),
      achievements ? achievements.discountFor(user.id) : Promise.resolve({ percent: 0, rewardIds: [] }),
      achievements ? achievements.showcase(user) : Promise.resolve([]),
      prisma.userAchievement.count({ where: { userId: user.id } }),
    ])
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
        devicesLimit: isAdmin ? 99 : active ? (deviceLimit ?? 99) : 0,
        bonusDevices: active ? bonusDevices : 0,
        rewardDiscount: discount.percent,
        achievementsUnlocked: badges,
        showcase,
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
        trafficLimitGb: isAdmin ? null : (limits?.trafficGb ?? null),
        subscriptionUrl: active ? subscriptionUrl(env, user.subToken) : null,
        happUrl: active ? happOpenUrl(env, user.subToken) : null,
        // Страницы «Открыть в Happ / INCY / Hiddify» (экран «Подключение»).
        openUrls: active ? clientOpenUrls(env, user.subToken) : null,
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
