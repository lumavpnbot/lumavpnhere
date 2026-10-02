import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Payment, PrismaClient } from '@prisma/client'
import type { createPaymentRegistry } from '@/payments/registry'
import type { ProviderTxDetails } from '@/payments/types'
import { recordError } from '@/lib/errors'
import { BillingError, type BillingService } from '@/services/billing'
import { rateLimit } from '@/plugins/rateLimit'

const orderSchema = z.object({
  plan: z.enum(['start', 'pro']),
  period: z.enum(['month', 'year']),
  method: z.enum(['stars', 'crypto_usdt', 'platega_sbp', 'balance']),
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

  /**
   * Сверка заказа с провайдером (Platega): статус и данные СБП. Запрос к провайдеру
   * не чаще раза в 3 секунды на заказ. Оплату засчитываем, даже если вебхук не дошёл.
   */
  const lastCheck = new Map<string, { at: number; details: ProviderTxDetails | null }>()
  async function syncWithProvider(p: Payment): Promise<ProviderTxDetails | null> {
    const provider = payments.get(p.method as 'platega_sbp')
    if (p.status !== 'pending' || !p.externalId || !provider?.enabled || !provider.details) return null
    const cached = lastCheck.get(p.orderId)
    if (cached && Date.now() - cached.at < 3_000) return cached.details
    const details = await provider.details(p.externalId).catch((err) => (recordError('payment details', err), null))
    lastCheck.set(p.orderId, { at: Date.now(), details })
    if (lastCheck.size > 2000) lastCheck.delete(lastCheck.keys().next().value!)
    if (details?.status === 'paid') {
      await prisma.paymentLog.create({ data: { orderId: p.orderId, event: 'provider_paid', payload: { externalId: p.externalId } } })
      await billing.completePayment(p.orderId, p.externalId)
    } else if (details?.status === 'failed') {
      await prisma.payment.updateMany({ where: { orderId: p.orderId, status: 'pending' }, data: { status: 'failed' } })
    }
    return details
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
    let p = await prisma.payment.findUnique({ where: { orderId } })
    if (!p || p.userId !== user.id) return reply.code(404).send({ error: 'Заказ не найден' })
    // СБП: если провайдер уже подтвердил оплату, а вебхук ещё не пришёл, засчитываем сами.
    if (p.status === 'pending' && p.externalId && (await syncWithProvider(p))?.status !== 'pending') {
      p = (await prisma.payment.findUnique({ where: { orderId } })) ?? p
    }
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

  /**
   * Оплата по СБП внутри Mini App: QR-код и ссылка в приложение банка (без страницы Platega).
   * qrLink: https://qr.nspk.ru/… (открывает банк, из неё же рисуем QR); qrImage: готовая картинка QR.
   * Пока провайдер не выдал QR, оба null: фронт спрашивает ещё раз.
   */
  app.get('/payments/order/:orderId/sbp', auth, async (request, reply) => {
    const { orderId } = request.params as { orderId: string }
    const user = await me(request.tgUser!.tgId)
    const p = await prisma.payment.findUnique({ where: { orderId } })
    if (!p || p.userId !== user.id) return reply.code(404).send({ error: 'Заказ не найден' })
    const details = p.status === 'pending' ? await syncWithProvider(p) : null
    const qr = details?.qr ?? null
    const isLink = !!qr && /^https?:\/\//i.test(qr)
    const isImage = !!qr && !isLink && (qr.startsWith('data:image/') || /^[A-Za-z0-9+/=\s]{100,}$/.test(qr))
    return {
      status: p.status === 'failed' || details?.status === 'failed' ? 'failed' : p.status === 'pending' && details?.status !== 'paid' ? 'pending' : 'paid',
      amount: Number(p.amountRub),
      qrLink: isLink ? qr : null,
      qrImage: isImage ? (qr!.startsWith('data:') ? qr : `data:image/png;base64,${qr!.replace(/\s+/g, '')}`) : null,
    }
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

  // Вебхуки CryptoBot и Platega (СБП). Stars подтверждается апдейтом бота, не сюда.
  app.post('/payments/webhook/:method', async (request, reply) => {
    const method = (request.params as { method: string }).method as 'crypto_usdt' | 'platega_sbp' | 'yookassa_sbp'
    const provider = payments.get(method)
    // Выключенный провайдер (нет ключей в .env) вебхуки не принимает.
    if (!provider?.enabled) return reply.code(404).send()

    // Подпись считается по исходному телу запроса (сохраняем его в server.ts).
    const rawBody = request.rawBody ?? JSON.stringify(request.body)
    const event = provider.verifyWebhook(request.headers as Record<string, string>, rawBody)
    // Если провайдер не вернул наш orderId, находим заказ по id его транзакции.
    if (event && !event.orderId && event.externalId) {
      event.orderId = (await prisma.payment.findFirst({ where: { externalId: event.externalId }, select: { orderId: true } }))?.orderId ?? ''
    }
    await prisma.paymentLog.create({
      data: { orderId: event?.orderId || 'unknown', event: event ? `webhook_${event.status}` : 'invalid_signature', payload: request.body as object },
    })
    if (!event) return reply.code(400).send({ error: 'Невалидная подпись вебхука' })
    if (event.status === 'paid') await billing.completePayment(event.orderId, event.externalId)
    else if (event.status === 'failed') await prisma.payment.updateMany({ where: { orderId: event.orderId, status: 'pending' }, data: { status: 'failed' } })
    return reply.send({ ok: true })
  })
}
