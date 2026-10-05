import type { Payment, PaymentMethod, PrismaClient, User } from '@prisma/client'
import type { createPaymentRegistry } from '@/payments/registry'
import type { PaymentMethodId } from '@/payments/types'
import type { AchievementService } from './achievements'
import type { VpnService } from './vpn'
import { LEVEL_NAMES, levelFor, upgradeRate, type PaidPlan, type Period, type SettingsService } from './settings'

const DAY = 24 * 60 * 60 * 1000
const round2 = (n: number) => Math.round(n * 100) / 100

export type Notifier = (tgId: bigint, text: string) => Promise<void>

export class BillingError extends Error {}

/** Что покупают: тариф, переход Старт → Премиум, +ГБ на месяц, +устройства на месяц. */
export type Item =
  | { kind: 'plan'; plan: PaidPlan; period: Period }
  | { kind: 'upgrade' }
  | { kind: 'traffic'; gb: number }
  | { kind: 'device'; count: number }

export type Product = Item['kind']

const planTitle = (plan: string | null | undefined) => (plan === 'pro' ? 'Премиум' : 'Старт')

/** Название покупки для чеков, уведомлений и истории. */
export function productTitle(p: { product?: string | null; planPurchased?: string | null; periodDays: number; addonAmount?: number | null }) {
  switch (p.product) {
    case 'upgrade':
      return 'Переход со «Старт» на «Премиум»'
    case 'traffic':
      return `+${p.addonAmount ?? 0} ГБ трафика на месяц`
    case 'device':
      return `+${p.addonAmount ?? 0} ${plural(p.addonAmount ?? 0, 'устройство', 'устройства', 'устройств')} на месяц`
    default:
      return `Тариф «${planTitle(p.planPurchased)}» на ${p.periodDays >= 365 ? '12 месяцев' : '1 месяц'}`
  }
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export interface Quote {
  product: Product
  /** Для тарифа: какой; для перехода: pro; для докупки: текущий тариф. */
  plan: PaidPlan
  period: Period
  title: string
  /** Сколько ГБ / устройств (для докупки). */
  addonAmount: number | null
  /** Доплата за перевод оставшихся дней Старта на Премиум (при покупке Премиума или переходе). */
  upgrade: { days: number; price: number } | null
  basePrice: number
  promo: { code: string; percent: number } | null
  discount: number
  /** Скидка за достижения (ТЗ 3.1): процент (с потолком) и сумма. */
  achPercent: number
  achDiscount: number
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
  achievements?: AchievementService,
  /** После выдачи оплаченного заказа (чек «Мой налог»). Ошибки внутри не должны ломать оплату. */
  onPaid?: (paymentId: bigint) => void,
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

  /** Доплата за перевод оставшихся дней текущего «Старт» на «Премиум». null: перевода нет. */
  async function upgradeFor(userId: bigint) {
    const cur = await vpn.current(userId)
    // Пробный период не доплачивается: купленный Премиум и так продолжит его.
    if (!cur || cur.plan !== 'start' || cur.status !== 'active') return null
    const days = Math.max(1, Math.ceil((cur.expiresAt.getTime() - Date.now()) / DAY))
    const rate = upgradeRate(await settings.get())
    return { days, price: rate > 0 ? Math.max(1, Math.ceil((rate * days) / 30)) : 0 }
  }

  /**
   * Что сейчас можно докупить и почём: для экрана тарифов. reason: почему недоступно.
   */
  async function offers(user: User) {
    const s = await settings.get()
    const cur = await vpn.current(user.id)
    const plan = cur?.plan === 'pro' ? 'pro' : cur ? 'start' : null
    const limits = cur ? await vpn.limitsFor(user, cur.plan) : null
    const extra = cur ? await vpn.activeAddons(user.id) : { devices: 0, trafficGb: 0, rows: [] }
    const upgrade = await upgradeFor(user.id)
    const devicesLeft = Math.max(0, s.maxExtraDevices - extra.devices)
    return {
      plan,
      status: cur?.status ?? null,
      expiresAt: cur?.expiresAt ?? null,
      /** Старт нельзя купить, пока действует Премиум: иначе Премиум сменится на Старт. */
      startBlocked: plan === 'pro',
      upgrade: upgrade
        ? { available: true, ...upgrade, per30d: upgradeRate(s) }
        : { available: false, reason: !cur ? 'no_sub' : cur.plan === 'pro' ? 'already_pro' : 'trial', per30d: upgradeRate(s) },
      traffic: {
        available: Boolean(cur && limits && limits.trafficGb != null),
        reason: !cur ? 'no_sub' : limits?.trafficGb == null ? 'unlimited' : null,
        packs: s.trafficPacks,
        extraGb: extra.trafficGb,
      },
      devices: {
        available: Boolean(cur && limits && limits.devices != null && devicesLeft > 0),
        reason: !cur ? 'no_sub' : limits?.devices == null ? 'unlimited' : devicesLeft <= 0 ? 'max' : null,
        price: s.devicePrice,
        left: devicesLeft,
        extra: extra.devices,
      },
      addons: extra.rows.map((a) => ({ kind: a.kind, amount: a.amount, expiresAt: a.expiresAt })),
    }
  }

  async function quote(user: User, plan: PaidPlan, period: Period, promoCode?: string, useBalance = false) {
    return quoteItem(user, { kind: 'plan', plan, period }, promoCode, useBalance)
  }

  async function quoteItem(user: User, item: Item, promoCode?: string, useBalance = false): Promise<Quote & { achRewardIds: string[] }> {
    const s = await settings.get()
    const cur = await vpn.current(user.id)
    let plan: PaidPlan = cur?.plan === 'pro' ? 'pro' : 'start'
    let period: Period = 'month'
    let basePrice = 0
    let addonAmount: number | null = null
    let upgrade: { days: number; price: number } | null = null

    if (item.kind === 'plan') {
      plan = item.plan
      period = item.period
      basePrice = s.prices[plan][period]
      if (plan === 'start' && cur?.plan === 'pro') {
        throw new BillingError('Сейчас у вас «Премиум». «Старт» можно будет купить, когда он закончится, а пока продлевайте «Премиум».')
      }
      // Премиум поверх оплаченного Старта: оставшиеся дни Старта тоже станут Премиумом, за них доплата.
      if (plan === 'pro') upgrade = await upgradeFor(user.id)
    } else if (item.kind === 'upgrade') {
      upgrade = await upgradeFor(user.id)
      if (!upgrade) {
        throw new BillingError(
          !cur ? 'Нет действующей подписки' : cur.plan === 'pro' ? 'У вас уже «Премиум»' : 'Во время пробного периода просто купите «Премиум»: оставшиеся дни тоже станут Премиумом',
        )
      }
      plan = 'pro'
    } else {
      if (!cur) throw new BillingError('Докупить можно только к действующей подписке')
      const limits = await vpn.limitsFor(user, cur.plan)
      if (item.kind === 'traffic') {
        if (limits.trafficGb == null) throw new BillingError('У вас безлимитный трафик')
        const pack = s.trafficPacks.find((p) => p.gb === item.gb)
        if (!pack) throw new BillingError('Такого пакета трафика нет')
        basePrice = pack.price
        addonAmount = pack.gb
      } else {
        if (limits.devices == null) throw new BillingError('У вас без ограничения устройств')
        const extra = await vpn.activeAddons(user.id)
        const left = s.maxExtraDevices - extra.devices
        if (!Number.isInteger(item.count) || item.count < 1) throw new BillingError('Неверное число устройств')
        if (item.count > left) throw new BillingError(left > 0 ? `Можно докупить ещё ${left} ${plural(left, 'устройство', 'устройства', 'устройств')}` : 'Докуплено максимальное число устройств')
        basePrice = round2(s.devicePrice * item.count)
        addonAmount = item.count
      }
    }

    // Промокоды и скидки за достижения действуют только на тариф (не на доплату и докупку).
    const isPlan = item.kind === 'plan'
    const promo = isPlan && promoCode ? await findPromo(promoCode, user.id) : null
    const discount = promo ? round2((basePrice * promo.percent) / 100) : 0
    const ach = isPlan && achievements ? await achievements.discountFor(user.id) : { percent: 0, rewardIds: [] }
    const achDiscount = round2((Math.max(0, basePrice - discount) * ach.percent) / 100)
    const total = round2(Math.max(0, basePrice - discount - achDiscount) + (upgrade?.price ?? 0))
    const balance = Number(user.balanceRub)
    const balanceUsed = useBalance ? round2(Math.min(balance, total)) : 0
    const toPay = round2(total - balanceUsed)
    const periodDays = item.kind === 'plan' ? (period === 'year' ? 365 : 30) : item.kind === 'upgrade' ? 0 : 30
    return {
      product: item.kind,
      plan,
      period,
      title: productTitle({ product: item.kind, planPurchased: plan, periodDays, addonAmount }),
      addonAmount,
      upgrade,
      basePrice,
      promo: promo ? { code: promo.code, percent: promo.percent } : null,
      discount,
      achPercent: ach.percent,
      achDiscount,
      achRewardIds: ach.percent > 0 ? ach.rewardIds : [],
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
    /** Что покупают; без него — тариф plan/period (как раньше). */
    item?: Item
    plan?: PaidPlan
    period?: Period
    method: PaymentMethodId | 'balance'
    promoCode?: string
    useBalance?: boolean
    autoRenew?: boolean
  }) {
    const s = await settings.get()
    if (s.maintenance) throw new BillingError('Приём платежей временно приостановлен, попробуйте позже')
    if (params.user.banned) throw new BillingError('Аккаунт заблокирован')

    const useBalance = params.method === 'balance' || Boolean(params.useBalance)
    const item: Item = params.item ?? { kind: 'plan', plan: params.plan ?? 'start', period: params.period ?? 'month' }
    const q = await quoteItem(params.user, item, params.promoCode, useBalance)
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
        achDiscountRub: q.achDiscount,
        achRewardIds: q.achRewardIds,
        promoCodeId: promo?.id ?? null,
        planPurchased: q.product === 'traffic' || q.product === 'device' ? null : q.plan,
        periodDays: q.product === 'plan' ? (q.period === 'year' ? 365 : 30) : q.product === 'upgrade' ? 0 : 30,
        product: q.product,
        addonAmount: q.addonAmount,
        starsAmount: method === 'stars' ? q.stars : null,
        autoRenew: q.product === 'plan' && Boolean(params.autoRenew),
      },
    })

    if (onlyBalance) {
      await completePayment(orderId)
      return { orderId, status: 'paid' as const, quote: q, payload: null }
    }

    const invoice = await provider!.createInvoice({
      orderId,
      amountRub: method === 'stars' ? q.stars : q.toPay,
      description: `LYNK: ${q.title}`,
      tgUserId: Number(params.user.tgId),
      email: params.user.email ?? undefined,
    })
    // Id у провайдера (транзакция Platega, платёж ЮKassa): по нему платёж ищется в админке ещё до оплаты.
    if (invoice.externalId) await prisma.payment.update({ where: { id: payment.id }, data: { externalId: invoice.externalId } })
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
        data: { status: 'paid', paidAt: new Date(), ...(externalId ? { externalId } : {}) },
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
      // Разовые скидки за достижения, учтённые в цене, израсходованы.
      if (achievements) await achievements.consumeDiscounts(tx, payment.achRewardIds, payment.id)

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
    const activated = await activatePayment(payment, user).then(
      () => true,
      async (err: Error) => {
        await prisma.paymentLog.create({ data: { orderId, event: 'activation_failed', payload: { error: err.message } } })
        await notifyStaff(`⚠️ Оплата ${orderId} прошла, но выдать доступ на панели не удалось: ${err.message}\nПовторим автоматически в течение 10 минут.`)
        return false
      },
    )
    // Достижения за покупку (годовой, ранний доступ, промокоды, возвращение, лояльность) — до события 'paid',
    // чтобы бонусные дни уже были видны, когда фронт перезагрузит /me.
    if (achievements) {
      await achievements.evaluate(user).catch(() => undefined)
      if (user.referrerId) await achievements.evaluateById(user.referrerId).catch(() => undefined)
    }
    // Событие 'paid' пишем последним: по нему фронт понимает, что подписка уже выдана (GET /payments/order/:id).
    await prisma.paymentLog.create({ data: { orderId, event: 'paid', payload: { externalId: externalId ?? null } } })
    onPaid?.(payment.id)
    if (user.referrerId) await updateReferrerLevel(user.referrerId).catch(() => undefined)
    const title = productTitle(payment)
    const isPlan = payment.product === 'plan' || !payment.product
    await notify(
      user.tgId,
      activated
        ? `✅ <b>${isPlan ? 'Подписка активирована' : payment.product === 'upgrade' ? 'Теперь у вас «Премиум»' : 'Готово'}</b>\n${title}. Спасибо, что вы с нами!`
        : `✅ <b>Оплата получена</b>\n${title}. Доступ выдаём, это займёт несколько минут: пришлём сообщение, как всё будет готово.`,
    )
    return true
  }

  /** Выдача доступа по оплаченному платежу + отметка 'activated' в логе. */
  async function activatePayment(payment: Payment, user: User, retry = false) {
    const plan = (payment.planPurchased ?? 'start') as PaidPlan
    let subId: string | null = null
    if (payment.product === 'upgrade') {
      // Срок тот же, меняется только тариф (лимиты на панели пересчитываются).
      const sub = await vpn.changePlan(user, 'pro')
      if (!sub) throw new Error('подписка закончилась до оплаты перехода')
      subId = sub.id.toString()
    } else if (payment.product === 'traffic' || payment.product === 'device') {
      await vpn.addAddon(user, payment.product, payment.addonAmount ?? 0, payment.id)
    } else {
      const sub = await vpn.activate(user, plan, payment.periodDays, 'active')
      if (payment.autoRenew) await prisma.subscription.update({ where: { id: sub.id }, data: { autoRenew: true } })
      subId = sub.id.toString()
    }
    await prisma.paymentLog.create({ data: { orderId: payment.orderId, event: 'activated', payload: { subscriptionId: subId, product: payment.product, retry } } })
  }

  /** Платежи, по которым оплата прошла, а доступ не выдался (панель была недоступна). */
  async function pendingActivations(since = new Date(Date.now() - 7 * DAY)) {
    const failed = await prisma.paymentLog.findMany({
      where: { event: 'activation_failed', createdAt: { gte: since } },
      select: { orderId: true },
      distinct: ['orderId'],
    })
    const out: string[] = []
    for (const { orderId } of failed) {
      const done = await prisma.paymentLog.count({ where: { orderId, event: 'activated' } })
      if (!done) out.push(orderId)
    }
    return out
  }

  /** Повторная выдача доступа (джоба раз в 10 минут и кнопка в админке). */
  async function retryActivation(orderId: string) {
    const payment = await prisma.payment.findUnique({ where: { orderId }, include: { user: true } })
    if (!payment || payment.status !== 'paid') return false
    // Только если выдача падала и ещё не удалась: иначе продлили бы второй раз.
    if (!(await needsActivation(orderId))) return false
    await activatePayment(payment, payment.user, true)
    await notify(payment.user.tgId, `✅ <b>Готово</b>\n${productTitle(payment)}: доступ выдан, можно подключаться. Спасибо, что вы с нами!`)
    return true
  }

  async function needsActivation(orderId: string) {
    const [failed, done] = await Promise.all([
      prisma.paymentLog.count({ where: { orderId, event: 'activation_failed' } }),
      prisma.paymentLog.count({ where: { orderId, event: 'activated' } }),
    ])
    return failed > 0 && done === 0
  }

  async function retryFailedActivations() {
    let fixed = 0
    for (const orderId of await pendingActivations()) {
      if (await retryActivation(orderId).catch(() => false)) fixed++
    }
    return fixed
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
      // Забираем начисление атомарно (status: hold → paid): если джоба и кнопка «Снять все холды»
      // сработали одновременно, деньги не зачислятся дважды.
      const credited = await prisma.$transaction(async (tx) => {
        const claimed = await tx.referralPayout.updateMany({ where: { id: p.id, status: 'hold' }, data: { status: 'paid' } })
        if (!claimed.count) return false
        await tx.user.update({ where: { id: p.referrerId }, data: { balanceRub: { increment: p.amountRub } } })
        await tx.balanceTx.create({ data: { userId: p.referrerId, amountRub: p.amountRub, kind: 'referral', paymentId: p.paymentId } })
        return true
      })
      if (!credited) continue
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
    const s = await settings.get()
    for (const sub of soon) {
      if (sub.plan === 'free') continue
      // Уже продлили (есть подписка дольше этой): второй раз не списываем.
      const later = await prisma.subscription.count({ where: { userId: sub.userId, expiresAt: { gt: sub.expiresAt } } })
      if (later) continue
      // Период берём из последней оплаты этого тарифа. Раньше он считался по длине строки
      // подписки, а после досрочного продления она длиннее 40 дней, и списывалась цена за год.
      const last = await prisma.payment.findFirst({
        where: { userId: sub.userId, status: 'paid', planPurchased: sub.plan, product: 'plan' },
        orderBy: { paidAt: 'desc' },
      })
      const period: Period = (last?.periodDays ?? 30) >= 365 ? 'year' : 'month'
      const price = s.prices[sub.plan][period]
      if (Number(sub.user.balanceRub) < price) continue
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

  /**
   * Обнуление рефералки (накрутка): отвязать приглашённых, отменить начисления на холде,
   * сбросить уровень. withBalance: ещё и списать уже зачисленные реферальные бонусы.
   */
  async function resetReferrals(referrerId: bigint, withBalance: boolean) {
    return prisma.$transaction(async (tx) => {
      const unlinked = await tx.user.updateMany({ where: { referrerId }, data: { referrerId: null } })
      await tx.referral.deleteMany({ where: { referrerId } })
      const holds = await tx.referralPayout.updateMany({ where: { referrerId, status: 'hold' }, data: { status: 'cancelled' } })
      let clawback = 0
      if (withBalance) {
        const paid = await tx.referralPayout.aggregate({ where: { referrerId, status: 'paid' }, _sum: { amountRub: true } })
        const user = await tx.user.findUniqueOrThrow({ where: { id: referrerId } })
        clawback = Math.min(Number(user.balanceRub), Number(paid._sum.amountRub ?? 0))
        await tx.referralPayout.updateMany({ where: { referrerId, status: 'paid' }, data: { status: 'cancelled' } })
        if (clawback > 0) {
          await tx.user.update({ where: { id: referrerId }, data: { balanceRub: { decrement: clawback } } })
          await tx.balanceTx.create({ data: { userId: referrerId, amountRub: -clawback, kind: 'admin', note: 'Обнуление рефералки' } })
        }
      }
      await tx.user.update({ where: { id: referrerId }, data: { referralLevel: 0 } })
      return { unlinked: unlinked.count, holdsCancelled: holds.count, clawback }
    })
  }

  return {
    resetReferrals,
    quote,
    quoteItem,
    offers,
    createOrder,
    completePayment,
    refundToBalance,
    releaseHolds,
    adjustBalance,
    autoRenewFromBalance,
    updateReferrerLevel,
    pendingActivations,
    needsActivation,
    retryActivation,
    retryFailedActivations,
  }
}

export type BillingService = ReturnType<typeof createBillingService>
