import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import type { createPaymentRegistry } from '@/payments/registry'
import { BillingError, type BillingService } from '@/services/billing'
import { rateLimit } from '@/plugins/rateLimit'

const orderSchema = z.object({
  plan: z.enum(['start', 'pro']),
  period: z.enum(['month', 'year']),
  method: z.enum(['stars', 'crypto_usdt', 'balance']),
  promo: z.string().max(40).optional(),
  useBalance: z.boolean().optional(),
  autoRenew: z.boolean().optional(),
})

const quoteSchema = orderSchema.omit({ method: true, autoRenew: true })

export function registerPaymentRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  payments: ReturnType<typeof createPaymentRegistry>,
  billing: BillingService,
) {
  const auth = { preHandler: [app.authenticate, rateLimit(60, 60_000, 'api')] }
  const payLimit = { preHandler: [app.authenticate, rateLimit(5, 60_000, 'pay')] }

  const me = async (tgId: number) => prisma.user.findUniqueOrThrow({ where: { tgId: BigInt(tgId) } })
  const fail = (err: unknown) => {
    if (err instanceof BillingError) return { status: 400, body: { error: err.message } }
    throw err
  }

  // Список включённых способов оплаты: фронт показывает только то, что реально работает.
  app.get('/payments/methods', async () => ({
    methods: [...payments.listEnabled().map((p) => p.id), 'balance'],
  }))

  /** Расчёт цены с промокодом и балансом (без создания платежа). */
  app.post('/payments/quote', auth, async (request, reply) => {
    const body = quoteSchema.parse(request.body)
    try {
      return await billing.quote(await me(request.tgUser!.tgId), body.plan, body.period, body.promo, body.useBalance)
    } catch (err) {
      const r = fail(err)
      return reply.code(r.status).send(r.body)
    }
  })

  // Совместимость с ТЗ: /promo/apply = проверка промокода и цена со скидкой.
  app.post('/promo/apply', auth, async (request, reply) => {
    const body = quoteSchema.parse(request.body)
    try {
      return await billing.quote(await me(request.tgUser!.tgId), body.plan, body.period, body.promo, body.useBalance)
    } catch (err) {
      const r = fail(err)
      return reply.code(r.status).send(r.body)
    }
  })

  app.post('/payments/invoice', payLimit, async (request, reply) => {
    const body = orderSchema.parse(request.body)
    try {
      const order = await billing.createOrder({ user: await me(request.tgUser!.tgId), ...body })
      return { orderId: order.orderId, status: order.status, payload: order.payload, quote: order.quote }
    } catch (err) {
      const r = fail(err)
      return reply.code(r.status).send(r.body)
    }
  })

  /** Статус заказа: фронт опрашивает после оплаты криптой. */
  app.get('/payments/order/:orderId', auth, async (request, reply) => {
    const { orderId } = request.params as { orderId: string }
    const user = await me(request.tgUser!.tgId)
    const p = await prisma.payment.findUnique({ where: { orderId } })
    if (!p || p.userId !== user.id) return reply.code(404).send({ error: 'Заказ не найден' })
    // Статус paid ставится до выдачи доступа на панели. Если отдать его сразу, фронт
    // перезагружал /me раньше, чем создавалась подписка, и показывал старую.
    // Событие 'paid' в логе пишется последним, после выдачи.
    if (p.status === 'paid') {
      const processed = await prisma.paymentLog.count({ where: { orderId, event: 'paid' } })
      if (!processed) return { orderId, status: 'pending', activated: false }
      const activated = await prisma.paymentLog.count({ where: { orderId, event: 'activated' } })
      // Старые платежи (до отметки 'activated') считаем выданными.
      const failed = await prisma.paymentLog.count({ where: { orderId, event: 'activation_failed' } })
      return { orderId, status: 'paid', activated: activated > 0 || failed === 0 }
    }
    return { orderId, status: p.status, activated: false }
  })

  /** История платежей пользователя. */
  app.get('/payments', auth, async (request) => {
    const user = await me(request.tgUser!.tgId)
    const rows = await prisma.payment.findMany({ where: { userId: user.id, status: { in: ['paid', 'refunded'] } }, orderBy: { createdAt: 'desc' }, take: 50 })
    return {
      payments: rows.map((p) => ({
        id: p.id.toString(),
        plan: p.planPurchased,
        periodDays: p.periodDays,
        method: p.method,
        amount: Number(p.amountRub) + Number(p.balanceUsedRub),
        status: p.status,
        at: (p.paidAt ?? p.createdAt).toISOString(),
      })),
    }
  })

  // Вебхук CryptoBot (и позже ЮKassa). Stars подтверждается апдейтом бота, не сюда.
  app.post('/payments/webhook/:method', async (request, reply) => {
    const method = (request.params as { method: string }).method as 'crypto_usdt' | 'yookassa_sbp'
    const provider = payments.get(method)
    if (!provider) return reply.code(404).send()

    // Подпись считается по исходному телу запроса (сохраняем его в server.ts).
    const rawBody = request.rawBody ?? JSON.stringify(request.body)
    const event = provider.verifyWebhook(request.headers as Record<string, string>, rawBody)
    await prisma.paymentLog.create({
      data: { orderId: event?.orderId ?? 'unknown', event: event ? `webhook_${event.status}` : 'invalid_signature', payload: request.body as object },
    })
    if (!event) return reply.code(400).send({ error: 'Невалидная подпись вебхука' })
    if (event.status === 'paid') await billing.completePayment(event.orderId)
    else await prisma.payment.updateMany({ where: { orderId: event.orderId, status: 'pending' }, data: { status: 'failed' } })
    return reply.send({ ok: true })
  })
}
