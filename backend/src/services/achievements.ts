import type { Prisma, PrismaClient, User, UserReward } from '@prisma/client'
import type { Notifier } from './billing'
import type { RewardSpec, SettingsService } from './settings'
import type { VpnService } from './vpn'

const DAY = 24 * 60 * 60 * 1000
/** Тема тикета с отзывом: по ней засчитывается бейдж «Обратная связь». */
const FEEDBACK_SUBJECT = 'Отзыв о сервисе'

export type AchCategory = 'social' | 'loyalty' | 'special' | 'secret'
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface AchDef {
  code: string
  category: AchCategory
  rarity: Rarity
  title: { ru: string; en: string }
  desc: { ru: string; en: string }
  /** Для секретных: условие видно только админу. */
  secret?: boolean
  /** Цель для прогресс-бара (рефералы, месяцы, промокоды…). */
  target?: number
  rewards: RewardSpec[]
}

/**
 * ТЗ v6.3 · 03. 13 бейджей + 3 секретных. Каждый требует осознанного действия:
 * приглашение, покупка, лояльность. За автоматические шаги (первое подключение) бейджей нет.
 */
export const ACHIEVEMENTS: AchDef[] = [
  // 3.2 Социальные
  {
    code: 'first_friend',
    category: 'social',
    rarity: 'common',
    title: { ru: 'Первый друг', en: 'First friend' },
    desc: { ru: 'Приглашён 1 активный реферал', en: 'Invited 1 active referral' },
    target: 1,
    rewards: [{ kind: 'days', value: 3 }],
  },
  {
    code: 'sharing',
    category: 'social',
    rarity: 'common',
    title: { ru: 'Шеринг', en: 'Sharing' },
    desc: { ru: 'Поделился ссылкой на бота в соцсетях или чате', en: 'Shared the bot link in a chat or social network' },
    rewards: [{ kind: 'discount', value: 5 }],
  },
  {
    code: 'referrer',
    category: 'social',
    rarity: 'rare',
    title: { ru: 'Реферер', en: 'Referrer' },
    desc: { ru: '5 активных рефералов с оплатой', en: '5 active referrals who paid' },
    target: 5,
    rewards: [
      { kind: 'device', value: 1 },
      { kind: 'days', value: 3 },
    ],
  },
  {
    code: 'gold_referrer',
    category: 'social',
    rarity: 'epic',
    title: { ru: 'Золотой реферер', en: 'Gold referrer' },
    desc: { ru: '20 активных рефералов с оплатой', en: '20 active referrals who paid' },
    target: 20,
    rewards: [
      { kind: 'device', value: 2 },
      { kind: 'discount', value: 10 },
    ],
  },
  {
    code: 'ambassador',
    category: 'social',
    rarity: 'legendary',
    title: { ru: 'Посол', en: 'Ambassador' },
    desc: { ru: '50 активных рефералов с оплатой', en: '50 active referrals who paid' },
    target: 50,
    rewards: [{ kind: 'discount', value: 15, validDays: 365, reusable: true }],
  },
  // 3.3 Лояльность
  {
    code: 'yearly',
    category: 'loyalty',
    rarity: 'rare',
    title: { ru: 'Годовой', en: 'Yearly' },
    desc: { ru: 'Купил годовую подписку — вложение в долгий срок', en: 'Bought a yearly subscription' },
    rewards: [{ kind: 'device', value: 1, forever: true }],
  },
  {
    code: 'loyal',
    category: 'loyalty',
    rarity: 'epic',
    title: { ru: 'Лояльный', en: 'Loyal' },
    desc: { ru: '6 месяцев непрерывной подписки', en: '6 months of continuous subscription' },
    target: 6,
    rewards: [{ kind: 'discount', value: 10 }],
  },
  {
    code: 'faithful',
    category: 'loyalty',
    rarity: 'legendary',
    title: { ru: 'Верный', en: 'Faithful' },
    desc: { ru: '12 месяцев непрерывной подписки', en: '12 months of continuous subscription' },
    target: 12,
    rewards: [
      { kind: 'device', value: 1 },
      { kind: 'discount', value: 10 },
    ],
  },
  {
    code: 'veteran',
    category: 'loyalty',
    rarity: 'legendary',
    title: { ru: 'Ветеран', en: 'Veteran' },
    desc: { ru: '24 месяца непрерывной подписки', en: '24 months of continuous subscription' },
    target: 24,
    rewards: [{ kind: 'discount', value: 15, validDays: null, reusable: true }],
  },
  // 3.4 Особые
  {
    code: 'transfer',
    category: 'special',
    rarity: 'rare',
    title: { ru: 'Перенос', en: 'Transfer' },
    desc: { ru: 'Успешно перенёс подписку с другого сервиса', en: 'Transferred a subscription from another service' },
    rewards: [{ kind: 'days', value: 3 }],
  },
  {
    code: 'early',
    category: 'special',
    rarity: 'rare',
    title: { ru: 'Ранний доступ', en: 'Early access' },
    desc: { ru: 'Купил подписку в первый месяц запуска сервиса', en: 'Bought a subscription in the first month after launch' },
    rewards: [{ kind: 'days', value: 5 }],
  },
  {
    code: 'feedback',
    category: 'special',
    rarity: 'rare',
    title: { ru: 'Обратная связь', en: 'Feedback' },
    desc: { ru: 'Оставил отзыв о сервисе в канале или поддержке', en: 'Left a review in the channel or support' },
    rewards: [{ kind: 'days', value: 2 }],
  },
  {
    code: 'promo_hunter',
    category: 'special',
    rarity: 'common',
    title: { ru: 'Промо-охотник', en: 'Promo hunter' },
    desc: { ru: 'Активировал 3 промокода', en: 'Used 3 promo codes' },
    target: 3,
    rewards: [{ kind: 'discount', value: 5 }],
  },
  // 3.5 Секретные: до разблокировки пользователь видит «???»
  {
    code: 'comeback',
    category: 'secret',
    rarity: 'rare',
    secret: true,
    title: { ru: 'Возвращение', en: 'Comeback' },
    desc: { ru: 'Вернулся и оплатил подписку после перерыва от 7 дней', en: 'Came back and paid after a break of 7+ days' },
    rewards: [{ kind: 'days', value: 3 }],
  },
  {
    code: 'collector',
    category: 'secret',
    rarity: 'epic',
    secret: true,
    title: { ru: 'Коллекционер', en: 'Collector' },
    desc: { ru: 'Получил 8 достижений', en: 'Unlocked 8 achievements' },
    target: 8,
    rewards: [{ kind: 'device', value: 1 }],
  },
  {
    code: 'legend',
    category: 'secret',
    rarity: 'legendary',
    secret: true,
    title: { ru: 'Легенда LYNK', en: 'LYNK legend' },
    desc: { ru: 'Получил все 13 основных достижений', en: 'Unlocked all 13 main achievements' },
    target: 13,
    rewards: [
      { kind: 'days', value: 5 },
      { kind: 'discount', value: 15 },
    ],
  },
]

export const ACH_BY_CODE = new Map(ACHIEVEMENTS.map((a) => [a.code, a]))
const MAIN_CODES = ACHIEVEMENTS.filter((a) => !a.secret).map((a) => a.code)

export const RARITY_NAMES: Record<Rarity, string> = { common: 'Обычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное' }

/** «+3 дня», «10% скидка», «+1 устройство навсегда». */
export function rewardLabel(r: RewardSpec, lang: 'ru' | 'en' = 'ru') {
  if (r.kind === 'days') return lang === 'en' ? `+${r.value} days` : `+${r.value} ${daysRu(r.value)}`
  if (r.kind === 'device') {
    const n = lang === 'en' ? `+${r.value} device${r.value > 1 ? 's' : ''}` : `+${r.value} ${r.value === 1 ? 'устройство' : 'устройства'}`
    return r.forever ? `${n} ${lang === 'en' ? 'forever' : 'навсегда'}` : n
  }
  const tail = r.validDays === null ? (lang === 'en' ? ' forever' : ' навсегда') : r.reusable && r.validDays === 365 ? (lang === 'en' ? ' for a year' : ' на год') : ''
  return lang === 'en' ? `${r.value}% discount${tail}` : `${r.value}% скидка${tail}`
}
function daysRu(n: number) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'день'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня'
  return 'дней'
}

/** Непрерывные отрезки подписки (без Trial и дней команды проекта), самый длинный — в днях. */
function longestStreakDays(rows: { startedAt: Date; expiresAt: Date }[], now = Date.now()) {
  const intervals = rows
    .map((r) => [r.startedAt.getTime(), Math.min(r.expiresAt.getTime(), now)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])
  let best = 0
  let cur: [number, number] | null = null
  for (const [s, e] of intervals) {
    // Разрыв меньше суток не считаем перерывом (оплата в день окончания).
    if (cur && s <= cur[1] + DAY) cur[1] = Math.max(cur[1], e)
    else {
      if (cur) best = Math.max(best, cur[1] - cur[0])
      cur = [s, e]
    }
  }
  if (cur) best = Math.max(best, cur[1] - cur[0])
  return Math.floor(best / DAY)
}

export function createAchievementService(deps: {
  prisma: PrismaClient
  settings: SettingsService
  vpn: VpnService
  notify: Notifier
}) {
  const { prisma, settings, vpn, notify } = deps

  async function rewardsFor(code: string): Promise<RewardSpec[]> {
    const s = await settings.get()
    return s.achievementRewards?.[code] ?? ACH_BY_CODE.get(code)?.rewards ?? []
  }

  /** Сырые показатели пользователя для условий и прогресса. */
  async function stats(user: User) {
    const s = await settings.get()
    const launch = new Date(`${s.launchDate}T00:00:00+03:00`)
    const [paidReferrals, invited, yearly, subs, transfer, early, promoUses, payments, feedback] = await Promise.all([
      prisma.user.count({ where: { referrerId: user.id, payments: { some: { status: 'paid' } } } }),
      prisma.user.count({ where: { referrerId: user.id } }),
      prisma.payment.count({ where: { userId: user.id, status: 'paid', periodDays: { gte: 365 } } }),
      prisma.subscription.findMany({ where: { userId: user.id, source: { in: ['payment', 'gift', 'transfer'] } }, select: { startedAt: true, expiresAt: true } }),
      prisma.transferRequest.count({ where: { userId: user.id, status: 'approved' } }),
      prisma.payment.count({ where: { userId: user.id, status: 'paid', paidAt: { gte: launch, lt: new Date(launch.getTime() + 30 * DAY) } } }),
      prisma.promoUse.count({ where: { userId: user.id } }),
      prisma.payment.findMany({ where: { userId: user.id, status: 'paid' }, select: { paidAt: true, amountRub: true, balanceUsedRub: true } }),
      prisma.supportTicket.count({ where: { userId: user.id, subject: { startsWith: FEEDBACK_SUBJECT } } }),
    ])
    const paidAny = payments.some((p) => Number(p.amountRub) + Number(p.balanceUsedRub) > 0)
    const streakMonths = paidAny ? Math.floor(longestStreakDays(subs) / 30) : 0

    // «Возвращение»: оплата, когда прошлая подписка закончилась 7+ дней назад.
    let comeback = false
    if (payments.length) {
      const all = await prisma.subscription.findMany({ where: { userId: user.id }, select: { startedAt: true, expiresAt: true } })
      for (const p of payments) {
        const at = p.paidAt?.getTime()
        if (!at) continue
        const prevEnd = Math.max(0, ...all.filter((r) => r.startedAt.getTime() < at - 60_000).map((r) => r.expiresAt.getTime()))
        if (prevEnd && at - prevEnd >= 7 * DAY) comeback = true
      }
    }
    return { paidReferrals, invited, yearly, streakMonths, transfer, early, promoUses, comeback, feedback }
  }

  type Stats = Awaited<ReturnType<typeof stats>>

  /** Прогресс и выполнено ли условие. */
  function progressOf(code: string, st: Stats, unlocked: Set<string>): { value: number; target: number; done: boolean } {
    const mainDone = MAIN_CODES.filter((c) => unlocked.has(c)).length
    switch (code) {
      case 'first_friend':
        return { value: st.paidReferrals, target: 1, done: st.paidReferrals >= 1 }
      case 'sharing':
        // Засчитываем, когда по ссылке кто-то пришёл (явное «поделился» из Mini App разблокирует сразу).
        return { value: Math.min(st.invited, 1), target: 1, done: st.invited >= 1 }
      case 'referrer':
        return { value: st.paidReferrals, target: 5, done: st.paidReferrals >= 5 }
      case 'gold_referrer':
        return { value: st.paidReferrals, target: 20, done: st.paidReferrals >= 20 }
      case 'ambassador':
        return { value: st.paidReferrals, target: 50, done: st.paidReferrals >= 50 }
      case 'yearly':
        return { value: Math.min(st.yearly, 1), target: 1, done: st.yearly > 0 }
      case 'loyal':
        return { value: st.streakMonths, target: 6, done: st.streakMonths >= 6 }
      case 'faithful':
        return { value: st.streakMonths, target: 12, done: st.streakMonths >= 12 }
      case 'veteran':
        return { value: st.streakMonths, target: 24, done: st.streakMonths >= 24 }
      case 'transfer':
        return { value: Math.min(st.transfer, 1), target: 1, done: st.transfer > 0 }
      case 'early':
        return { value: Math.min(st.early, 1), target: 1, done: st.early > 0 }
      case 'feedback':
        return { value: Math.min(st.feedback, 1), target: 1, done: st.feedback > 0 }
      case 'promo_hunter':
        return { value: st.promoUses, target: 3, done: st.promoUses >= 3 }
      case 'comeback':
        return { value: st.comeback ? 1 : 0, target: 1, done: st.comeback }
      case 'collector':
        return { value: unlocked.size, target: 8, done: unlocked.size >= 8 }
      case 'legend':
        return { value: mainDone, target: 13, done: mainDone >= 13 }
      default:
        return { value: 0, target: 1, done: false }
    }
  }

  /** Выдать награды за бейдж: дни сразу, скидки и устройства записями UserReward. */
  async function grantRewards(user: User, code: string) {
    const s = await settings.get()
    const specs = await rewardsFor(code)
    let deviceGranted = false
    for (const r of specs) {
      if (r.kind === 'days') {
        await vpn.grant(user, 'start', r.value, 'gift')
        await prisma.userReward.create({ data: { userId: user.id, code, kind: 'days', value: r.value, usedAt: new Date() } })
      } else if (r.kind === 'discount') {
        const validDays = r.validDays === undefined ? s.achievementDiscountDays : r.validDays
        await prisma.userReward.create({
          data: {
            userId: user.id,
            code,
            kind: 'discount',
            value: r.value,
            reusable: Boolean(r.reusable),
            expiresAt: validDays === null ? null : new Date(Date.now() + validDays * DAY),
          },
        })
      } else {
        await prisma.userReward.create({ data: { userId: user.id, code, kind: 'device', value: r.value, lapseWithSub: !r.forever } })
        deviceGranted = true
      }
    }
    if (deviceGranted) await vpn.refreshLimits(user).catch(() => undefined)
    return specs
  }

  /**
   * Разблокировать бейдж (условие выполнено, событие из Mini App или ручная выдача).
   * Возвращает false, если он уже был.
   */
  async function unlock(user: User, code: string, opts: { byTgId?: number; silent?: boolean } = {}) {
    const def = ACH_BY_CODE.get(code)
    if (!def) throw new Error(`Неизвестное достижение ${code}`)
    try {
      await prisma.userAchievement.create({ data: { userId: user.id, code, grantedByTgId: opts.byTgId ? BigInt(opts.byTgId) : null } })
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return false
      throw err
    }
    const specs = await grantRewards(user, code)
    if (!opts.silent) {
      await notify(
        user.tgId,
        `🏆 <b>Новое достижение: ${def.title.ru}</b>\n${def.desc.ru}\n\nНаграда: <b>${specs.map((r) => rewardLabel(r)).join(', ') || 'бейдж'}</b>\nЗакрепите бейдж в разделе «Аккаунт → Достижения».`,
      )
    }
    return true
  }

  /** Проверить все условия и выдать новые бейджи. Вызывается после оплат, переноса, рефералов и джобой. */
  async function evaluate(user: User) {
    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id }, select: { code: true } })
    const unlocked = new Set(rows.map((r) => r.code))
    const st = await stats(user)
    const fresh: string[] = []
    // Два прохода: мета-бейджи («Коллекционер», «Легенда») зависят от только что полученных.
    for (let pass = 0; pass < 2; pass++) {
      for (const def of ACHIEVEMENTS) {
        if (unlocked.has(def.code)) continue
        if (!progressOf(def.code, st, unlocked).done) continue
        if (await unlock(user, def.code)) {
          unlocked.add(def.code)
          fresh.push(def.code)
        }
      }
    }
    return fresh
  }

  async function evaluateById(userId: bigint) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    return user ? evaluate(user) : []
  }

  /** Активные скидки: разовые (не использованы, не истекли, «применить к следующему») и многоразовые. */
  async function activeDiscounts(userId: bigint) {
    const now = new Date()
    return prisma.userReward.findMany({
      where: { userId, kind: 'discount', revokedAt: null, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'asc' },
    })
  }

  /** Сколько процентов даст следующий платёж (сумма, но не больше потолка из настроек). */
  async function discountFor(userId: bigint) {
    const s = await settings.get()
    const rows = (await activeDiscounts(userId)).filter((r) => r.applyNext || r.reusable)
    const sum = rows.reduce((a, r) => a + r.value, 0)
    return {
      percent: Math.min(sum, s.achievementMaxDiscount),
      rewardIds: rows.filter((r) => !r.reusable).map((r) => r.id.toString()),
    }
  }

  /** После оплаты: разовые скидки израсходованы. */
  async function consumeDiscounts(tx: Prisma.TransactionClient, ids: unknown, paymentId: bigint) {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && /^\d+$/.test(x)).map((x) => BigInt(x)) : []
    if (!list.length) return
    await tx.userReward.updateMany({ where: { id: { in: list }, usedAt: null, reusable: false }, data: { usedAt: new Date(), usedPaymentId: paymentId } })
  }

  /** Все бейджи с прогрессом для Mini App (секретные скрыты до получения). */
  async function list(user: User, lang: 'ru' | 'en' = 'ru') {
    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id } })
    const byCode = new Map(rows.map((r) => [r.code, r]))
    const unlocked = new Set(byCode.keys())
    const st = await stats(user)
    const out = []
    for (const def of ACHIEVEMENTS) {
      const row = byCode.get(def.code)
      const hidden = def.secret && !row
      const p = progressOf(def.code, st, unlocked)
      const rewards = await rewardsFor(def.code)
      out.push({
        code: def.code,
        category: def.category,
        rarity: def.rarity,
        secret: Boolean(def.secret),
        unlocked: Boolean(row),
        unlockedAt: row?.unlockedAt.toISOString() ?? null,
        showcaseSlot: row?.showcaseSlot ?? null,
        title: hidden ? '???' : def.title[lang],
        desc: hidden ? (lang === 'en' ? 'Keep using the service to unlock' : 'Продолжайте пользоваться сервисом, чтобы разблокировать') : def.desc[lang],
        progress: hidden || !def.target ? null : { value: Math.min(p.value, p.target), target: p.target },
        rewards: hidden ? [{ kind: rewards[0]?.kind ?? 'days', label: '???' }] : rewards.map((r) => ({ kind: r.kind, label: rewardLabel(r, lang) })),
        date: def.code === 'early' && !hidden ? (await settings.get()).launchDate : null,
      })
    }
    return out
  }

  /** «Мои награды»: начисленные дни, активные скидки, бонусные устройства. */
  async function rewardsSummary(user: User) {
    const s = await settings.get()
    const [days, discounts, devices, next] = await Promise.all([
      prisma.userReward.aggregate({ where: { userId: user.id, kind: 'days' }, _sum: { value: true } }),
      activeDiscounts(user.id),
      prisma.userReward.findMany({ where: { userId: user.id, kind: 'device', revokedAt: null } }),
      discountFor(user.id),
    ])
    const title = (code: string | null) => (code ? (ACH_BY_CODE.get(code)?.title.ru ?? code) : 'LYNK')
    return {
      daysGranted: days._sum.value ?? 0,
      discounts: discounts.map((r: UserReward) => ({
        id: r.id.toString(),
        percent: r.value,
        from: title(r.code),
        code: r.code,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        reusable: r.reusable,
        applyNext: r.applyNext || r.reusable,
      })),
      bonusDevices: devices.reduce((a, r) => a + r.value, 0),
      devices: devices.map((r) => ({ id: r.id.toString(), value: r.value, from: title(r.code), forever: !r.lapseWithSub })),
      nextPaymentDiscount: next.percent,
      maxDiscount: s.achievementMaxDiscount,
    }
  }

  async function setApplyNext(user: User, rewardId: bigint, enabled: boolean) {
    const r = await prisma.userReward.updateMany({ where: { id: rewardId, userId: user.id, kind: 'discount', reusable: false, usedAt: null }, data: { applyNext: enabled } })
    return r.count > 0
  }

  /** Шоукейс: до 3 полученных бейджей по порядку. */
  async function setShowcase(user: User, codes: string[]) {
    const unique = [...new Set(codes)].slice(0, 3)
    const owned = await prisma.userAchievement.findMany({ where: { userId: user.id, code: { in: unique } }, select: { code: true } })
    const ok = unique.filter((c) => owned.some((o) => o.code === c))
    await prisma.$transaction([
      prisma.userAchievement.updateMany({ where: { userId: user.id }, data: { showcaseSlot: null } }),
      ...ok.map((code, i) => prisma.userAchievement.update({ where: { userId_code: { userId: user.id, code } }, data: { showcaseSlot: i } })),
    ])
    return showcase(user)
  }

  async function showcase(user: User, lang: 'ru' | 'en' = 'ru') {
    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id, showcaseSlot: { not: null } }, orderBy: { showcaseSlot: 'asc' } })
    return rows.flatMap((r) => {
      const def = ACH_BY_CODE.get(r.code)
      return def ? [{ slot: r.showcaseSlot!, code: r.code, rarity: def.rarity, title: def.title[lang] }] : []
    })
  }

  /** Отзыв из Mini App (≥ 30 символов): тикет в поддержку + бейдж «Обратная связь». */
  async function leaveFeedback(user: User, rating: number, text: string) {
    const ticket = await prisma.supportTicket.create({ data: { userId: user.id, subject: `${FEEDBACK_SUBJECT} · ${rating}/5` } })
    await prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorTgId: user.tgId, text: `Оценка: ${rating}/5\n\n${text}` } })
    const unlocked = await unlock(user, 'feedback')
    return { ticketId: ticket.id.toString(), unlocked }
  }

  /** Аналитика для админки. */
  async function analytics() {
    const month = new Date(Date.now() - 30 * DAY)
    const [counts, daysMonth, activeDiscountsN, devices, users, withBadges] = await Promise.all([
      prisma.userAchievement.groupBy({ by: ['code'], _count: true }),
      prisma.userReward.aggregate({ where: { kind: 'days', createdAt: { gte: month } }, _sum: { value: true } }),
      prisma.userReward.count({ where: { kind: 'discount', revokedAt: null, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      prisma.userReward.aggregate({ where: { kind: 'device', revokedAt: null }, _sum: { value: true } }),
      prisma.user.count({ where: { createdAt: { lte: new Date(Date.now() - 90 * DAY) } } }),
      prisma.userAchievement.findMany({ distinct: ['userId'], select: { userId: true } }),
    ])
    const byCode = new Map(counts.map((c) => [c.code, c._count]))
    const ranked = ACHIEVEMENTS.map((a) => ({ code: a.code, title: a.title.ru, count: byCode.get(a.code) ?? 0 }))
    // Корреляция с retention: доля с активной подпиской среди старожилов (90+ дней) с бейджами и без.
    const badgeIds = withBadges.map((b) => b.userId)
    const oldWhere = { createdAt: { lte: new Date(Date.now() - 90 * DAY) } }
    const activeSub = { subscriptions: { some: { status: { in: ['trial' as const, 'active' as const] }, expiresAt: { gt: new Date() } } } }
    const [oldWith, oldWithActive, oldWithoutActive] = await Promise.all([
      prisma.user.count({ where: { ...oldWhere, id: { in: badgeIds } } }),
      prisma.user.count({ where: { ...oldWhere, id: { in: badgeIds }, ...activeSub } }),
      prisma.user.count({ where: { ...oldWhere, id: { notIn: badgeIds }, ...activeSub } }),
    ])
    const oldWithout = users - oldWith
    return {
      top: [...ranked].sort((a, b) => b.count - a.count).slice(0, 5),
      rarest: [...ranked].sort((a, b) => a.count - b.count).slice(0, 3),
      all: ranked,
      daysMonth: daysMonth._sum.value ?? 0,
      activeDiscounts: activeDiscountsN,
      bonusDevices: devices._sum.value ?? 0,
      retentionWith: oldWith ? Math.round((oldWithActive / oldWith) * 100) : null,
      retentionWithout: oldWithout ? Math.round((oldWithoutActive / oldWithout) * 100) : null,
    }
  }

  return {
    rewardsFor,
    stats,
    evaluate,
    evaluateById,
    unlock,
    discountFor,
    consumeDiscounts,
    list,
    rewardsSummary,
    setApplyNext,
    setShowcase,
    showcase,
    leaveFeedback,
    analytics,
  }
}

export type AchievementService = ReturnType<typeof createAchievementService>
