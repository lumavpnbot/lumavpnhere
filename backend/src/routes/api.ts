import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import type { Staff } from '@/bot/staff'
import { esc } from '@/bot/tg'
import { rateLimit } from '@/plugins/rateLimit'
import type { ServerStatusService } from '@/services/servers'
import { LEVEL_NAMES, type SettingsService } from '@/services/settings'
import { LATEST_FIRST, PLAN_LIMITS, activeWhere, type VpnService } from '@/services/vpn'

/**
 * Эндпоинты Mini App из ТЗ (раздел 2): тарифы, автопродление, рефералка,
 * поддержка, серверы. Профиль и подписка: /me, платежи: routes/payments.ts.
 */
export function registerApiRoutes(
  app: FastifyInstance,
  deps: { prisma: PrismaClient; settings: SettingsService; servers: ServerStatusService; staff: Staff; vpn: VpnService; env: NodeJS.ProcessEnv },
) {
  const { prisma, settings, servers, staff, vpn, env } = deps
  const auth = { preHandler: [app.authenticate, rateLimit(60, 60_000, 'api')] }
  const me = (tgId: number) => prisma.user.findUniqueOrThrow({ where: { tgId: BigInt(tgId) } })
  const botUsername = (env.BOT_USERNAME || 'lynkorobot').replace(/^@/, '')

  app.get('/subscription/plans', async () => {
    const s = await settings.get()
    return {
      prices: s.prices,
      trialDays: s.trialDays,
      trialDaysReferral: s.trialDaysReferral,
      autoRenewDiscount: s.autoRenewDiscount,
      starsRubRate: s.starsRubRate,
      maintenance: s.maintenance,
      plans: [
        { id: 'start', devices: PLAN_LIMITS.start.devices, trafficGb: PLAN_LIMITS.start.trafficGb },
        { id: 'pro', devices: PLAN_LIMITS.pro.devices, trafficGb: PLAN_LIMITS.pro.trafficGb },
      ],
    }
  })

  app.post('/subscription/autorenew', auth, async (request) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body)
    const user = await me(request.tgUser!.tgId)
    const sub = await prisma.subscription.findFirst({ where: { userId: user.id, ...activeWhere() }, orderBy: LATEST_FIRST })
    if (!sub) return { autoRenew: false }
    await prisma.subscription.update({ where: { id: sub.id }, data: { autoRenew: enabled } })
    return { autoRenew: enabled }
  })

  app.get('/referral', auth, async (request) => {
    const s = await settings.get()
    const user = await me(request.tgUser!.tgId)
    const [invited, active, hold, paid] = await Promise.all([
      prisma.user.count({ where: { referrerId: user.id } }),
      prisma.user.count({ where: { referrerId: user.id, payments: { some: { status: 'paid' } } } }),
      prisma.referralPayout.aggregate({ where: { referrerId: user.id, status: 'hold' }, _sum: { amountRub: true } }),
      prisma.referralPayout.aggregate({ where: { referrerId: user.id, status: 'paid' }, _sum: { amountRub: true } }),
    ])
    const level = user.referralLevel
    return {
      link: user.refCode ? `https://t.me/${botUsername}?start=REF_${user.refCode}` : null,
      code: user.refCode,
      invited,
      active,
      earnedHold: Number(hold._sum.amountRub ?? 0),
      earnedPaid: Number(paid._sum.amountRub ?? 0),
      holdDays: s.holdDays,
      level,
      levels: LEVEL_NAMES.map((name, i) => ({
        name,
        min: s.levelThresholds[i],
        percent: s.referralPercents[i],
        bonus: s.levelBonuses[i],
      })),
    }
  })

  app.get('/referral/earnings', auth, async (request) => {
    const user = await me(request.tgUser!.tgId)
    const rows = await prisma.referralPayout.findMany({
      where: { referrerId: user.id },
      include: { payment: { include: { user: { select: { username: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return {
      earnings: rows.map((r) => ({
        id: r.id.toString(),
        amount: Number(r.amountRub),
        status: r.status,
        availableAt: r.payoutAfter.toISOString(),
        at: r.createdAt.toISOString(),
        friend: r.payment.user.username ? `@${r.payment.user.username}` : null,
      })),
    }
  })

  app.get('/referral/referrals', auth, async (request) => {
    const user = await me(request.tgUser!.tgId)
    const rows = await prisma.user.findMany({
      where: { referrerId: user.id },
      select: { username: true, createdAt: true, payments: { where: { status: 'paid' }, select: { id: true }, take: 1 } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return {
      referrals: rows.map((r, i) => ({
        id: String(i),
        // Приватность: показываем ник частично.
        name: r.username ? `@${r.username.slice(0, 3)}${'•'.repeat(Math.max(2, r.username.length - 3))}` : 'Пользователь',
        joinedAt: r.createdAt.toISOString(),
        paid: r.payments.length > 0,
      })),
    }
  })

  app.get('/support/tickets', auth, async (request) => {
    const user = await me(request.tgUser!.tgId)
    const rows = await prisma.supportTicket.findMany({
      where: { userId: user.id },
      include: { messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    })
    return {
      tickets: rows.map((t) => ({
        id: t.id.toString(),
        subject: t.subject,
        status: t.status,
        updatedAt: t.updatedAt.toISOString(),
        messages: t.messages.map((m) => ({ id: m.id.toString(), fromStaff: m.fromStaff, text: m.text, at: m.createdAt.toISOString() })),
      })),
    }
  })

  app.post('/support/ticket', { preHandler: [app.authenticate, rateLimit(10, 60_000, 'ticket')] }, async (request) => {
    const body = z.object({ text: z.string().trim().min(3).max(3000), ticketId: z.string().regex(/^\d+$/).optional() }).parse(request.body)
    const user = await me(request.tgUser!.tgId)
    let ticket = body.ticketId
      ? await prisma.supportTicket.findFirst({ where: { id: BigInt(body.ticketId), userId: user.id } })
      : null
    const isNew = !ticket
    if (!ticket) ticket = await prisma.supportTicket.create({ data: { userId: user.id, subject: body.text.slice(0, 80) } })
    else await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'open', closedAt: null } })
    await prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorTgId: user.tgId, text: body.text } })
    for (const id of await staff.staffIds('support')) {
      await staff.notify(
        id,
        `💬 <b>${isNew ? 'Новое обращение' : 'Сообщение в обращении'} #${ticket.id}</b> из приложения\nОт: ${user.username ? '@' + esc(user.username) : user.tgId}\n\n${esc(body.text).slice(0, 800)}\n\n/admin → Поддержка`,
      )
    }
    return { ticketId: ticket.id.toString() }
  })

  /** Отвязать устройство: освобождает место в лимите. */
  const unbind = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await me(request.tgUser!.tgId)
    const { id } = request.params as { id: string }
    if (!/^\d+$/.test(id)) return reply.code(400).send({ error: 'Неверный id' })
    const device = await prisma.device.findFirst({ where: { id: BigInt(id), userId: user.id } })
    if (!device) return reply.code(404).send({ error: 'Устройство не найдено' })
    await prisma.device.delete({ where: { id: device.id } })
    await prisma.deviceEvent.create({ data: { userId: user.id, hwid: device.hwid, label: device.label, event: 'unbound' } })
    return { ok: true }
  }
  app.delete('/user/devices/:id', auth, unbind)
  // ТЗ v6.3 · 04: устройства.
  app.delete('/api/devices/:id', auth, unbind)

  app.get('/api/devices', auth, async (request) => {
    const user = await me(request.tgUser!.tgId)
    const rows = await prisma.device.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: 'desc' } })
    return {
      devices: rows.map((d) => ({
        id: d.id.toString(),
        label: d.label ?? 'Устройство',
        platform: [d.platform, d.app?.split(/[\s/]/)[0]].filter(Boolean).join(', ') || 'Happ',
        createdAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
      })),
    }
  })

  /** Занято / доступно (лимит тарифа + бонусные устройства за достижения). */
  app.get('/api/devices/count', auth, async (request) => {
    const user = await me(request.tgUser!.tgId)
    const [used, sub, bonus] = await Promise.all([prisma.device.count({ where: { userId: user.id } }), vpn.current(user.id), vpn.bonusDevices(user.id)])
    const limit = sub ? await vpn.deviceLimit(user, sub.plan) : 0
    return { used, limit, bonus: sub ? bonus : 0, unlimited: sub != null && limit == null }
  })

  /** Серверы со статусом и пингом (с нашего бэкенда до узла). */
  app.get('/servers', async () => {
    const list = await servers.list()
    return { countries: list.map((s) => s.country), servers: list.map(({ country, online, pingMs }) => ({ country, online, pingMs })) }
  })
}
