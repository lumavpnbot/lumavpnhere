import type { PrismaClient, SubscriptionPlan, User } from '@prisma/client'
import type { PanelClient, PanelProvider } from '@/panel'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

// Лимиты тарифов (ТЗ раздел 5). null = без ограничения.
export const PLAN_LIMITS: Record<SubscriptionPlan, { devices: number | null; trafficGb: number | null }> = {
  free: { devices: 1, trafficGb: 5 },
  start: { devices: 3, trafficGb: 100 },
  pro: { devices: 5, trafficGb: null },
}

/**
 * Порядок «самая свежая подписка первой». Второй ключ (id) обязателен: при смене
 * тарифа или продлении на 0 дней у двух строк одинаковый expiresAt, и без него
 * Postgres возвращал любую из них, поэтому тариф «не обновлялся».
 */
export const LATEST_FIRST = [{ expiresAt: 'desc' as const }, { id: 'desc' as const }]

/** Условие «подписка действует сейчас». */
export const activeWhere = () => ({ status: { in: ['trial' as const, 'active' as const] }, expiresAt: { gt: new Date() } })

/**
 * Единая точка, через которую бизнес-логика выдаёт или продлевает VPN.
 * Сначала создаём/обновляем клиента на панели, потом пишем подписку в БД:
 * если панель недоступна, пользователь не получит «оплачено, но не работает».
 */
export type SubSource = 'trial' | 'payment' | 'gift' | 'transfer' | 'admin'

export function createVpnService(prisma: PrismaClient, panel: PanelProvider, isOwner: (tgId: number) => boolean = () => false) {
  /** Бонусные устройства за достижения (ТЗ 3.1): действуют, пока награда не отозвана. */
  async function bonusDevices(userId: bigint) {
    const r = await prisma.userReward.aggregate({ where: { userId, kind: 'device', revokedAt: null }, _sum: { value: true } })
    return r._sum.value ?? 0
  }

  /** Лимиты для панели: команде проекта без ограничений, остальным тариф + бонусные устройства. */
  async function limitsFor(user: User, plan: SubscriptionPlan) {
    if (isOwner(Number(user.tgId))) return { trafficGb: null, devices: null }
    const base = PLAN_LIMITS[plan]
    const bonus = base.devices == null ? 0 : await bonusDevices(user.id)
    return { trafficGb: base.trafficGb, devices: base.devices == null ? null : base.devices + bonus }
  }

  async function provision(user: User, plan: SubscriptionPlan, expiresAt: Date) {
    const limits = await limitsFor(user, plan)
    return panel.provision({ tgId: Number(user.tgId), expiresAt, trafficLimitGb: limits.trafficGb, deviceLimit: limits.devices })
  }

  /** Текущая действующая подписка (последняя по сроку). */
  async function current(userId: bigint) {
    return prisma.subscription.findFirst({ where: { userId, ...activeWhere() }, orderBy: LATEST_FIRST })
  }

  async function activate(user: User, plan: SubscriptionPlan, days: number, status: 'trial' | 'active', source?: SubSource) {
    const cur = await current(user.id)
    // Продление: добавляем дни к текущему сроку, а не с сегодняшнего дня.
    const from = cur ? cur.expiresAt.getTime() : Date.now()
    const expiresAt = new Date(from + days * DAY)

    await provision(user, plan, expiresAt)

    return prisma.subscription.create({
      data: { userId: user.id, plan, status, expiresAt, source: source ?? (status === 'trial' ? 'trial' : 'payment') },
    })
  }

  /** Есть ли сейчас оплаченное время (перенос требует, чтобы его не было; Trial и подарки не считаются). */
  async function hasPaidActive(userId: bigint) {
    const n = await prisma.subscription.count({ where: { userId, source: 'payment', status: 'active', expiresAt: { gt: new Date() } } })
    return n > 0
  }

  /** Пересчитать лимиты на панели (например, после выдачи бонусного устройства). */
  async function refreshLimits(user: User) {
    const cur = await current(user.id)
    if (cur) await provision(user, cur.plan, cur.expiresAt)
  }

  /**
   * Сверка панели с БД (БД главная). Если клиента на панели нет, он выключен
   * или срок там меньше, чем оплачено, выдаём доступ заново с данными из БД.
   * Так подписка «чинится» сама после сбоя панели или неудачного продления.
   */
  async function sync(user: User, client?: PanelClient | null) {
    const sub = await current(user.id)
    if (!sub) return { sub: null, client: client ?? null, repaired: false }
    const c = client === undefined ? await panel.getClient(Number(user.tgId)).catch(() => null) : client
    const drift = !c || !c.enabled || (c.expiresAt != null && c.expiresAt.getTime() < sub.expiresAt.getTime() - HOUR)
    if (!drift) return { sub, client: c, repaired: false }
    // Не чаще раза в 5 минут на человека: если панель хранит срок иначе (например, до полуночи),
    // не дёргаем её на каждое обновление подписки.
    const key = user.id.toString()
    const at = repairedAt.get(key) ?? 0
    if (c && Date.now() - at < 5 * 60_000) return { sub, client: c, repaired: false }
    repairedAt.set(key, Date.now())
    const fresh = await provision(user, sub.plan, sub.expiresAt)
    return { sub, client: fresh, repaired: true }
  }
  const repairedAt = new Map<string, number>()

  /**
   * Команда проекта (ADMIN_TELEGRAM_IDS): постоянный «Премиум» без оплаты.
   * Срок год вперёд, продлеваем автоматически при входе, когда осталось меньше 60 дней.
   */
  async function ensureAdmin(user: User) {
    const cur = await current(user.id)
    if (cur && cur.plan === 'pro' && cur.expiresAt.getTime() - Date.now() > 60 * DAY) {
      // Срок большой: только сверяем панель (клиент мог пропасть или инбаунды добавиться).
      await sync(user)
      return cur
    }
    const expiresAt = new Date(Math.max(Date.now() + 365 * DAY, cur?.expiresAt.getTime() ?? 0))
    await provision(user, 'pro', expiresAt)
    return prisma.subscription.create({ data: { userId: user.id, plan: 'pro', status: 'active', expiresAt, source: 'admin' } })
  }

  /**
   * Подарочные дни (бонус уровня, достижения, ручное продление из админки).
   * Премиум не понижаем до Старта: если сейчас Премиум, продлеваем Премиум.
   */
  async function grant(user: User, plan: SubscriptionPlan, days: number, source: SubSource = 'gift') {
    const cur = await current(user.id)
    if (days <= 0) return cur
    const effective: SubscriptionPlan = cur?.plan === 'pro' ? 'pro' : plan
    return activate(user, effective, days, 'active', source)
  }

  /** Смена тарифа без изменения срока: правим текущую подписку, а не плодим дубликат. */
  async function changePlan(user: User, plan: SubscriptionPlan) {
    const cur = await current(user.id)
    if (!cur) return null
    await provision(user, plan, cur.expiresAt)
    return prisma.subscription.update({ where: { id: cur.id }, data: { plan } })
  }

  return {
    activate,
    ensureAdmin,
    grant,
    current,
    sync,
    changePlan,
    bonusDevices,
    hasPaidActive,
    refreshLimits,
    /** Лимит устройств для приложения: тариф + бонусы, null = без ограничения. */
    async deviceLimit(user: User, plan: SubscriptionPlan) {
      return (await limitsFor(user, plan)).devices
    },

    async startTrial(user: User, days: number, force = false) {
      if (user.trialUsed && !force) return null
      const sub = await activate(user, 'start', days, 'trial')
      await prisma.user.update({ where: { id: user.id }, data: { trialUsed: true } })
      return sub
    },

    /**
     * Пересоздать всех действующих клиентов на панелях с теми же сроками и лимитами.
     * Нужно после добавления нового инбаунда (например XHTTP): иначе он появится
     * у пользователя только при следующем продлении.
     */
    async syncAll() {
      const subs = await prisma.subscription.findMany({
        where: activeWhere(),
        include: { user: true },
        orderBy: LATEST_FIRST,
      })
      const seen = new Set<bigint>()
      let ok = 0
      let failed = 0
      for (const sub of subs) {
        if (seen.has(sub.userId)) continue
        seen.add(sub.userId)
        try {
          await provision(sub.user, sub.plan, sub.expiresAt)
          ok++
        } catch {
          failed++
        }
      }
      return { ok, failed }
    },

    /** Досрочно завершить подписку (админ) и отключить клиента на панели. */
    async cancel(user: User) {
      await prisma.subscription.updateMany({
        where: { userId: user.id, status: { in: ['trial', 'active'] } },
        data: { status: 'expired', expiresAt: new Date() },
      })
      await panel.disable(Number(user.tgId)).catch(() => undefined)
    },

    /** Раз в N минут: отключить на панели тех, у кого подписка закончилась. */
    async expireOverdue() {
      const overdue = await prisma.subscription.findMany({
        where: { status: { in: ['trial', 'active'] }, expiresAt: { lte: new Date() } },
        include: { user: true },
      })
      for (const sub of overdue) {
        const stillActive = await prisma.subscription.count({ where: { userId: sub.userId, ...activeWhere() } })
        if (!stillActive) {
          await panel.disable(Number(sub.user.tgId)).catch(() => {})
          // Бонусные устройства (кроме «навсегда») привязаны к активной подписке: подписка закончилась — сгорают.
          await prisma.userReward.updateMany({ where: { userId: sub.userId, kind: 'device', lapseWithSub: true, revokedAt: null }, data: { revokedAt: new Date() } })
        }
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } })
      }
      return overdue.length
    },
  }
}

export type VpnService = ReturnType<typeof createVpnService>
