import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { PanelProvider } from '@/panel'
import { PLAN_LIMITS, type VpnService } from '@/services/vpn'
import { subscriptionUrl } from './subscription'

function adminIds(env: NodeJS.ProcessEnv) {
  return new Set(
    (env.ADMIN_TELEGRAM_IDS ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  )
}

/** /me: профиль и подписка. При первом входе создаёт пользователя и выдаёт trial (ТЗ 4.1). */
export function registerMeRoutes(app: FastifyInstance, prisma: PrismaClient, panel: PanelProvider, vpn: VpnService, env: NodeJS.ProcessEnv) {
  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const { tgId, username } = request.tgUser!

    const isAdmin = adminIds(env).has(tgId)
    let user = await prisma.user.findUnique({ where: { tgId } })
    if (!user) {
      user = await prisma.user.create({ data: { tgId, username } })
      // TODO: viaReferral из start_param (ref_<id>), когда будет обработчик /start в боте.
      if (!isAdmin) await vpn.startTrial(user, false).catch((err) => request.log.error({ err }, 'trial provisioning failed'))
    }
    if (isAdmin) await vpn.ensureAdmin(user).catch((err) => request.log.error({ err }, 'admin provisioning failed'))

    const subscription = await prisma.subscription.findFirst({
      where: { userId: user.id },
      orderBy: { expiresAt: 'desc' },
    })
    const client = await panel.getClient(Number(tgId)).catch(() => null)
    const limits = subscription ? PLAN_LIMITS[subscription.plan] : null
    const active = !!subscription && subscription.status !== 'expired' && subscription.expiresAt > new Date()

    return {
      profile: {
        tgId: Number(user.tgId),
        username: user.username,
        registeredAt: user.createdAt,
        devicesLimit: isAdmin ? 99 : limits?.devices ?? 0,
        isAdmin,
        balance: 0, // TODO: баланс из операций
      },
      subscription: subscription && {
        status: active ? subscription.status : 'expired',
        plan: subscription.plan === 'free' ? null : subscription.plan,
        startedAt: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        trafficUsedGb: client?.trafficUsedGb ?? 0,
        trafficLimitGb: limits?.trafficGb ?? null,
        subscriptionUrl: active ? subscriptionUrl(env, user.subToken) : null,
      },
    }
  })
}
