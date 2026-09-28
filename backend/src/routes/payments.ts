import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import type { createPaymentRegistry } from '@/payments/registry'
import type { VpnService } from '@/services/vpn'

const createInvoiceSchema = z.object({
  method: z.enum(['stars', 'crypto_usdt', 'crypto_ton', 'yookassa_card', 'yookassa_sbp']),
  plan: z.enum(['start', 'pro']),
  period: z.enum(['month', 'year']),
})

const PRICES_RUB: Record<'start' | 'pro', Record<'month' | 'year', number>> = {
  start: { month: 149, year: 1250 },
  pro: { month: 249, year: 1990 },
}

export function registerPaymentRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  payments: ReturnType<typeof createPaymentRegistry>,
  vpn: VpnService,
) {
  // Список включённых способов оплаты — фронт рисует только то, что реально работает.
  app.get('/payments/methods', async () => ({
    methods: payments.listEnabled().map((p) => p.id),
  }))

  app.post('/payments/invoice', { preHandler: app.authenticate }, async (request, reply) => {
    const body = createInvoiceSchema.parse(request.body)
    const provider = payments.get(body.method)
    if (!provider?.enabled) {
      return reply.code(400).send({ error: `Способ оплаты ${body.method} недоступен` })
    }

    const { tgId } = request.tgUser!
    const user = await prisma.user.findUniqueOrThrow({ where: { tgId } })
    const amountRub = PRICES_RUB[body.plan][body.period]
    const orderId = `lynk_${user.id}_${Date.now()}`

    await prisma.payment.create({
      data: {
        userId: user.id,
        orderId,
        method: body.method,
        amountRub,
        planPurchased: body.plan,
        periodDays: body.period === 'year' ? 365 : 30,
      },
    })

    const invoice = await provider.createInvoice({
      orderId,
      amountRub,
      description: `LynkVPN: ${body.plan === 'pro' ? 'Премиум' : 'Старт'} (${body.period === 'year' ? '12 мес' : '1 мес'})`,
      tgUserId: tgId,
    })

    return { orderId, payload: invoice.payload }
  })

  // Вебхук для CryptoBot (и позже ЮKassa) — Stars подтверждается через апдейт бота, не сюда.
  app.post('/payments/webhook/:method', async (request, reply) => {
    const method = (request.params as { method: string }).method as
      | 'crypto_usdt'
      | 'yookassa_sbp'

    const provider = payments.get(method)
    if (!provider) return reply.code(404).send()

    const rawBody = JSON.stringify(request.body)
    const event = provider.verifyWebhook(request.headers as Record<string, string>, rawBody)

    await prisma.paymentLog.create({
      data: { orderId: event?.orderId ?? 'unknown', event: event ? event.status : 'invalid_signature', payload: request.body as object },
    })

    if (!event) return reply.code(400).send({ error: 'Невалидная подпись вебхука' })
    if (event.status !== 'paid') return reply.send({ ok: true })

    // Идемпотентность: платёж уже мог быть обработан повторным вебхуком.
    const payment = await prisma.payment.findUnique({ where: { orderId: event.orderId } })
    if (!payment || payment.status === 'paid') return reply.send({ ok: true })

    // Сначала выдаём VPN, потом помечаем платёж: если панель упала, вебхук повторится.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: payment.userId } })
    const plan = payment.planPurchased ?? 'start'
    await vpn.activate(user, plan, payment.periodDays, 'active')
    await prisma.payment.update({ where: { orderId: event.orderId }, data: { status: 'paid', paidAt: new Date() } })

    // TODO: реферальное начисление 30% с холдом 7 дней (ReferralPayout).

    return reply.send({ ok: true })
  })
}
