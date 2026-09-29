import type { PaymentMethod, PrismaClient, User } from '@prisma/client'
import type { createPaymentRegistry } from '@/payments/registry'
import type { PaymentMethodId } from '@/payments/types'
import type { VpnService } from './vpn'
import { LEVEL_NAMES, levelFor, type PaidPlan, type Period, type SettingsService } from './settings'

const DAY = 24 * 60 * 60 * 1000
const round2 = (n: number) => Math.round(n * 100) / 100

export type Notifier = (tgId: bigint, text: string) => Promise<void>

export class BillingError extends Error {}

export interface Quote {
  plan: PaidPlan
  period: Period
  basePrice: number
  promo: { code: string; percent: number } | null
  discount: number
  total: number
  balanceUsed: number
  toPay: number
  stars: number
}

export function createBillingService(
  prisma: PrismaClient,
  settings: SettingsService,
  vpn: VpnService,
  payments: ReturnType<typeof createPaymentRegistry>,
  notify: Notifier,
  notifyStaff: (text: string) => Promise<void>,
) {
  async function findPromo(code: string, userId: bigint) {
    const normalized = code.trim().toUpperCase()
    if (!normalized) return null
    const promo = await prisma.promoCode.findUnique({ where: { code: normalized } })
    if (!promo || !promo.active) throw new BillingError('Промокод не найден')
    if (promo.expiresAt && promo.expiresAt < new Date()) throw new BillingError('Срок действия промокода истёк')
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) throw new BillingError('Промокод уже использован максимальное число раз')
    const used = await prisma.promoUse.findUnique({ where: { promoId_userId: { promoId: promo.id, userId } } })
    if (used) throw new BillingError('Вы уже применяли этот промокод')
    return promo
  }

  async function quote(user: User, plan: PaidPlan, period: Period, promoCode?: string, useBalance = false): Promise<Quote> {
    const s = await settings.get()
    const basePrice = s.prices[plan][period]
    const promo = promoCode ? await findPromo(promoCode, user.id) : null
    const discount = promo ? round2((basePrice * promo.percent) / 100) : 0
    const total = round2(Math.max(0, basePrice - discount))
    const balance = Number(user.balanceRub)
    const balanceUsed = useBalance ? round2(Math.min(balance, total)) : 0
    const toPay = round2(total - balanceUsed)
    return {
      plan,
      period,
      basePrice,
      promo: promo ? { code: promo.code, percent: promo.percent } : null,
      discount,
      total,
      balanceUsed,
      toPay,
      stars: toPay > 0 ? Math.max(1, Math.ceil(toPay / s.starsRubRate)) : 0,
    }
  }

  /**
   * Создаёт заказ. Если всё покрывает баланс, подписка активируется сразу.
   * Иначе возвращает payload провайдера (ссылку Stars-инвойса или CryptoBot).
   */
  async function createOrder(params: {
    user: User
    plan: PaidPlan
    period: Period
    method: PaymentMethodId | 'balance'
    promoCode?: string
    useBalance?: boolean
    autoRenew?: boolean
  }) {
    const s = await settings.get()
    if (s.maintenance) throw new BillingError('Приём платежей временно приостановлен, попробуйте позже')
    if (params.user.banned) throw new BillingError('Аккаунт заблокирован')

    const useBalance = params.method === 'balance' || Boolean(params.useBalance)
    const q = await quote(params.user, params.plan, params.period, params.promoCode, useBalance)
    if (params.method === 'balance' && q.toPay > 0) throw new BillingError('Недостаточно средств на балансе')

    const onlyBalance = q.toPay === 0
    const method: PaymentMethod = onlyBalance ? 'balance' : (params.method as PaymentMethod)
    const provider = onlyBalance ? null : payments.get(params.method as PaymentMethodId)
    if (!onlyBalance && !provider?.enabled) throw new BillingError('Этот способ оплаты пока недоступен')

    const orderId = `lynk_${params.user.id}_${Date.now()}`
    const promo = q.promo ? await prisma.promoCode.findUnique({ where: { code: q.promo.code } }) : null
    const payment = await prisma.payment.create({
      data: {
        userId: params.user.id,
        orderId,
        method,
        amountRub: q.toPay,
        balanceUsedRub: q.balanceUsed,
        discountRub: q.discount,
        promoCodeId: promo?.id ?? null,
        planPurchased: params.plan,
        periodDays: params.period === 'year' ? 365 : 30,
        starsAmount: method === 'stars' ? q.stars : null,
        autoRenew: Boolean(params.autoRenew),
      },
    })

    if (onlyBalance) {
      await completePayment(orderId)
      return { orderId, status: 'paid' as const, quote: q, payload: null }
    }

    const title = `${params.plan === 'pro' ? 'Премиум' : 'Старт'}, ${params.period === 'year' ? '12 месяцев' : '1 месяц'}`
    const invoice = await provider!.createInvoice({
      orderId,
      amountRub: method === 'stars' ? q.stars : q.toPay,
      description: `LYNK: ${title}`,
      tgUserId: Number(params.user.tgId),
    })
    await prisma.paymentLog.create({ data: { orderId, event: 'created', payload: { method, toPay: q.toPay, stars: q.stars } } })
    return { orderId, status: 'pending' as const, quote: q, payload: invoice.payload, paymentId: payment.id.toString() }
  }

  /** Пересчёт уровня реферера, бонус за новый уровень. Уровень не понижается. */
  async function updateReferrerLevel(referrerId: bigint) {
    const s = await settings.get()
    const referrer = await prisma.user.findUnique({ where: { id: referrerId } })
    if (!referrer) return
    const active = await prisma.user.count({
      where: { referrerId, payments: { some: { status: 'paid' } } },
    })
    const level = levelFor(active, s)
    if (level <= referrer.referralLevel) return
    await prisma.user.update({ where: { id: referrerId }, data: { referralLevel: level } })
    const bonus = s.levelBonuses[level]
    if (bonus) {
      await vpn.grant(referrer, bonus.plan, bonus.days).catch(() => undefined)
    }
    await notify(
      referrer.tgId,
      `🏆 Новый уровень: <b>${LEVEL_NAMES[level]}</b>\nТеперь вы получаете <b>${s.referralPercents[level]}%</b> с оплат друзей.` +
        (bonus ? `\nБонус: +${bonus.days} дней тарифа «${bonus.plan === 'pro' ? 'Премиум' : 'Старт'}».` : ''),
    )
  }

  /**
   * Завершение оплаты. Идемпотентно: повторный вызов по тому же заказу ничего не делает.
   * Порядок из ТЗ 5.2: платёж PAID → продление → начисление рефереру (холд) → уведомление.
   */
  async function completePayment(orderId: string, externalId?: string) {
    const s = await settings.get()
    const done = await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { orderId, status: 'pending' },
        data: { status: 'paid', paidAt: new Date(), externalId: externalId ?? null },
      })
      if (claimed.count === 0) return null
      const payment = await tx.payment.findUniqueOrThrow({ where: { orderId } })
      const user = await tx.user.findUniqueOrThrow({ where: { id: payment.userId } })

      const balanceUsed = Number(payment.balanceUsedRub)
      if (balanceUsed > 0) {
        await tx.user.update({ where: { id: user.id }, data: { balanceRub: { decrement: balanceUsed } } })
        await tx.balanceTx.create({
          data: { userId: user.id, amountRub: -balanceUsed, kind: 'purchase', paymentId: payment.id, note: payment.planPurchased ?? undefined },
        })
      }
      if (payment.promoCodeId) {
        await tx.promoCode.update({ where: { id: payment.promoCodeId }, data: { usedCount: { increment: 1 } } })
        await tx.promoUse.create({ data: { promoId: payment.promoCodeId, userId: user.id, paymentId: payment.id } })
      }

      const total = Number(payment.amountRub) + balanceUsed
      if (user.referrerId && total > 0) {
        const referrer = await tx.user.findUnique({ where: { id: user.referrerId } })
        if (referrer && !referrer.banned) {
          const percent = s.referralPercents[referrer.referralLevel] ?? s.referralPercents[0]
          await tx.referralPayout.create({
            data: {
              referrerId: referrer.id,
              paymentId: payment.id,
              amountRub: round2((total * percent) / 100),
              payoutAfter: new Date(Date.now() + s.holdDays * DAY),
            },
          })
        }
      }
      return { payment, user }
    })
    if (!done) return false

    const { payment, user } = done
    const plan = (payment.planPurchased ?? 'start') as PaidPlan
    try {
      const sub = await vpn.activate(user, plan, payment.periodDays, 'active')
      if (payment.autoRenew) await prisma.subscription.update({ where: { id: sub.id }, data: { autoRenew: true } })
    } catch (err) {
      await prisma.paymentLog.create({ data: { orderId, event: 'activation_failed', payload: { error: (err as Error).message } } })
      await notifyStaff(`⚠️ Оплата ${orderId} прошла, но выдать доступ на панели не удалось: ${(err as Error).message}`)
    }
    await prisma.paymentLog.create({ data: { orderId, event: 'paid', payload: { externalId: externalId ?? null } } })
    if (user.referrerId) await updateReferrerLevel(user.referrerId).catch(() => undefined)
    await notify(
      user.tgId,
      `✅ <b>Подписка активирована</b>\nТариф «${plan === 'pro' ? 'Премиум' : 'Старт'}» на ${payment.periodDays === 365 ? '12 месяцев' : '1 месяц'}. Спасибо, что вы с нами!`,
    )
    return true
  }

  /** Возврат на внутренний баланс (админ). Начисление рефереру на холде отменяется. */
  async function refundToBalance(paymentId: bigint, adminNote: string) {
    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
      if (payment.status !== 'paid') throw new BillingError('Возврат возможен только для оплаченного платежа')
      const amount = Number(payment.amountRub) + Number(payment.balanceUsedRub)
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'refunded' } })
      await tx.user.update({ where: { id: payment.userId }, data: { balanceRub: { increment: amount } } })
      await tx.balanceTx.create({ data: { userId: payment.userId, amountRub: amount, kind: 'refund', paymentId, note: adminNote } })
      await tx.referralPayout.updateMany({ where: { paymentId, status: 'hold' }, data: { status: 'cancelled' } })
      return amount
    })
  }

  /** Снятие холда: начисления, у которых прошло 7 дней, уходят на баланс. */
  async function releaseHolds(force = false) {
    const due = await prisma.referralPayout.findMany({
      where: { status: 'hold', ...(force ? {} : { payoutAfter: { lte: new Date() } }) },
      include: { payment: true, referrer: true },
    })
    let released = 0
    for (const p of due) {
      if (p.payment.status !== 'paid' || p.referrer.banned) {
        await prisma.referralPayout.update({ where: { id: p.id }, data: { status: 'cancelled' } })
        continue
      }
      await prisma.$transaction([
        prisma.referralPayout.update({ where: { id: p.id }, data: { status: 'paid' } }),
        prisma.user.update({ where: { id: p.referrerId }, data: { balanceRub: { increment: p.amountRub } } }),
        prisma.balanceTx.create({ data: { userId: p.referrerId, amountRub: p.amountRub, kind: 'referral', paymentId: p.paymentId } }),
      ])
      released++
      await notify(p.referrer.tgId, `💰 На баланс зачислено <b>${Number(p.amountRub)} ₽</b> за оплату друга.`)
    }
    return released
  }

  /** Ручное изменение баланса из админки (со знаком). */
  async function adjustBalance(userId: bigint, amount: number, note: string) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { balanceRub: { increment: amount } } }),
      prisma.balanceTx.create({ data: { userId, amountRub: amount, kind: amount >= 0 ? 'admin' : 'purchase', note } }),
    ])
  }

  /** Автопродление с баланса: за сутки до конца, если хватает денег. */
  async function autoRenewFromBalance() {
    const soon = await prisma.subscription.findMany({
      where: {
        autoRenew: true,
        status: 'active',
        expiresAt: { gt: new Date(), lte: new Date(Date.now() + DAY) },
      },
      include: { user: true },
    })
    let renewed = 0
    for (const sub of soon) {
      if (sub.plan === 'free') continue
      const s = await settings.get()
      const price = s.prices[sub.plan][Math.round((sub.expiresAt.getTime() - sub.startedAt.getTime()) / DAY) > 40 ? 'year' : 'month']
      if (Number(sub.user.balanceRub) < price) continue
      const period: Period = price === s.prices[sub.plan].year ? 'year' : 'month'
      try {
        await prisma.subscription.update({ where: { id: sub.id }, data: { autoRenew: false } })
        await createOrder({ user: sub.user, plan: sub.plan, period, method: 'balance', autoRenew: true })
        renewed++
      } catch {
        await prisma.subscription.update({ where: { id: sub.id }, data: { autoRenew: true } })
      }
    }
    return renewed
  }

  return { quote, createOrder, completePayment, refundToBalance, releaseHolds, adjustBalance, autoRenewFromBalance, updateReferrerLevel }
}

export type BillingService = ReturnType<typeof createBillingService>
