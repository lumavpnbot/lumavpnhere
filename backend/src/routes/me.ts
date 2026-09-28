import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'

const TRIAL_DAYS = 7

/** /me — профиль + подписка текущего пользователя. Создаёт юзера и trial при первом входе (ТЗ 4.1). */
export function registerMeRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const { tgId, username } = request.tgUser!

    let user = await prisma.user.findUnique({ where: { tgId } })
    if (!user) {
      user = await prisma.user.create({ data: { tgId, username } })
      await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: 'start',
          status: 'trial',
          expiresAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        },
      })
    }

    const subscription = await prisma.subscription.findFirst({
      where: { userId: user.id },
      orderBy: { expiresAt: 'desc' },
    })
    const devicesUsed = await prisma.device.count({ where: { userId: user.id } })

    return {
      profile: {
        tgId: Number(user.tgId),
        username: user.username,
        avatarUrl: user.avatarUrl,
        devicesUsed,
        devicesLimit: subscription?.plan === 'pro' ? 5 : subscription?.plan === 'start' ? 3 : 1,
        referralBalance: 0, // TODO: сумма paid-выплат referral_payouts за вычетом выводов
      },
      subscription: subscription && {
        status: subscription.status,
        plan: subscription.plan,
        expiresAt: subscription.expiresAt,
      },
    }
  })
}
