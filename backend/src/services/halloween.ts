import crypto from 'node:crypto'
import type { HalloweenSource, Prisma, PrismaClient, User } from '@prisma/client'
import { halloweenOf, type HalloweenPrize, type HalloweenSettings, type SettingsService } from './settings'
import type { VpnService } from './vpn'
import type { Notifier } from './billing'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

export type Phase = 'off' | 'before' | 'live' | 'closed' | 'published'

export const SOURCE_NAMES: Record<HalloweenSource, string> = {
  referral_join: 'Друг присоединился',
  referral_paid: 'Друг оплатил подписку',
  wheel: 'Колесо фортуны',
  admin: 'Начислено администрацией',
}

export interface SpinResult {
  ok: boolean
  /** Почему спин недоступен: no_sub | expires_soon | too_early | used | limit | closed | off. */
  reason?: string
  tickets: number
  /** Индекс выпавшего сектора: фронт докручивает колесо именно до него. */
  sector: number
  total: number
  nextSpinAt: string | null
}

/** Начало суток по Москве как дата без времени (ключ лимита «1 спин в сутки»). */
function mskDay(at = new Date()): Date {
  const msk = new Date(at.getTime() + 3 * HOUR)
  return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()))
}

/** Следующая полночь по Москве. */
function nextMskMidnight(at = new Date()): Date {
  return new Date(mskDay(at).getTime() + DAY - 3 * HOUR)
}

/** Сектор по весам из настроек. Шансы не обязаны давать ровно 100%: нормализуем. */
export function rollSector(sectors: { tickets: number; chance: number }[], random = Math.random): number {
  const total = sectors.reduce((a, s) => a + Math.max(0, s.chance), 0)
  if (total <= 0) return 0
  let roll = random() * total
  for (let i = 0; i < sectors.length; i++) {
    roll -= Math.max(0, sectors[i].chance)
    if (roll < 0) return i
  }
  return sectors.length - 1
}

/**
 * Хэллоуин-розыгрыш: билеты за рефералов и колесо фортуны, розыгрыш 21 приза.
 * Билет = одна строка в halloween_tickets = одна запись в лотерейном пуле.
 * Аннулированные билеты (отменённый платёж, абуз) не участвуют: revokedAt отсекает их везде.
 */
export function createHalloweenService(deps: {
  prisma: PrismaClient
  settings: SettingsService
  vpn: VpnService
  notify: Notifier
  notifyStaff: (text: string) => Promise<void>
}) {
  const { prisma, settings, vpn, notify, notifyStaff } = deps

  async function config(): Promise<HalloweenSettings> {
    return halloweenOf(await settings.get())
  }

  async function save(patch: Partial<HalloweenSettings>) {
    const next = { ...(await config()), ...patch }
    await settings.set('halloween', next)
    return next
  }

  function phaseOf(c: HalloweenSettings, now = Date.now()): Phase {
    if (!c.enabled) return 'off'
    if (now < Date.parse(c.startAt)) return 'before'
    if (c.intakeClosed || now > Date.parse(c.ticketsUntil)) return 'closed'
    return 'live'
  }

  /** Фаза с учётом уже опубликованных результатов. */
  async function phase(): Promise<Phase> {
    const c = await config()
    const p = phaseOf(c)
    if (p !== 'closed') return p
    const published = await prisma.halloweenDraw.count({ where: { publishedAt: { not: null } } })
    return published ? 'published' : 'closed'
  }

  const liveWhere = { revokedAt: null }

  async function countTickets(userId: bigint, source?: HalloweenSource | HalloweenSource[]) {
    return prisma.halloweenTicket.count({
      where: { userId, ...liveWhere, ...(source ? { source: Array.isArray(source) ? { in: source } : source } : {}) },
    })
  }

  /**
   * Начисление билетов одной пачкой. Возвращает, сколько билетов реально выдали
   * (лимиты из настроек: 100 всего, 30 за рефералов, 30 с колеса).
   */
  async function grant(
    userId: bigint,
    source: HalloweenSource,
    amount: number,
    extra: { friendId?: bigint; paymentId?: bigint; spinId?: bigint; holdUntil?: Date; byTgId?: bigint; ip?: string | null } = {},
  ): Promise<number> {
    if (amount <= 0) return 0
    const c = await config()
    const total = await countTickets(userId)
    let left = Math.max(0, c.maxTickets - total)
    if (source === 'referral_join' || source === 'referral_paid') {
      const used = await countTickets(userId, ['referral_join', 'referral_paid'])
      left = Math.min(left, Math.max(0, c.maxReferralTickets - used))
    }
    if (source === 'wheel') {
      const used = await countTickets(userId, 'wheel')
      left = Math.min(left, Math.max(0, c.maxWheelTickets - used))
    }
    const give = Math.min(amount, left)
    if (give <= 0) return 0
    const batch = crypto.randomUUID()
    await prisma.halloweenTicket.createMany({
      data: Array.from({ length: give }, () => ({
        userId,
        source,
        batch,
        friendId: extra.friendId ?? null,
        paymentId: extra.paymentId ?? null,
        spinId: extra.spinId ?? null,
        holdUntil: extra.holdUntil ?? null,
        byTgId: extra.byTgId ?? null,
        ip: extra.ip ?? null,
      })),
    })
    return give
  }

  const ticketWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'билет' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'билета' : 'билетов')

  /** Друг запустил бота по ссылке: +1 билет пригласившему. */
  async function onReferralJoin(referrerId: bigint, friendId: bigint, friendName: string | null) {
    const c = await config()
    if (phaseOf(c) !== 'live') return 0
    const referrer = await prisma.user.findUnique({ where: { id: referrerId } })
    if (!referrer || referrer.banned) return 0
    const given = await grant(referrerId, 'referral_join', c.ticketsForJoin, { friendId })
    if (given > 0) {
      const total = await countTickets(referrerId)
      await notify(
        referrer.tgId,
        `🎃 <b>+${given} ${ticketWord(given)}</b> за ${friendName ? '@' + friendName : 'нового друга'}!\nВсего у вас <b>${total}</b> ${ticketWord(total)} в розыгрыше.`,
      ).catch(() => undefined)
    }
    return given
  }

  /** Друг оплатил подписку: +3 билета с холдом (отменённый платёж их аннулирует). */
  async function onReferralPaid(referrerId: bigint, friendId: bigint, paymentId: bigint) {
    const c = await config()
    if (phaseOf(c) !== 'live') return 0
    const [referrer, friend] = await Promise.all([
      prisma.user.findUnique({ where: { id: referrerId } }),
      prisma.user.findUnique({ where: { id: friendId } }),
    ])
    if (!referrer || referrer.banned) return 0
    const given = await grant(referrerId, 'referral_paid', c.ticketsForPaid, {
      friendId,
      paymentId,
      holdUntil: new Date(Date.now() + c.holdDays * DAY),
    })
    if (given > 0) {
      const total = await countTickets(referrerId)
      await notify(
        referrer.tgId,
        `🎃 <b>+${given} ${ticketWord(given)}</b>: ${friend?.username ? '@' + friend.username : 'ваш друг'} оплатил подписку!\nВсего у вас <b>${total}</b> ${ticketWord(total)}.`,
      ).catch(() => undefined)
    }
    return given
  }

  /**
   * Оплата прошла (вызывается из billing). Билеты даёт только первая оплата друга:
   * продление по таблице из ТЗ билетов не приносит, Trial оплатой не считается.
   */
  async function onPayment(paymentId: bigint) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { user: true } })
    if (!payment || payment.status !== 'paid' || !payment.user.referrerId) return 0
    if (Number(payment.amountRub) + Number(payment.balanceUsedRub) <= 0) return 0
    const earlier = await prisma.payment.count({ where: { userId: payment.userId, status: 'paid', id: { lt: paymentId } } })
    if (earlier) return 0
    return onReferralPaid(payment.user.referrerId, payment.userId, paymentId)
  }

  /** Платёж отменён или возвращён: билеты за него аннулируются (холд из ТЗ). */
  async function revokeByPayment(paymentId: bigint) {
    const r = await prisma.halloweenTicket.updateMany({
      where: { paymentId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'Платёж отменён' },
    })
    return r.count
  }

  // ── Колесо фортуны ────────────────────────────────────────────────────────

  /** Доступен ли спин: тариф, срок подписки, сутки с активации, лимит в сутки. */
  async function wheelStatus(user: User) {
    const c = await config()
    const now = new Date()
    const spinsToday = await prisma.halloweenSpin.count({ where: { userId: user.id, day: mskDay(now) } })
    const fromWheel = await countTickets(user.id, 'wheel')
    const base = {
      sectors: c.wheel.sectors,
      spinsToday,
      spinsPerDay: c.wheel.spinsPerDay,
      ticketsFromWheel: fromWheel,
      maxWheelTickets: c.maxWheelTickets,
      nextSpinAt: nextMskMidnight(now).toISOString(),
    }
    const no = (reason: string) => ({ ...base, available: false, reason })
    if (!c.enabled || !c.wheel.enabled) return no('off')
    if (phaseOf(c) !== 'live') return no('closed')

    const sub = await prisma.subscription.findFirst({
      where: { userId: user.id, status: 'active', expiresAt: { gt: now } },
      orderBy: [{ expiresAt: 'desc' }],
    })
    // Trial доступа к колесу не даёт: нужен тариф Старт или Премиум.
    if (!sub) return no('no_sub')
    if (sub.expiresAt.getTime() - now.getTime() < c.wheel.minSubDays * DAY) return no('expires_soon')
    const first = await prisma.subscription.findFirst({ where: { userId: user.id, status: 'active' }, orderBy: [{ startedAt: 'asc' }] })
    if (first && now.getTime() - first.startedAt.getTime() < c.wheel.firstSpinAfterHours * HOUR) return no('too_early')
    if (spinsToday >= c.wheel.spinsPerDay) return no('used')
    if (fromWheel >= c.maxWheelTickets) return no('limit')
    return { ...base, available: true, reason: null as string | null }
  }

  /** Один спин в сутки: уникальный индекс (userId, day) защищает от гонки двойного клика. */
  async function spin(user: User, ip: string | null, device: string | null): Promise<SpinResult> {
    const status = await wheelStatus(user)
    const total = await countTickets(user.id)
    if (!status.available) return { ok: false, reason: status.reason ?? 'off', tickets: 0, sector: 0, total, nextSpinAt: status.nextSpinAt }

    const c = await config()
    const sector = rollSector(c.wheel.sectors)
    const win = c.wheel.sectors[sector]?.tickets ?? 0
    let row
    try {
      row = await prisma.halloweenSpin.create({ data: { userId: user.id, tickets: win, day: mskDay(), ip, device } })
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return { ok: false, reason: 'used', tickets: 0, sector: 0, total, nextSpinAt: status.nextSpinAt }
      }
      throw err
    }
    const given = win > 0 ? await grant(user.id, 'wheel', win, { spinId: row.id, ip }) : 0
    if (given !== win) await prisma.halloweenSpin.update({ where: { id: row.id }, data: { tickets: given } })
    await flagIpAbuse(ip)
    return { ok: true, tickets: given, sector, total: total + given, nextSpinAt: status.nextSpinAt }
  }

  /** Антифрод: 3+ аккаунта с одного IP за сутки уходят на ручную модерацию. */
  async function flagIpAbuse(ip: string | null) {
    if (!ip) return
    const rows = await prisma.halloweenSpin.findMany({
      where: { ip, at: { gte: new Date(Date.now() - DAY) } },
      distinct: ['userId'],
      select: { userId: true },
    })
    if (rows.length === 3) await notifyStaff(`🚩 Хэллоуин: с одного IP <code>${ip}</code> крутят колесо ${rows.length} аккаунта. Проверьте в /admin → 🎃 Хэллоуин.`)
  }

  // ── Что видит участник ────────────────────────────────────────────────────

  async function summary(user: User) {
    const c = await config()
    const [total, fromJoin, fromPaid, fromWheel, invited, hold] = await Promise.all([
      countTickets(user.id),
      countTickets(user.id, 'referral_join'),
      countTickets(user.id, 'referral_paid'),
      countTickets(user.id, 'wheel'),
      prisma.user.count({ where: { referrerId: user.id } }),
      prisma.halloweenTicket.count({ where: { userId: user.id, revokedAt: null, holdUntil: { gt: new Date() } } }),
    ])
    return {
      phase: await phase(),
      tickets: total,
      hold,
      bySource: { referralJoin: fromJoin, referralPaid: fromPaid, wheel: fromWheel },
      invited,
      limits: { total: c.maxTickets, referral: c.maxReferralTickets, wheel: c.maxWheelTickets },
      ticketsForJoin: c.ticketsForJoin,
      ticketsForPaid: c.ticketsForPaid,
      startAt: c.startAt,
      ticketsUntil: c.ticketsUntil,
      drawAt: c.drawAt,
    }
  }

  /** История: билеты, выданные одним событием, показываем одной строкой (по batch). */
  async function history(userId: bigint, limit = 50) {
    const rows = await prisma.halloweenTicket.findMany({
      where: { userId },
      include: { friend: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit * 5,
    })
    const byBatch = new Map<string, { at: Date; source: HalloweenSource; amount: number; friend: string | null; revoked: boolean; hold: Date | null }>()
    for (const t of rows) {
      const cur = byBatch.get(t.batch)
      if (cur) cur.amount++
      else
        byBatch.set(t.batch, {
          at: t.createdAt,
          source: t.source,
          amount: 1,
          friend: t.friend?.username ?? null,
          revoked: Boolean(t.revokedAt),
          hold: t.holdUntil && t.holdUntil > new Date() ? t.holdUntil : null,
        })
    }
    const spins = await prisma.halloweenSpin.findMany({ where: { userId, tickets: 0 }, orderBy: { at: 'desc' }, take: limit })
    const items = [
      ...[...byBatch.values()].map((b) => ({
        at: b.at.toISOString(),
        source: b.source,
        title: SOURCE_NAMES[b.source],
        friend: b.friend,
        amount: b.amount,
        revoked: b.revoked,
        holdUntil: b.hold?.toISOString() ?? null,
      })),
      // Пустой сектор колеса: в истории он тоже нужен («25 окт — Колесо фортуны → пусто»).
      ...spins.map((s) => ({ at: s.at.toISOString(), source: 'wheel' as HalloweenSource, title: SOURCE_NAMES.wheel, friend: null, amount: 0, revoked: false, holdUntil: null })),
    ].sort((a, b) => b.at.localeCompare(a.at))
    return items.slice(0, limit)
  }

  async function wheelHistory(userId: bigint, limit = 30) {
    const rows = await prisma.halloweenSpin.findMany({ where: { userId }, orderBy: { at: 'desc' }, take: limit })
    return rows.map((s) => ({ at: s.at.toISOString(), tickets: s.tickets }))
  }

  /** Общий пул: сколько всего билетов и участников. */
  async function stats() {
    const [tickets, players, spins] = await Promise.all([
      prisma.halloweenTicket.count({ where: liveWhere }),
      prisma.halloweenTicket.findMany({ where: liveWhere, distinct: ['userId'], select: { userId: true } }),
      prisma.halloweenSpin.count(),
    ])
    return { tickets, participants: players.length, spins }
  }

  // ── Призы, розыгрыш, публикация ───────────────────────────────────────────

  const prizeList = (c: HalloweenSettings) => c.prizes.slice().sort((a, b) => a.place - b.place)

  async function prizes() {
    const c = await config()
    return { prizes: prizeList(c), consolationPercent: c.consolationPercent, total: c.prizes.reduce((a, p) => a + p.count, 0) }
  }

  async function lastDraw() {
    return prisma.halloweenDraw.findFirst({ orderBy: { id: 'desc' }, include: { winners: { include: { user: true }, orderBy: [{ place: 'asc' }, { id: 'asc' }] } } })
  }

  /** Победители для приложения: только после публикации, с никами и числом билетов. */
  async function winners() {
    const draw = await lastDraw()
    if (!draw?.publishedAt) return { published: false, at: null, winners: [] }
    return {
      published: true,
      at: draw.publishedAt.toISOString(),
      winners: draw.winners
        .filter((w) => !w.replacedAt)
        .map((w) => ({ place: w.place, prize: w.prizeTitle, username: w.user.username, tgId: String(w.user.tgId).slice(-4), tickets: w.tickets })),
    }
  }

  /**
   * Розыгрыш: каждый билет — запись в пуле, победители выбираются без повторов
   * (один аккаунт получает максимум один приз). Зерно сохраняем: результат воспроизводим.
   */
  async function draw(byTgId?: bigint) {
    const c = await config()
    const tickets = await prisma.halloweenTicket.findMany({ where: liveWhere, select: { id: true, userId: true }, orderBy: { id: 'asc' } })
    if (!tickets.length) throw new Error('В пуле нет билетов')
    const perUser = new Map<bigint, number>()
    for (const t of tickets) perUser.set(t.userId, (perUser.get(t.userId) ?? 0) + 1)

    const seed = crypto.randomBytes(16).toString('hex')
    let counter = 0
    // Случайность из seed: тот же seed даёт тот же список победителей (проверка по запросу).
    const rand = () => {
      const h = crypto.createHash('sha256').update(`${seed}:${counter++}`).digest()
      return h.readUInt32BE(0) / 0x1_0000_0000
    }

    const pool = tickets.slice()
    const won = new Set<bigint>()
    const picks: { prize: HalloweenPrize; userId: bigint; ticketId: bigint }[] = []
    for (const prize of prizeList(c)) {
      for (let i = 0; i < prize.count; i++) {
        let picked: { id: bigint; userId: bigint } | null = null
        // Пропускаем билеты уже выигравших: один аккаунт — один приз.
        for (let tries = 0; tries < 10_000 && pool.length; tries++) {
          const idx = Math.floor(rand() * pool.length)
          const t = pool[idx]
          if (won.has(t.userId)) {
            pool.splice(idx, 1)
            continue
          }
          picked = t
          break
        }
        if (!picked) break
        won.add(picked.userId)
        picks.push({ prize, userId: picked.userId, ticketId: picked.id })
      }
    }

    const row = await prisma.halloweenDraw.create({
      data: {
        seed,
        totalTickets: tickets.length,
        participants: perUser.size,
        byTgId: byTgId ?? null,
        winners: {
          create: picks.map((p) => ({
            userId: p.userId,
            prizeCode: p.prize.code,
            prizeTitle: p.prize.title,
            place: p.prize.place,
            ticketId: p.ticketId,
            tickets: perUser.get(p.userId) ?? 0,
          })),
        },
      },
      include: { winners: { include: { user: true }, orderBy: [{ place: 'asc' }, { id: 'asc' }] } },
    })
    return row
  }

  /**
   * Публикация результатов: подписки победителям начисляются автоматически,
   * всем участникам с билетами — утешительная скидка, победителям уходит push.
   */
  async function publish(drawId: bigint, byTgId?: bigint) {
    const c = await config()
    const row = await prisma.halloweenDraw.findUniqueOrThrow({ where: { id: drawId }, include: { winners: { include: { user: true } } } })
    if (row.publishedAt) return { already: true, granted: 0, consolation: 0 }

    let granted = 0
    for (const w of row.winners.filter((x) => !x.replacedAt)) {
      const prize = c.prizes.find((p) => p.code === w.prizeCode)
      if (prize?.reward) {
        await vpn.grant(w.user, prize.reward.plan, prize.reward.days, 'gift').catch(() => undefined)
        granted++
        await prisma.halloweenWinner.update({ where: { id: w.id }, data: { grantedAt: new Date() } })
      }
      await notify(
        w.user.tgId,
        `🎃 <b>Вы выиграли!</b>\nПриз: <b>${w.prizeTitle}</b>.\n` +
          (prize?.reward ? 'Подписка уже продлена, проверьте приложение.' : 'С вами свяжется администрация в течение 24 часов для отправки приза.'),
      ).catch(() => undefined)
      await prisma.halloweenWinner.update({ where: { id: w.id }, data: { notifiedAt: new Date() } }).catch(() => undefined)
    }

    const consolation = await grantConsolation(c, new Set(row.winners.map((w) => w.userId)))
    await prisma.halloweenDraw.update({ where: { id: row.id }, data: { publishedAt: new Date(), byTgId: byTgId ?? row.byTgId } })
    return { already: false, granted, consolation }
  }

  /** Утешительная скидка 20% всем участникам с билетами (кроме победителей). */
  async function grantConsolation(c: HalloweenSettings, skip: Set<bigint>) {
    if (c.consolationPercent <= 0) return 0
    const players = await prisma.halloweenTicket.findMany({ where: liveWhere, distinct: ['userId'], select: { userId: true } })
    const expiresAt = new Date(Date.now() + c.consolationDays * DAY)
    let n = 0
    for (const p of players) {
      if (skip.has(p.userId)) continue
      const exists = await prisma.userReward.count({ where: { userId: p.userId, code: 'halloween', kind: 'discount', revokedAt: null } })
      if (exists) continue
      await prisma.userReward.create({
        data: { userId: p.userId, code: 'halloween', kind: 'discount', value: c.consolationPercent, expiresAt, applyNext: true },
      })
      n++
    }
    return n
  }

  /** Победитель не отвечает: убираем его и разыгрываем приз заново среди остальных. */
  async function replaceWinner(winnerId: bigint) {
    const w = await prisma.halloweenWinner.findUniqueOrThrow({ where: { id: winnerId }, include: { draw: { include: { winners: true } } } })
    const taken = new Set(w.draw.winners.filter((x) => !x.replacedAt).map((x) => x.userId))
    const tickets = await prisma.halloweenTicket.findMany({ where: liveWhere, select: { id: true, userId: true } })
    const pool = tickets.filter((t) => !taken.has(t.userId))
    if (!pool.length) return null
    const pick = pool[crypto.randomInt(pool.length)]
    const tickets2 = pool.filter((t) => t.userId === pick.userId).length
    await prisma.halloweenWinner.update({ where: { id: w.id }, data: { replacedAt: new Date() } })
    return prisma.halloweenWinner.create({
      data: {
        drawId: w.drawId,
        userId: pick.userId,
        prizeCode: w.prizeCode,
        prizeTitle: w.prizeTitle,
        place: w.place,
        ticketId: pick.id,
        tickets: tickets2,
      },
      include: { user: true },
    })
  }

  // ── Админ-меню ────────────────────────────────────────────────────────────

  /** Ручное начисление билетов (компенсация за баг). */
  async function adminGrant(userId: bigint, amount: number, byTgId: bigint) {
    return grant(userId, 'admin', amount, { byTgId })
  }

  /** Ручное аннулирование: все живые билеты пользователя или только за одно событие. */
  async function adminRevoke(userId: bigint, reason: string, byTgId: bigint) {
    const r = await prisma.halloweenTicket.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason, byTgId } })
    return r.count
  }

  async function resetSpin(userId: bigint) {
    const r = await prisma.halloweenSpin.deleteMany({ where: { userId, day: mskDay() } })
    return r.count
  }

  async function topUsers(limit = 10) {
    const rows = await prisma.halloweenTicket.groupBy({ by: ['userId'], where: liveWhere, _count: true, orderBy: { _count: { userId: 'desc' } }, take: limit })
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } } })
    return rows.map((r) => ({ user: users.find((u) => u.id === r.userId)!, tickets: r._count }))
  }

  /** Сводка для дашборда админки. */
  async function dashboard() {
    const c = await config()
    const [pool, participants, join, paid, wheel, adminTickets, revoked, spins, spinTickets, draw] = await Promise.all([
      prisma.halloweenTicket.count({ where: liveWhere }),
      prisma.halloweenTicket.findMany({ where: liveWhere, distinct: ['userId'], select: { userId: true } }),
      prisma.halloweenTicket.count({ where: { ...liveWhere, source: 'referral_join' } }),
      prisma.halloweenTicket.count({ where: { ...liveWhere, source: 'referral_paid' } }),
      prisma.halloweenTicket.count({ where: { ...liveWhere, source: 'wheel' } }),
      prisma.halloweenTicket.count({ where: { ...liveWhere, source: 'admin' } }),
      prisma.halloweenTicket.count({ where: { revokedAt: { not: null } } }),
      prisma.halloweenSpin.count(),
      prisma.halloweenSpin.aggregate({ _sum: { tickets: true } }),
      lastDraw(),
    ])
    return {
      config: c,
      phase: phaseOf(c),
      pool,
      participants: participants.length,
      join,
      paid,
      wheel,
      admin: adminTickets,
      revoked,
      spins,
      avgSpin: spins ? (spinTickets._sum.tickets ?? 0) / spins : 0,
      draw,
    }
  }

  /** Подозрительные IP: с одного адреса крутят несколько аккаунтов. */
  async function anomalies(limit = 10) {
    const rows = await prisma.halloweenSpin.findMany({ where: { ip: { not: null } }, select: { ip: true, userId: true } })
    const byIp = new Map<string, Set<bigint>>()
    for (const r of rows) {
      if (!r.ip) continue
      const set = byIp.get(r.ip) ?? new Set<bigint>()
      set.add(r.userId)
      byIp.set(r.ip, set)
    }
    return [...byIp.entries()]
      .filter(([, users]) => users.size >= 3)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, limit)
      .map(([ip, users]) => ({ ip, accounts: users.size }))
  }

  /** Полный список билетов для экспорта и фиксации перед розыгрышем. */
  async function exportTickets() {
    const rows = await prisma.halloweenTicket.findMany({
      include: { user: { select: { tgId: true, username: true } }, friend: { select: { username: true } } },
      orderBy: { id: 'asc' },
    })
    return rows.map((t) => ({
      id: String(t.id),
      tgId: String(t.user.tgId),
      username: t.user.username ?? '',
      source: SOURCE_NAMES[t.source],
      friend: t.friend?.username ?? '',
      createdAt: t.createdAt,
      revoked: t.revokedAt ? 'да' : '',
      reason: t.revokeReason ?? '',
    }))
  }

  const ticketsOf = (userId: bigint) => countTickets(userId)

  /** Кто уже крутил колесо сегодня (для ежедневного напоминания). */
  async function spinnersToday(): Promise<Set<string>> {
    const rows = await prisma.halloweenSpin.findMany({ where: { day: mskDay() }, select: { userId: true } })
    return new Set(rows.map((r) => String(r.userId)))
  }

  return {
    config,
    save,
    phase,
    phaseOf,
    ticketsOf,
    spinnersToday,
    grant,
    onReferralJoin,
    onReferralPaid,
    onPayment,
    revokeByPayment,
    wheelStatus,
    spin,
    summary,
    history,
    wheelHistory,
    stats,
    prizes,
    winners,
    lastDraw,
    draw,
    publish,
    replaceWinner,
    adminGrant,
    adminRevoke,
    resetSpin,
    topUsers,
    dashboard,
    anomalies,
    exportTickets,
  }
}

export type HalloweenService = ReturnType<typeof createHalloweenService>

export type TicketWhere = Prisma.HalloweenTicketWhereInput
