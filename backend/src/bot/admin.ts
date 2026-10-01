import type { Prisma, PrismaClient, User } from '@prisma/client'
import type { PanelProvider } from '@/panel'
import type { BillingService } from '@/services/billing'
import type { ServerStatusService } from '@/services/servers'
import { LEVEL_NAMES, type PaidPlan, type Period, type SettingsService } from '@/services/settings'
import { LATEST_FIRST, type VpnService } from '@/services/vpn'
import { recentErrors, recentSubRequests } from '@/lib/errors'
import type { AdminApi, AdminFeatures } from './adminFeatures'
import {
  DAY,
  PAGE,
  ago,
  back,
  btn,
  csv,
  day,
  dt,
  header,
  mskDayStart,
  mskMonthStart,
  num,
  parseMsk,
  pager,
  planName,
  rub,
  who,
  type Ctx,
  type Fsm,
  type View,
} from './adminUi'
import { can, type Staff, type StaffRole } from './staff'
import { entitiesToHtml, esc, type InlineKeyboard, type Telegram, type TgEntity } from './tg'

/**
 * Админ-меню в боте (ТЗ раздел 6). Открывается командой /admin для ролей
 * SUPPORT / ADMIN / OWNER. Навигация через inline-кнопки: одно сообщение,
 * которое перерисовывается. Пошаговый ввод (поиск, суммы, тексты) через FSM.
 */


const TEMPLATES = [
  'Здравствуйте! Спасибо за обращение, уже разбираемся. Ответим в ближайшее время.',
  'Попробуйте обновить подписку в приложении Happ: откройте список серверов и потяните вниз. Если не поможет, напишите нам ещё раз.',
  'Рады, что всё заработало! Если появятся вопросы, пишите в любое время.',
]

const SEGMENTS: Record<string, string> = {
  all: 'Все',
  active: 'С активной подпиской',
  trial: 'На пробном периоде',
  expired: 'Подписка закончилась',
  balance: 'С балансом > 0',
}

export function segmentWhere(segment: string): Prisma.UserWhereInput {
  const now = new Date()
  const base: Prisma.UserWhereInput = { botStarted: true, banned: false }
  switch (segment) {
    case 'active':
      return { ...base, subscriptions: { some: { status: { in: ['trial', 'active'] }, expiresAt: { gt: now } } } }
    case 'trial':
      return { ...base, subscriptions: { some: { status: 'trial', expiresAt: { gt: now } } } }
    case 'expired':
      return { ...base, subscriptions: { some: {}, none: { status: { in: ['trial', 'active'] }, expiresAt: { gt: now } } } }
    case 'balance':
      return { ...base, balanceRub: { gt: 0 } }
    default:
      return base
  }
}

function userFilter(filter: string): Prisma.UserWhereInput {
  const now = new Date()
  const active = { expiresAt: { gt: now } }
  switch (filter) {
    case 'start':
      return { subscriptions: { some: { ...active, plan: 'start', status: 'active' } } }
    case 'pro':
      return { subscriptions: { some: { ...active, plan: 'pro', status: 'active' } } }
    case 'trial':
      return { subscriptions: { some: { ...active, status: 'trial' } } }
    case 'expired':
      return { subscriptions: { some: {}, none: { status: { in: ['trial', 'active'] }, ...active } } }
    case 'banned':
      return { banned: true }
    default:
      return {}
  }
}

export function createAdmin(deps: {
  prisma: PrismaClient
  tg: Telegram
  staff: Staff
  settings: SettingsService
  billing: BillingService
  vpn: VpnService
  panel: PanelProvider
  servers: ServerStatusService
  sendBroadcast: (id: bigint) => Promise<void>
  /** Разделы ТЗ v6.3: переносы, достижения, статус, устройства пользователя. */
  features?: (api: AdminApi) => AdminFeatures
}) {
  const { prisma, tg, staff, settings, billing, vpn, panel, servers } = deps
  const fsm = new Map<number, Fsm>()
  const features = deps.features?.({ show, ask, fsm, userCard: (id, role) => userCard(id, role) })

  // ── экраны ────────────────────────────────────────────────────────────────

  function home(role: StaffRole): View {
    const items: [string, string, string][] = [
      ['dash', '📊 Дашборд', 'adm:dash'],
      ['users', '👥 Пользователи', 'adm:users'],
      ['subs', '💳 Подписки', 'adm:subs'],
      ['pay', '💰 Платежи', 'adm:pay:all:0'],
      ['ref', '🎁 Рефералы', 'adm:ref'],
      ['srv', '🖥 Серверы', 'adm:srv'],
      ['promo', '🎟 Промокоды', 'adm:promo'],
      ['sup', '💬 Поддержка', 'adm:sup:open:0'],
      ['bc', '📢 Рассылки', 'adm:bc'],
      ...(features?.homeItems ?? []),
      ['set', '⚙️ Настройки', 'adm:set'],
      ['logs', '📋 Логи', 'adm:logs'],
    ]
    const visible = items.filter(([s]) => can(role, s))
    const kb: InlineKeyboard = []
    for (let i = 0; i < visible.length; i += 2) kb.push(visible.slice(i, i + 2).map(([, t, d]) => btn(t, d)))
    const roleName = { owner: 'Владелец', admin: 'Администратор', support: 'Поддержка' }[role]
    return { text: `${header('🛠', 'LYNK · Админ-меню', `Роль: ${roleName}`)}Выберите раздел.`, kb }
  }

  async function dashboard(): Promise<View> {
    const now = new Date()
    const today = mskDayStart()
    const month = mskMonthStart()
    const [total, newToday, dau, wau, mau] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: today } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 7 * DAY) } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 30 * DAY) } } }),
    ])
    const subs = await prisma.subscription.findMany({
      where: { status: { in: ['trial', 'active'] }, expiresAt: { gt: now } },
      select: { userId: true, plan: true, status: true },
      orderBy: { expiresAt: 'desc' },
    })
    const seen = new Set<bigint>()
    const counts = { start: 0, pro: 0, trial: 0 }
    for (const s of subs) {
      if (seen.has(s.userId)) continue
      seen.add(s.userId)
      if (s.status === 'trial') counts.trial++
      else if (s.plan === 'pro') counts.pro++
      else counts.start++
    }
    const paidWhere = (since: Date): Prisma.PaymentWhereInput => ({ status: 'paid', method: { not: 'balance' }, paidAt: { gte: since } })
    const [revToday, revMonth, monthly30, yearly365] = await Promise.all([
      prisma.payment.aggregate({ where: paidWhere(today), _sum: { amountRub: true } }),
      prisma.payment.aggregate({ where: paidWhere(month), _sum: { amountRub: true } }),
      prisma.payment.aggregate({ where: { ...paidWhere(new Date(Date.now() - 30 * DAY)), periodDays: { lt: 100 } }, _sum: { amountRub: true } }),
      prisma.payment.aggregate({ where: { ...paidWhere(new Date(Date.now() - 365 * DAY)), periodDays: { gte: 100 } }, _sum: { amountRub: true } }),
    ])
    const mrr = Number(monthly30._sum.amountRub ?? 0) + Number(yearly365._sum.amountRub ?? 0) / 12

    const cohort = { createdAt: { gte: new Date(Date.now() - 37 * DAY), lt: new Date(Date.now() - 7 * DAY) }, trialUsed: true }
    const [cohortAll, cohortPaid] = await Promise.all([
      prisma.user.count({ where: cohort }),
      prisma.user.count({ where: { ...cohort, payments: { some: { status: 'paid' } } } }),
    ])
    const top = await prisma.referralPayout.groupBy({
      by: ['referrerId'],
      where: { createdAt: { gte: month }, status: { not: 'cancelled' } },
      _sum: { amountRub: true },
      orderBy: { _sum: { amountRub: 'desc' } },
      take: 5,
    })
    const topUsers = await prisma.user.findMany({ where: { id: { in: top.map((t) => t.referrerId) } } })
    const srv = await servers.list()

    const topLines = top.length
      ? top
          .map((t, i) => {
            const u = topUsers.find((x) => x.id === t.referrerId)
            return `${i + 1}. ${u ? who(u) : '?'} · ${rub(t._sum.amountRub)}`
          })
          .join('\n')
      : '<i>пока нет</i>'
    const srvLines = srv.length
      ? srv.map((s) => `${s.online ? '🟢' : '🔴'} ${s.country.toUpperCase()} · ${s.pingMs != null ? `${s.pingMs} мс` : 'нет ответа'}`).join('\n')
      : '<i>серверы не настроены</i>'

    const text =
      header('📊', 'Дашборд', `обновлено ${dt(now)} МСК`) +
      `<b>Аудитория</b>\n` +
      `Всего: <b>${num(total)}</b> · новых сегодня: <b>${num(newToday)}</b>\n` +
      `DAU <b>${num(dau)}</b> · WAU <b>${num(wau)}</b> · MAU <b>${num(mau)}</b>\n\n` +
      `<b>Подписки</b>\n` +
      `Старт <b>${counts.start}</b> · Премиум <b>${counts.pro}</b> · Trial <b>${counts.trial}</b>\n\n` +
      `<b>Выручка</b>\n` +
      `Сегодня <b>${rub(revToday._sum.amountRub)}</b> · месяц <b>${rub(revMonth._sum.amountRub)}</b>\n` +
      `MRR ≈ <b>${rub(Math.round(mrr))}</b>\n` +
      `Trial → платный (7 дн): <b>${cohortAll ? Math.round((cohortPaid / cohortAll) * 100) : 0}%</b> <i>(${cohortPaid} из ${cohortAll})</i>\n\n` +
      `<b>Топ-5 рефереров месяца</b>\n${topLines}\n\n` +
      `<b>Серверы</b>\n${srvLines}`
    return { text, kb: [[btn('🔄 Обновить', 'adm:dash')], back()] }
  }

  async function usersMenu(): Promise<View> {
    const total = await prisma.user.count()
    return {
      text: `${header('👥', 'Пользователи', `всего ${num(total)}`)}Найдите по tg_id или @username, или откройте список.`,
      kb: [
        [btn('🔎 Поиск', 'adm:users:search')],
        [btn('Все', 'adm:uf:all:0'), btn('Старт', 'adm:uf:start:0'), btn('Премиум', 'adm:uf:pro:0')],
        [btn('Trial', 'adm:uf:trial:0'), btn('Истёкшие', 'adm:uf:expired:0'), btn('Бан', 'adm:uf:banned:0')],
        back(),
      ],
    }
  }

  async function usersList(filter: string, page: number): Promise<View> {
    const where = userFilter(filter)
    const rows = await prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * PAGE, take: PAGE + 1 })
    const names: Record<string, string> = { all: 'последние регистрации', start: 'Старт', pro: 'Премиум', trial: 'Trial', expired: 'истёкшие', banned: 'в бане' }
    const list = rows.slice(0, PAGE)
    const kb: InlineKeyboard = list.map((u) => [btn(`${u.banned ? '⛔ ' : ''}${u.username ? '@' + u.username : u.tgId} · ${day(u.createdAt)}`, `adm:u:${u.id}`)])
    kb.push(pager(`adm:uf:${filter}`, page, rows.length > PAGE))
    kb.push(back('adm:users'))
    return { text: `${header('👥', 'Пользователи', names[filter] ?? filter)}${list.length ? 'Выберите пользователя.' : '<i>Никого не нашлось.</i>'}`, kb }
  }

  async function userCard(id: bigint, role: StaffRole): Promise<View> {
    const u = await prisma.user.findUnique({ where: { id } })
    if (!u) return { text: 'Пользователь не найден', kb: [back('adm:users')] }
    const s = await settings.get()
    const sub = await vpn.current(u.id)
    const [refs, refsPaid, pays, paySum, devices] = await Promise.all([
      prisma.user.count({ where: { referrerId: u.id } }),
      prisma.user.count({ where: { referrerId: u.id, payments: { some: { status: 'paid' } } } }),
      prisma.payment.count({ where: { userId: u.id, status: 'paid' } }),
      prisma.payment.aggregate({ where: { userId: u.id, status: 'paid' }, _sum: { amountRub: true } }),
      prisma.device.count({ where: { userId: u.id } }),
    ])
    const left = sub ? Math.ceil((sub.expiresAt.getTime() - Date.now()) / DAY) : 0
    const text =
      header('👤', u.username ? `@${esc(u.username)}` : `ID ${u.tgId}`, `tg_id ${u.tgId}${u.banned ? ' · ⛔ заблокирован' : ''}`) +
      `💳 Подписка: <b>${sub ? `${sub.status === 'trial' ? 'Trial' : planName(sub.plan)}, до ${day(sub.expiresAt)} (${left} дн)` : 'нет'}</b>${sub?.autoRenew ? ' · автопродление' : ''}\n` +
      `💰 Баланс: <b>${rub(u.balanceRub)}</b>\n` +
      `🎁 Уровень: <b>${LEVEL_NAMES[u.referralLevel]}</b> (${s.referralPercents[u.referralLevel]}%) · рефералов ${refs}, оплатили ${refsPaid}\n` +
      `🧾 Оплат: <b>${pays}</b> на ${rub(paySum._sum.amountRub)}\n` +
      `📱 Устройств: ${devices}\n` +
      `📅 С нами с ${day(u.createdAt)} · был ${u.lastSeenAt ? ago(u.lastSeenAt) : 'давно'}\n` +
      `🔗 Реф. код: <code>${u.refCode ?? 'нет'}</code>`
    const kb: InlineKeyboard = []
    if (role !== 'support') {
      kb.push([btn('+7 дней', `adm:u:${id}:ext:7`), btn('+30 дней', `adm:u:${id}:ext:30`), btn('+365', `adm:u:${id}:ext:365`)])
      kb.push([btn('→ Старт', `adm:u:${id}:plan:start`), btn('→ Премиум', `adm:u:${id}:plan:pro`), btn('Выдать Trial', `adm:u:${id}:trial`)])
      kb.push([btn('💬 Написать', `adm:u:${id}:msg`), btn(u.banned ? '✅ Разбанить' : '⛔ Забанить', `adm:u:${id}:${u.banned ? 'unban' : 'ban'}`)])
    }
    if (role === 'owner') {
      kb.push([btn('+ Баланс', `adm:u:${id}:bal:add`), btn('− Баланс', `adm:u:${id}:bal:sub`), btn('Отменить подписку', `adm:u:${id}:cancel`)])
      kb.push([btn('🧹 Обнулить рефералку', `adm:u:${id}:refreset`)])
    }
    kb.push([btn('🕓 История', `adm:u:${id}:hist`)])
    if (features) kb.push(...features.userRows(id, role))
    kb.push(back('adm:users'))
    return { text, kb }
  }

  async function userHistory(id: bigint): Promise<View> {
    const [pays, txs, audit] = await Promise.all([
      prisma.payment.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.balanceTx.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.auditLog.findMany({ where: { target: `user:${id}` }, orderBy: { createdAt: 'desc' }, take: 8 }),
    ])
    const text =
      header('🕓', 'История пользователя') +
      `<b>Платежи</b>\n${pays.map((p) => `${dt(p.createdAt)} · ${planName(p.planPurchased)} · ${rub(p.amountRub)} · ${p.method} · ${p.status}`).join('\n') || '<i>нет</i>'}\n\n` +
      `<b>Баланс</b>\n${txs.map((t) => `${dt(t.createdAt)} · ${Number(t.amountRub) > 0 ? '+' : ''}${rub(t.amountRub)} · ${t.kind}`).join('\n') || '<i>нет</i>'}\n\n` +
      `<b>Действия админов</b>\n${audit.map((a) => `${dt(a.createdAt)} · ${esc(a.action)} · ${a.adminTgId}`).join('\n') || '<i>нет</i>'}`
    return { text, kb: [back(`adm:u:${id}`)] }
  }

  async function subsMenu(): Promise<View> {
    const now = new Date()
    const [active, expiring, expiredWeek] = await Promise.all([
      prisma.subscription.count({ where: { status: { in: ['trial', 'active'] }, expiresAt: { gt: now } } }),
      prisma.subscription.count({ where: { status: { in: ['trial', 'active'] }, expiresAt: { gt: now, lte: new Date(Date.now() + 3 * DAY) } } }),
      prisma.subscription.count({ where: { expiresAt: { gte: new Date(Date.now() - 7 * DAY), lte: now } } }),
    ])
    return {
      text:
        header('💳', 'Подписки') +
        `Активных: <b>${active}</b>\nИстекают в ближайшие 3 дня: <b>${expiring}</b>\nИстекли за 7 дней: <b>${expiredWeek}</b>\n\n` +
        `Ручное продление и выдача Trial находятся в карточке пользователя.`,
      kb: [[btn('⏳ Истекающие', 'adm:sx:0')], [btn('♻️ Массовое продление истёкших', 'adm:subs:mass')], back()],
    }
  }

  async function expiringList(page: number): Promise<View> {
    const now = new Date()
    const rows = await prisma.subscription.findMany({
      where: { status: { in: ['trial', 'active'] }, expiresAt: { gt: now, lte: new Date(Date.now() + 3 * DAY) } },
      include: { user: true },
      orderBy: { expiresAt: 'asc' },
      skip: page * PAGE,
      take: PAGE + 1,
    })
    const list = rows.slice(0, PAGE)
    const kb: InlineKeyboard = list.map((s) => [btn(`${s.user.username ? '@' + s.user.username : s.user.tgId} · ${planName(s.plan)} · ${dt(s.expiresAt)}`, `adm:u:${s.userId}`)])
    kb.push(pager('adm:sx', page, rows.length > PAGE))
    kb.push(back('adm:subs'))
    return { text: `${header('⏳', 'Истекают в ближайшие 3 дня')}${list.length ? '' : '<i>Таких нет.</i>'}`, kb }
  }

  async function paymentsList(filter: string, page: number): Promise<View> {
    const where: Prisma.PaymentWhereInput =
      filter === 'stars'
        ? { method: 'stars' }
        : filter === 'crypto'
          ? { method: { in: ['crypto_usdt', 'crypto_ton'] } }
          : filter === 'sbp'
            ? { method: 'platega_sbp' }
            : filter === 'balance'
            ? { method: 'balance' }
            : filter === 'pending' || filter === 'paid' || filter === 'refunded'
              ? { status: filter }
              : {}
    const rows = await prisma.payment.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, skip: page * PAGE, take: PAGE + 1 })
    const list = rows.slice(0, PAGE)
    const icon = (s: string) => (s === 'paid' ? '✅' : s === 'pending' ? '⏳' : s === 'refunded' ? '↩️' : '✖️')
    const kb: InlineKeyboard = [
      [btn('Все', 'adm:pay:all:0'), btn('Stars', 'adm:pay:stars:0'), btn('СБП', 'adm:pay:sbp:0'), btn('Крипта', 'adm:pay:crypto:0'), btn('Баланс', 'adm:pay:balance:0')],
      [btn('Оплачены', 'adm:pay:paid:0'), btn('Ожидают', 'adm:pay:pending:0'), btn('Возвраты', 'adm:pay:refunded:0')],
      ...list.map((p) => [btn(`${icon(p.status)} ${rub(Number(p.amountRub) + Number(p.balanceUsedRub))} · ${p.user.username ? '@' + p.user.username : p.user.tgId} · ${day(p.createdAt)}`, `adm:p:${p.id}`)]),
      pager(`adm:pay:${filter}`, page, rows.length > PAGE),
      [btn('🔎 Поиск', 'adm:pay:search'), btn('📄 CSV', 'adm:pay:csv')],
      back(),
    ]
    return { text: `${header('💰', 'Платежи', `фильтр: ${filter}`)}${list.length ? 'Последние транзакции.' : '<i>Ничего не найдено.</i>'}`, kb }
  }

  async function paymentCard(id: bigint): Promise<View> {
    const p = await prisma.payment.findUnique({ where: { id }, include: { user: true, promoCode: true, referralPayout: true } })
    if (!p) return { text: 'Платёж не найден', kb: [back('adm:pay:all:0')] }
    // Оплачен, но выдать доступ на панели не удалось (джоба повторяет сама, кнопка ниже вручную).
    const stuck = p.status === 'paid' && (await billing.needsActivation(p.orderId))
    const text =
      header('🧾', `Платёж #${p.id}`, p.orderId) +
      `Пользователь: ${who(p.user)}\n` +
      `Тариф: <b>${planName(p.planPurchased)}</b>, ${p.periodDays === 365 ? '12 мес' : '1 мес'}\n` +
      `Способ: <b>${p.method}</b>${p.starsAmount ? ` (${p.starsAmount} ⭐)` : ''}${p.externalId ? ` · id: <code>${esc(p.externalId)}</code>` : ''}\n` +
      `К оплате: <b>${rub(p.amountRub)}</b> · с баланса ${rub(p.balanceUsedRub)} · скидка ${rub(p.discountRub)}${p.promoCode ? ` (${esc(p.promoCode.code)})` : ''}\n` +
      `Статус: <b>${p.status}</b>${stuck ? ' · ⚠️ доступ не выдан' : ''}\nСоздан: ${dt(p.createdAt)} · оплачен: ${dt(p.paidAt)}\n` +
      `Реферальное начисление: ${p.referralPayout ? `${rub(p.referralPayout.amountRub)} (${p.referralPayout.status})` : 'нет'}`
    const kb: InlineKeyboard = []
    if (stuck) kb.push([btn('♻️ Выдать доступ повторно', `adm:p:${id}:reactivate`)])
    if (p.status === 'paid') kb.push([btn('↩️ Возврат на баланс', `adm:p:${id}:refund`)])
    if (p.status === 'pending') kb.push([btn('✅ Отметить оплаченным', `adm:p:${id}:markpaid`)])
    kb.push([btn('👤 Пользователь', `adm:u:${p.userId}`)])
    kb.push(back('adm:pay:all:0'))
    return { text, kb }
  }

  async function referralsMenu(): Promise<View> {
    const s = await settings.get()
    const [hold, paid, cancelled] = await Promise.all([
      prisma.referralPayout.aggregate({ where: { status: 'hold' }, _sum: { amountRub: true }, _count: true }),
      prisma.referralPayout.aggregate({ where: { status: 'paid' }, _sum: { amountRub: true }, _count: true }),
      prisma.referralPayout.count({ where: { status: 'cancelled' } }),
    ])
    const levels = LEVEL_NAMES.map((n, i) => `${n}: от ${s.levelThresholds[i]} · <b>${s.referralPercents[i]}%</b>${s.levelBonuses[i] ? ` · +${s.levelBonuses[i]!.days} дн ${planName(s.levelBonuses[i]!.plan)}` : ''}`).join('\n')
    return {
      text:
        header('🎁', 'Рефералы') +
        `На холде: <b>${rub(hold._sum.amountRub)}</b> (${hold._count})\nЗачислено: <b>${rub(paid._sum.amountRub)}</b> (${paid._count})\nОтменено: ${cancelled}\n\n` +
        `<b>Уровни</b>\n${levels}\nХолд: ${s.holdDays} дн`,
      kb: [
        [btn('⏳ Начисления на холде', 'adm:rh:0')],
        [btn('🏆 Топ-30', 'adm:ref:top'), btn('⚡ Снять все холды', 'adm:ref:release')],
        [btn('🎉 Бонус активным', 'adm:ref:bonus'), btn('% по уровням', 'adm:set:pct')],
        [btn('🧹 Обнулить рефералку у пользователя', 'adm:ref:resetone')],
        [btn('🧹 Обнулить рефералку у всех', 'adm:ref:resetall')],
        back(),
      ],
    }
  }

  async function holdList(page: number): Promise<View> {
    const rows = await prisma.referralPayout.findMany({ where: { status: 'hold' }, include: { referrer: true }, orderBy: { payoutAfter: 'asc' }, skip: page * PAGE, take: PAGE + 1 })
    const list = rows.slice(0, PAGE)
    const text = header('⏳', 'Начисления на холде') + (list.map((r) => `${who(r.referrer)} · <b>${rub(r.amountRub)}</b> · до ${dt(r.payoutAfter)}`).join('\n') || '<i>Пусто.</i>')
    const kb: InlineKeyboard = list.map((r) => [btn(`✖️ Отменить ${rub(r.amountRub)} · ${r.referrer.username ?? r.referrer.tgId}`, `adm:rc:${r.id}`)])
    kb.push(pager('adm:rh', page, rows.length > PAGE))
    kb.push(back('adm:ref'))
    return { text, kb }
  }

  async function topReferrers(): Promise<View> {
    const top = await prisma.referralPayout.groupBy({
      by: ['referrerId'],
      where: { status: { not: 'cancelled' } },
      _sum: { amountRub: true },
      orderBy: { _sum: { amountRub: 'desc' } },
      take: 30,
    })
    const users = await prisma.user.findMany({ where: { id: { in: top.map((t) => t.referrerId) } } })
    const text =
      header('🏆', 'Топ-30 рефереров', 'по сумме начислений') +
      (top
        .map((t, i) => {
          const u = users.find((x) => x.id === t.referrerId)
          return `${String(i + 1).padStart(2, ' ')}. ${u ? who(u) : '?'} · <b>${rub(t._sum.amountRub)}</b> · ${u ? LEVEL_NAMES[u.referralLevel] : ''}`
        })
        .join('\n') || '<i>Пока пусто.</i>')
    return { text, kb: [back('adm:ref')] }
  }

  async function serversView(force = false): Promise<View> {
    const list = await servers.list(force)
    const text =
      header('🖥', 'Серверы', 'пинг с бэкенда до панели') +
      (list.map((s) => `${s.online ? '🟢' : '🔴'} <b>${s.country.toUpperCase()}</b> · ${esc(s.host)} · ${s.pingMs != null ? `${s.pingMs} мс` : 'нет ответа'}`).join('\n') || '<i>Серверы не настроены.</i>') +
      `\n\nВсе страны приходят пользователю в одной подписке, клиент сам переключается на доступный сервер.\n` +
      `Добавить или удалить сервер: переменная <code>H1_PANELS</code> в Railway (токены панелей хранятся только там).`
    return {
      text,
      kb: [
        [btn('🔄 Обновить', 'adm:srv:refresh'), btn('🧪 Тест панелей', 'adm:srv:test')],
        [btn('♻️ Обновить клиентов на панелях', 'adm:srv:sync')],
        back(),
      ],
    }
  }

  async function promoMenu(): Promise<View> {
    const [active, archived] = await Promise.all([
      prisma.promoCode.count({ where: { active: true } }),
      prisma.promoCode.count({ where: { active: false } }),
    ])
    return {
      text: `${header('🎟', 'Промокоды')}Активных: <b>${active}</b> · в архиве: ${archived}`,
      kb: [
        [btn('➕ Создать', 'adm:promo:new'), btn('🧬 Сгенерировать N', 'adm:promo:gen')],
        [btn('Активные', 'adm:pl:active:0'), btn('Архив', 'adm:pl:arch:0')],
        [btn('📄 CSV', 'adm:promo:csv')],
        back(),
      ],
    }
  }

  async function promoList(kind: string, page: number): Promise<View> {
    const rows = await prisma.promoCode.findMany({ where: { active: kind === 'active' }, orderBy: { createdAt: 'desc' }, skip: page * PAGE, take: PAGE + 1 })
    const list = rows.slice(0, PAGE)
    const kb: InlineKeyboard = list.map((p) => [btn(`${p.code} · −${p.percent}% · ${p.usedCount}${p.maxUses != null ? '/' + p.maxUses : ''}`, `adm:pr:${p.id}`)])
    kb.push(pager(`adm:pl:${kind}`, page, rows.length > PAGE))
    kb.push(back('adm:promo'))
    return { text: `${header('🎟', kind === 'active' ? 'Активные промокоды' : 'Архив промокодов')}${list.length ? '' : '<i>Пусто.</i>'}`, kb }
  }

  async function promoCard(id: bigint): Promise<View> {
    const p = await prisma.promoCode.findUnique({ where: { id } })
    if (!p) return { text: 'Промокод не найден', kb: [back('adm:promo')] }
    const revenue = await prisma.payment.aggregate({ where: { promoCodeId: id, status: 'paid' }, _sum: { amountRub: true, balanceUsedRub: true } })
    const text =
      header('🎟', esc(p.code), p.active ? 'активен' : 'в архиве') +
      `Скидка: <b>${p.percent}%</b>\nИспользований: <b>${p.usedCount}</b>${p.maxUses != null ? ` из ${p.maxUses}` : ''}\n` +
      `Действует до: ${p.expiresAt ? dt(p.expiresAt) : 'бессрочно'}\n` +
      `Выручка по коду: <b>${rub(Number(revenue._sum.amountRub ?? 0) + Number(revenue._sum.balanceUsedRub ?? 0))}</b>\nСоздан: ${dt(p.createdAt)}`
    return { text, kb: [...(p.active ? [[btn('⛔ Деактивировать', `adm:pr:${id}:off`)]] : [[btn('✅ Вернуть в работу', `adm:pr:${id}:on`)]]), back('adm:pl:active:0')] }
  }

  async function supportList(status: string, page: number): Promise<View> {
    const where: Prisma.SupportTicketWhereInput = status === 'closed' ? { status: 'closed' } : { status: { in: ['open', 'answered'] } }
    const rows = await prisma.supportTicket.findMany({ where, include: { user: true }, orderBy: { updatedAt: 'desc' }, skip: page * PAGE, take: PAGE + 1 })
    const list = rows.slice(0, PAGE)
    const weekAgo = new Date(Date.now() - 7 * DAY)
    const [closedWeek, answered] = await Promise.all([
      prisma.supportTicket.count({ where: { status: 'closed', closedAt: { gte: weekAgo } } }),
      prisma.supportTicket.findMany({ where: { createdAt: { gte: weekAgo }, firstReplyAt: { not: null } }, select: { createdAt: true, firstReplyAt: true } }),
    ])
    const avgMin = answered.length
      ? Math.round(answered.reduce((a, t) => a + (t.firstReplyAt!.getTime() - t.createdAt.getTime()), 0) / answered.length / 60000)
      : null
    const kb: InlineKeyboard = [
      [btn(status === 'closed' ? 'Открытые' : '• Открытые', 'adm:sup:open:0'), btn(status === 'closed' ? '• Закрытые' : 'Закрытые', 'adm:sup:closed:0')],
      ...list.map((t) => [btn(`${t.status === 'open' ? '🔴' : t.status === 'answered' ? '🟡' : '⚪️'} #${t.id} · ${t.user.username ? '@' + t.user.username : t.user.tgId} · ${t.subject.slice(0, 24)}`, `adm:t:${t.id}`)]),
      pager(`adm:sup:${status}`, page, rows.length > PAGE),
      back(),
    ]
    return {
      text:
        header('💬', 'Поддержка', status === 'closed' ? 'закрытые обращения' : 'открытые обращения') +
        `Среднее время ответа (7 дн): <b>${avgMin != null ? `${avgMin} мин` : 'нет данных'}</b>\nЗакрыто за неделю: <b>${closedWeek}</b>\n\n` +
        `🔴 ждёт ответа · 🟡 ответили · ⚪️ закрыт`,
      kb,
    }
  }

  async function ticketView(id: bigint): Promise<View> {
    const t = await prisma.supportTicket.findUnique({ where: { id }, include: { user: true, messages: { orderBy: { createdAt: 'desc' }, take: 10 } } })
    if (!t) return { text: 'Обращение не найдено', kb: [back('adm:sup:open:0')] }
    const msgs = [...t.messages]
      .reverse()
      // Лимит сообщения Telegram 4096 символов: 10 сообщений по 600 не влезали, и обращение не открывалось.
      .map((m) => `${m.internal ? '📝 <i>заметка</i>' : m.fromStaff ? '🛟 <b>Поддержка</b>' : '👤 <b>Пользователь</b>'} · ${dt(m.createdAt)}\n${esc(m.text.length > 350 ? `${m.text.slice(0, 350)}…` : m.text)}`)
      .join('\n\n')
    const text =
      header('💬', `Обращение #${t.id}`, `${t.status} · ${t.assigneeTgId ? `назначено ${t.assigneeTgId}` : 'не назначено'}`) +
      `От: ${who(t.user)}\nТема: ${esc(t.subject)}\n\n${msgs}`
    const kb: InlineKeyboard = [
      [btn('✍️ Ответить', `adm:t:${id}:reply`), btn('📝 Заметка', `adm:t:${id}:note`)],
      [btn('⚡ Шаблон 1', `adm:t:${id}:tpl:0`), btn('⚡ 2', `adm:t:${id}:tpl:1`), btn('⚡ 3', `adm:t:${id}:tpl:2`)],
      [btn('🙋 Взять себе', `adm:t:${id}:assign`), t.status === 'closed' ? btn('↺ Открыть', `adm:t:${id}:reopen`) : btn('✅ Закрыть', `adm:t:${id}:close`)],
      [btn('👤 Пользователь', `adm:u:${t.userId}`)],
      back('adm:sup:open:0'),
    ]
    return { text, kb }
  }

  async function broadcastMenu(): Promise<View> {
    const recent = await prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 5 })
    const lines = recent
      .map((b) => `${b.status === 'sent' ? '✅' : b.status === 'scheduled' ? '🕓' : b.status === 'sending' ? '📤' : '✖️'} #${b.id} · ${SEGMENTS[b.segment] ?? b.segment} · ${dt(b.scheduledAt)}${b.status === 'sent' ? ` · доставлено ${b.delivered}, ошибок ${b.failed}, заблокировали ${b.blocked}` : ''}`)
      .join('\n')
    const scheduled = recent.filter((b) => b.status === 'scheduled')
    return {
      text: `${header('📢', 'Рассылки')}Выберите аудиторию для новой рассылки.\n\n<b>Последние</b>\n${lines || '<i>ещё не было</i>'}`,
      kb: [
        ...Object.entries(SEGMENTS).map(([k, v]) => [btn(v, `adm:bc:seg:${k}`)]),
        ...scheduled.map((b) => [btn(`✖️ Отменить #${b.id}`, `adm:bc:x:${b.id}`)]),
        back(),
      ],
    }
  }

  async function settingsView(): Promise<View> {
    const s = await settings.get()
    const text =
      header('⚙️', 'Настройки') +
      `<b>Цены</b>\nСтарт: ${rub(s.prices.start.month)} / мес · ${rub(s.prices.start.year)} / год\nПремиум: ${rub(s.prices.pro.month)} / мес · ${rub(s.prices.pro.year)} / год\n\n` +
      `Trial: <b>${s.trialDays}</b> дн · по рефералке <b>${s.trialDaysReferral}</b> дн\n` +
      `Реф. проценты: <b>${s.referralPercents.join(' / ')}%</b>\n` +
      `Курс Stars: <b>1 ⭐ = ${s.starsRubRate} ₽</b>\n` +
      `Промокод для новых: <b>${s.defaultPromo ? esc(s.defaultPromo) : 'нет'}</b>\n` +
      `Премиум-эмодзи кнопок: <b>${[s.buttonEmoji.open && 'Открыть', s.buttonEmoji.transfer && 'Перенести'].filter(Boolean).join(', ') || 'нет'}</b>\n` +
      `Техрежим: <b>${s.maintenance ? '🔴 включён, платежи не принимаются' : '🟢 выключен'}</b>`
    return {
      text,
      kb: [
        [btn('Старт / мес', 'adm:set:price:start:month'), btn('Старт / год', 'adm:set:price:start:year')],
        [btn('Премиум / мес', 'adm:set:price:pro:month'), btn('Премиум / год', 'adm:set:price:pro:year')],
        [btn('Trial', 'adm:set:trial'), btn('Trial реф.', 'adm:set:trialref'), btn('% уровней', 'adm:set:pct')],
        [btn('Курс Stars', 'adm:set:stars'), btn('Промокод новым', 'adm:set:promo')],
        [btn('Приветствие бота', 'adm:set:welcome'), btn('Эмодзи кнопок', 'adm:set:btnemoji')],
        [btn(s.maintenance ? '🟢 Выключить техрежим' : '🔴 Включить техрежим', 'adm:set:maint')],
        [btn('👮 Роли', 'adm:roles')],
        back(),
      ],
    }
  }

  async function rolesView(): Promise<View> {
    const rows = await prisma.user.findMany({ where: { role: { not: 'user' } }, orderBy: { role: 'desc' } })
    const owners = [...staff.owners]
    const text =
      header('👮', 'Роли и доступ') +
      `<b>Владельцы</b> (переменная ADMIN_TELEGRAM_IDS)\n${owners.map((o) => `<code>${o}</code>`).join(', ') || 'нет'}\n\n` +
      `<b>Команда</b>\n${rows.map((u) => `${who(u)} · ${u.role}`).join('\n') || '<i>пока никого</i>'}\n\n` +
      `OWNER: всё. ADMIN: пользователи, подписки, серверы, тикеты, рассылки. SUPPORT: просмотр пользователей и тикеты.`
    return {
      text,
      kb: [[btn('➕ Добавить', 'adm:roles:add')], ...rows.map((u) => [btn(`✖️ Снять ${u.username ? '@' + u.username : u.tgId} (${u.role})`, `adm:roles:rm:${u.id}`)]), back('adm:set')],
    }
  }

  async function logsView(kind: string): Promise<View> {
    let body = ''
    if (kind === 'hooks') {
      const rows = await prisma.paymentLog.findMany({ orderBy: { createdAt: 'desc' }, take: 15 })
      body = rows.map((r) => `${dt(r.createdAt)} · <code>${esc(r.orderId)}</code> · ${esc(r.event)}`).join('\n')
    } else if (kind === 'subs') {
      body = recentSubRequests()
        .slice(0, 15)
        .map((r) => `${dt(r.at)} · <code>${r.tgId}</code> · ${r.hwid ? '🟢 HWID' : '⚪️ без HWID'}${r.model ? ` · ${esc(r.model)}` : ''}${r.os ? ` · ${esc(r.os)}` : ''}\n<code>${esc(r.ua).slice(0, 80)}</code>`)
        .join('\n')
    } else if (kind === 'errors') {
      body = recentErrors(24)
        .slice(0, 15)
        .map((e) => `${dt(e.at)} · ${esc(e.where)}\n<code>${esc(e.message).slice(0, 200)}</code>`)
        .join('\n')
    } else {
      const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 15 })
      body = rows.map((r) => `${dt(r.createdAt)} · ${r.adminTgId} · <b>${esc(r.action)}</b>${r.target ? ` · ${esc(r.target)}` : ''}`).join('\n')
    }
    const title = kind === 'subs' ? 'Запросы подписки (устройства)' : kind === 'hooks' ? 'Логи вебхуков' : kind === 'errors' ? 'Ошибки бэкенда за 24 ч' : 'Audit log'
    return {
      text: `${header('📋', title)}${body || '<i>Пусто.</i>'}`,
      kb: [
        [btn(kind === 'audit' ? '• Audit' : 'Audit', 'adm:logs:audit'), btn(kind === 'hooks' ? '• Вебхуки' : 'Вебхуки', 'adm:logs:hooks'), btn(kind === 'errors' ? '• Ошибки' : 'Ошибки', 'adm:logs:errors')],
        [btn(kind === 'subs' ? '• Подписки' : 'Подписки', 'adm:logs:subs')],
        [btn('🔎 Поиск', 'adm:logs:search'), btn('📄 Экспорт', 'adm:logs:csv')],
        back(),
      ],
    }
  }

  const confirm = (text: string, yes: string, no: string): View => ({
    text: `${header('⚠️', 'Подтвердите действие')}${text}`,
    kb: [[btn('✅ Подтвердить', yes), btn('Отмена', no)]],
  })

  // ── отрисовка ─────────────────────────────────────────────────────────────

  async function show(ctx: Ctx, view: View) {
    if (ctx.messageId) await tg.edit(ctx.chatId, ctx.messageId, view.text, view.kb)
    else await tg.send(ctx.chatId, view.text, { keyboard: view.kb })
  }

  function ask(ctx: Ctx, kind: string, prompt: string, data: Fsm['data'] = {}, cancelTo = 'adm:home') {
    fsm.set(ctx.tgId, { kind, data: { ...data, cancelTo } })
    return tg.send(ctx.chatId, `✏️ ${prompt}\n\n<i>Отправьте ответ сообщением или нажмите «Отмена».</i>`, { keyboard: [[btn('Отмена', 'adm:cancel')]] })
  }

  async function userById(id: bigint): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } })
  }

  // ── обработка кнопок ──────────────────────────────────────────────────────

  async function onCallback(ctx: Ctx, data: string): Promise<string | void> {
    const p = data.split(':').slice(1)
    const [a, b, c, d] = p
    if (features?.handles(a)) {
      if (!can(ctx.role, features.section(a))) return 'Нет доступа к этому разделу'
      return features.onCallback(ctx, p)
    }
    const section =
      a === 'uf' || a === 'u' ? 'users' : a === 'sx' ? 'subs' : a === 'p' ? 'pay' : a === 'rh' || a === 'rc' ? 'ref' : a === 'pl' || a === 'pr' ? 'promo' : a === 't' ? 'sup' : a === 'roles' ? 'set' : a
    if (!['home', 'noop', 'cancel'].includes(a) && !can(ctx.role, section)) return 'Нет доступа к этому разделу'

    switch (a) {
      case 'noop':
        return
      case 'home':
        return show(ctx, home(ctx.role))
      case 'cancel':
        fsm.delete(ctx.tgId)
        return show(ctx, { text: 'Отменено.', kb: [back()] })
      case 'dash':
        return show(ctx, await dashboard())

      case 'users':
        if (b === 'search') return void (await ask(ctx, 'user_search', 'Введите tg_id или @username.'))
        return show(ctx, await usersMenu())
      case 'uf':
        return show(ctx, await usersList(b, Number(c ?? 0)))
      case 'u': {
        const id = BigInt(b)
        const u = await userById(id)
        if (!u) return 'Пользователь не найден'
        const target = `user:${id}`
        if (!c) return show(ctx, await userCard(id, ctx.role))
        if (c === 'hist') return show(ctx, await userHistory(id))
        if (ctx.role === 'support') return 'Для поддержки доступен только просмотр'
        if (c === 'ext') {
          const days = Number(d)
          await vpn.grant(u, 'start', days)
          await staff.audit(ctx.tgId, 'extend', target, { days })
          await staff.notify(u.tgId, `🎁 Вам продлили подписку на <b>${days} дн</b>.`)
          await show(ctx, await userCard(id, ctx.role))
          return `Продлено на ${days} дн`
        }
        if (c === 'plan') {
          // Меняем тариф у текущей подписки (раньше создавалась вторая строка с тем же сроком,
          // и приложение могло показывать старый тариф).
          const changed = await vpn.changePlan(u, d as PaidPlan)
          if (!changed) return 'Нет активной подписки: сначала продлите'
          await staff.audit(ctx.tgId, 'change_plan', target, { plan: d })
          await show(ctx, await userCard(id, ctx.role))
          return `Тариф: ${planName(d)}`
        }
        if (c === 'trial') {
          const s = await settings.get()
          await vpn.startTrial(u, s.trialDays, true)
          await staff.audit(ctx.tgId, 'give_trial', target)
          await show(ctx, await userCard(id, ctx.role))
          return 'Trial выдан'
        }
        if (c === 'ban' || c === 'unban') {
          await prisma.user.update({ where: { id }, data: { banned: c === 'ban' } })
          if (c === 'ban') await vpn.cancel(u)
          await staff.audit(ctx.tgId, c, target)
          await show(ctx, await userCard(id, ctx.role))
          return c === 'ban' ? 'Заблокирован' : 'Разблокирован'
        }
        if (c === 'msg') return void (await ask(ctx, 'user_msg', 'Текст сообщения пользователю (можно HTML и премиум-эмодзи).', { userId: b }, `adm:u:${b}`))
        if (ctx.role !== 'owner') return 'Только для владельца'
        if (c === 'bal') return void (await ask(ctx, 'user_bal', d === 'add' ? 'Сколько рублей начислить?' : 'Сколько рублей списать?', { userId: b, sign: d === 'add' ? 1 : -1 }, `adm:u:${b}`))
        if (c === 'refreset')
          return show(ctx, {
            text:
              `${header('🧹', 'Обнулить рефералку', u.username ? '@' + esc(u.username) : String(u.tgId))}` +
              `Все приглашённые отвяжутся от пользователя, начисления на холде отменятся, уровень станет «Базовый».\n\n` +
              `Можно также списать уже зачисленные реферальные бонусы с баланса.`,
            kb: [
              [btn('Обнулить', `adm:u:${b}:refresetok:0`)],
              [btn('Обнулить и списать бонусы', `adm:u:${b}:refresetok:1`)],
              [btn('Отмена', `adm:u:${b}`)],
            ],
          })
        if (c === 'refresetok') {
          const r = await billing.resetReferrals(id, d === '1')
          await staff.audit(ctx.tgId, 'referral_reset', target, r)
          await show(ctx, await userCard(id, ctx.role))
          return `Отвязано ${r.unlinked}, холдов отменено ${r.holdsCancelled}${r.clawback ? `, списано ${r.clawback} ₽` : ''}`
        }
        if (c === 'cancel') return show(ctx, confirm('Подписка будет завершена сейчас, а неиспользованные дни последней оплаты вернутся на баланс.', `adm:u:${b}:cancelok`, `adm:u:${b}`))
        if (c === 'cancelok') {
          const cur = await vpn.current(u.id)
          const last = await prisma.payment.findFirst({ where: { userId: id, status: 'paid' }, orderBy: { paidAt: 'desc' } })
          let refund = 0
          if (cur && last) {
            const total = Number(last.amountRub) + Number(last.balanceUsedRub)
            const leftDays = Math.max(0, (cur.expiresAt.getTime() - Date.now()) / DAY)
            refund = Math.round(Math.min(total, (total * leftDays) / last.periodDays))
          }
          await vpn.cancel(u)
          if (refund > 0) await billing.adjustBalance(id, refund, 'Возврат за отмену подписки')
          await staff.audit(ctx.tgId, 'cancel_subscription', target, { refund })
          await show(ctx, await userCard(id, ctx.role))
          return `Отменено, на баланс ${refund} ₽`
        }
        return
      }

      case 'subs':
        if (b === 'mass') return void (await ask(ctx, 'mass_days', 'На сколько дней продлить всех, у кого подписка закончилась за последние 7 дней?', {}, 'adm:subs'))
        if (b === 'massok') {
          const days = Number(c)
          const since = new Date(Date.now() - 7 * DAY)
          const users = await prisma.user.findMany({
            where: {
              banned: false,
              subscriptions: { some: { expiresAt: { gte: since, lte: new Date() } }, none: { status: { in: ['trial', 'active'] }, expiresAt: { gt: new Date() } } },
            },
          })
          let ok = 0
          for (const u of users) {
            const last = await prisma.subscription.findFirst({ where: { userId: u.id }, orderBy: LATEST_FIRST })
            try {
              await vpn.grant(u, last?.plan === 'pro' ? 'pro' : 'start', days)
              ok++
            } catch {
              /* пропускаем, панель могла не ответить */
            }
          }
          await staff.audit(ctx.tgId, 'mass_extend', undefined, { days, users: ok })
          return show(ctx, { text: `${header('♻️', 'Массовое продление')}Продлено: <b>${ok}</b> из ${users.length} на ${days} дн.`, kb: [back('adm:subs')] })
        }
        return show(ctx, await subsMenu())
      case 'sx':
        return show(ctx, await expiringList(Number(b ?? 0)))

      case 'pay':
        if (b === 'search') return void (await ask(ctx, 'pay_search', 'Введите orderId, id платежа, id транзакции Platega или tg_id пользователя.', {}, 'adm:pay:all:0'))
        if (b === 'csv') {
          const rows = await prisma.payment.findMany({ include: { user: true }, orderBy: { createdAt: 'desc' }, take: 5000 })
          const body = csv([
            ['id', 'orderId', 'tgId', 'username', 'method', 'plan', 'periodDays', 'amountRub', 'balanceUsedRub', 'discountRub', 'status', 'createdAt', 'paidAt'],
            ...rows.map((r) => [String(r.id), r.orderId, String(r.user.tgId), r.user.username, r.method, r.planPurchased, r.periodDays, Number(r.amountRub), Number(r.balanceUsedRub), Number(r.discountRub), r.status, r.createdAt.toISOString(), r.paidAt?.toISOString()]),
          ])
          await tg.sendDocument(ctx.chatId, `payments_${Date.now()}.csv`, body, `Платежи: ${rows.length}`)
          await staff.audit(ctx.tgId, 'export_payments')
          return 'Файл отправлен'
        }
        return show(ctx, await paymentsList(b ?? 'all', Number(c ?? 0)))
      case 'p': {
        const id = BigInt(b)
        if (!c) return show(ctx, await paymentCard(id))
        if (c === 'refund') return show(ctx, confirm('Сумма платежа вернётся пользователю на внутренний баланс, начисление рефереру на холде отменится.', `adm:p:${b}:refundok`, `adm:p:${b}`))
        if (c === 'refundok') {
          const amount = await billing.refundToBalance(id, `Возврат админом ${ctx.tgId}`).catch((e: Error) => e)
          if (amount instanceof Error) return amount.message
          await staff.audit(ctx.tgId, 'refund', `payment:${id}`, { amount })
          const pay = await prisma.payment.findUnique({ where: { id }, include: { user: true } })
          if (pay) await staff.notify(pay.user.tgId, `↩️ Возврат <b>${rub(amount)}</b> зачислен на ваш баланс LYNK.`)
          await show(ctx, await paymentCard(id))
          return 'Возврат выполнен'
        }
        if (c === 'reactivate') {
          const pay = await prisma.payment.findUnique({ where: { id } })
          if (!pay) return 'Платёж не найден'
          const ok = await billing.retryActivation(pay.orderId)
          await staff.audit(ctx.tgId, 'reactivate', `payment:${id}`, { ok })
          await show(ctx, await paymentCard(id))
          return ok ? 'Доступ выдан' : 'Выдавать нечего: доступ уже выдан'
        }
        if (c === 'markpaid') return show(ctx, confirm('Платёж будет считаться оплаченным, подписка выдастся сразу.', `adm:p:${b}:markpaidok`, `adm:p:${b}`))
        if (c === 'markpaidok') {
          const pay = await prisma.payment.findUnique({ where: { id } })
          if (pay) await billing.completePayment(pay.orderId, `manual:${ctx.tgId}`)
          await staff.audit(ctx.tgId, 'mark_paid', `payment:${id}`)
          await show(ctx, await paymentCard(id))
          return 'Отмечено'
        }
        return
      }

      case 'ref':
        if (b === 'top') return show(ctx, await topReferrers())
        if (b === 'release') return show(ctx, confirm('Все начисления на холде будут зачислены на балансы прямо сейчас.', 'adm:ref:releaseok', 'adm:ref'))
        if (b === 'releaseok') {
          const n = await billing.releaseHolds(true)
          await staff.audit(ctx.tgId, 'release_holds', undefined, { count: n })
          await show(ctx, await referralsMenu())
          return `Зачислено: ${n}`
        }
        if (b === 'resetone') return void (await ask(ctx, 'ref_reset_find', 'Чью рефералку обнулить? Введите tg_id или @username.', {}, 'adm:ref'))
        if (b === 'resetall')
          return show(ctx, {
            text: `${header('🧹', 'Обнулить рефералку у всех')}У всех пользователей отвяжутся приглашённые, начисления на холде отменятся, уровни сбросятся. Действие нельзя отменить.`,
            kb: [[btn('Обнулить у всех', 'adm:ref:resetallok:0')], [btn('Обнулить у всех и списать бонусы', 'adm:ref:resetallok:1')], [btn('Отмена', 'adm:ref')]],
          })
        if (b === 'resetallok') {
          const referrers = await prisma.user.findMany({
            where: { OR: [{ referralsMade: { some: {} } }, { payoutsReceived: { some: {} } }, { referralLevel: { gt: 0 } }] },
            select: { id: true },
          })
          const total = { users: 0, unlinked: 0, holdsCancelled: 0, clawback: 0 }
          for (const r of referrers) {
            const res = await billing.resetReferrals(r.id, c === '1')
            total.users++
            total.unlinked += res.unlinked
            total.holdsCancelled += res.holdsCancelled
            total.clawback += res.clawback
          }
          await staff.audit(ctx.tgId, 'referral_reset_all', undefined, total)
          return show(ctx, {
            text: `${header('🧹', 'Рефералка обнулена')}Рефереров: <b>${total.users}</b>\nОтвязано приглашённых: ${total.unlinked}\nОтменено холдов: ${total.holdsCancelled}\nСписано бонусов: ${rub(total.clawback)}`,
            kb: [back('adm:ref')],
          })
        }
        if (b === 'bonus') return void (await ask(ctx, 'ref_bonus', 'Сколько рублей начислить каждому рефереру, у которого есть хотя бы один оплативший друг?', {}, 'adm:ref'))
        if (b === 'bonusok') {
          const amount = Number(c)
          const referrers = await prisma.user.findMany({ where: { referralsMade: { some: { referred: { payments: { some: { status: 'paid' } } } } } } })
          for (const r of referrers) {
            await billing.adjustBalance(r.id, amount, 'Бонус активным реферерам')
            await staff.notify(r.tgId, `🎉 Бонус за приглашённых друзей: <b>${rub(amount)}</b> на баланс.`)
          }
          await staff.audit(ctx.tgId, 'referral_bonus', undefined, { amount, users: referrers.length })
          return show(ctx, { text: `${header('🎉', 'Бонус начислен')}${referrers.length} пользователям по ${rub(amount)}.`, kb: [back('adm:ref')] })
        }
        return show(ctx, await referralsMenu())
      case 'rh':
        return show(ctx, await holdList(Number(b ?? 0)))
      case 'rc': {
        await prisma.referralPayout.update({ where: { id: BigInt(b) }, data: { status: 'cancelled' } })
        await staff.audit(ctx.tgId, 'cancel_payout', `payout:${b}`)
        await show(ctx, await holdList(0))
        return 'Начисление отменено'
      }

      case 'srv':
        if (b === 'sync') {
          const r = await vpn.syncAll()
          await staff.audit(ctx.tgId, 'panel_sync', undefined, r)
          return show(ctx, { text: `${header('♻️', 'Клиенты обновлены')}Успешно: <b>${r.ok}</b> · ошибок: ${r.failed}\n\nНовые инбаунды появятся у пользователей после обновления подписки в Happ.`, kb: [back('adm:srv')] })
        }
        if (b === 'test') {
          const info = panel.describe ? await panel.describe().catch((e: Error) => ({ error: e.message })) : { info: 'нет данных' }
          const json = JSON.stringify(info, null, 1).slice(0, 3000)
          return show(ctx, { text: `${header('🧪', 'Тест панелей')}<pre>${esc(json)}</pre>`, kb: [back('adm:srv')] })
        }
        return show(ctx, await serversView(b === 'refresh'))

      case 'promo':
        if (b === 'new') return void (await ask(ctx, 'promo_code', 'Шаг 1 из 4. Введите код (латиница и цифры), например SPRING20.', {}, 'adm:promo'))
        if (b === 'gen') return void (await ask(ctx, 'gen_count', 'Сколько уникальных кодов сгенерировать? (1–500)', {}, 'adm:promo'))
        if (b === 'csv') {
          const rows = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } })
          const body = csv([['code', 'percent', 'usedCount', 'maxUses', 'expiresAt', 'active'], ...rows.map((r) => [r.code, r.percent, r.usedCount, r.maxUses, r.expiresAt?.toISOString(), r.active ? 'yes' : 'no'])])
          await tg.sendDocument(ctx.chatId, `promo_${Date.now()}.csv`, body, `Промокоды: ${rows.length}`)
          return 'Файл отправлен'
        }
        return show(ctx, await promoMenu())
      case 'pl':
        return show(ctx, await promoList(b, Number(c ?? 0)))
      case 'pr': {
        const id = BigInt(b)
        if (c === 'off' || c === 'on') {
          await prisma.promoCode.update({ where: { id }, data: { active: c === 'on' } })
          await staff.audit(ctx.tgId, c === 'off' ? 'promo_off' : 'promo_on', `promo:${id}`)
        }
        return show(ctx, await promoCard(id))
      }

      case 'sup':
        return show(ctx, await supportList(b ?? 'open', Number(c ?? 0)))
      case 't': {
        const id = BigInt(b)
        if (!c) return show(ctx, await ticketView(id))
        if (c === 'reply') return void (await ask(ctx, 'ticket_reply', `Ответ на обращение #${id}:`, { ticketId: b }, `adm:t:${b}`))
        if (c === 'note') return void (await ask(ctx, 'ticket_note', `Внутренняя заметка к #${id} (пользователь её не увидит):`, { ticketId: b }, `adm:t:${b}`))
        if (c === 'tpl') {
          await replyTicket(ctx, id, TEMPLATES[Number(d)] ?? TEMPLATES[0])
          await show(ctx, await ticketView(id))
          return 'Ответ отправлен'
        }
        if (c === 'assign') {
          await prisma.supportTicket.update({ where: { id }, data: { assigneeTgId: BigInt(ctx.tgId) } })
          await show(ctx, await ticketView(id))
          return 'Назначено на вас'
        }
        if (c === 'close' || c === 'reopen') {
          const t = await prisma.supportTicket.update({
            where: { id },
            data: c === 'close' ? { status: 'closed', closedAt: new Date() } : { status: 'open', closedAt: null },
            include: { user: true },
          })
          await staff.audit(ctx.tgId, `ticket_${c}`, `ticket:${id}`)
          if (c === 'close') await staff.notify(t.user.tgId, `✅ Обращение #${id} закрыто. Если вопрос остался, просто напишите сюда.`)
          await show(ctx, await ticketView(id))
          return c === 'close' ? 'Закрыто' : 'Открыто снова'
        }
        return
      }

      case 'bc': {
        if (b === 'seg') {
          const count = await prisma.user.count({ where: segmentWhere(c) })
          return void (await ask(ctx, 'bc_text', `Аудитория: <b>${SEGMENTS[c]}</b> (${count} чел.)\nВведите текст рассылки. Поддерживаются форматирование Telegram, HTML и премиум-эмодзи.`, { segment: c }, 'adm:bc'))
        }
        if (b === 'nobtn') return previewBroadcast(ctx)
        if (b === 'send' || b === 'sched') {
          const draft = fsm.get(ctx.tgId)
          if (!draft || draft.kind !== 'bc_ready') return 'Черновик не найден, начните заново'
          if (b === 'sched') return void (await ask(ctx, 'bc_when', 'Когда отправить? Формат: ДД.ММ ЧЧ:ММ по Москве, например 05.10 18:30', draft.data, 'adm:bc'))
          const bc = await saveBroadcast(ctx, draft.data, new Date())
          // Не ждём окончания: рассылка на тысячи людей идёт минутами, а кнопка должна ответить сразу.
          void deps.sendBroadcast(bc.id).catch((err: Error) => tg.send(ctx.chatId, `Рассылка #${bc.id} прервалась: ${esc(err.message)}`).catch(() => undefined))
          await tg.send(ctx.chatId, `📤 Рассылка #${bc.id} отправляется. Пришлю итог, когда закончится.`, { keyboard: [back('adm:bc')] })
          return 'Рассылка запущена'
        }
        if (b === 'x') {
          await prisma.broadcast.update({ where: { id: BigInt(c) }, data: { status: 'cancelled' } })
          await staff.audit(ctx.tgId, 'broadcast_cancel', `broadcast:${c}`)
          return show(ctx, await broadcastMenu())
        }
        return show(ctx, await broadcastMenu())
      }

      case 'set': {
        if (b === 'price') return void (await ask(ctx, 'set_price', `Новая цена «${planName(c)}» за ${d === 'year' ? 'год' : 'месяц'}, в рублях:`, { plan: c, period: d }, 'adm:set'))
        if (b === 'trial') return void (await ask(ctx, 'set_trial', 'Длительность Trial, дней:', {}, 'adm:set'))
        if (b === 'trialref') return void (await ask(ctx, 'set_trialref', 'Trial по реферальной ссылке, дней:', {}, 'adm:set'))
        if (b === 'pct') return void (await ask(ctx, 'set_pct', 'Проценты для уровней через пробел: Базовый Серебро Золото Платина. Например: 30 35 40 45', {}, 'adm:set'))
        if (b === 'stars') return void (await ask(ctx, 'set_stars', 'Сколько рублей стоит 1 Star для покупателя? Например 1.8', {}, 'adm:set'))
        if (b === 'promo') return void (await ask(ctx, 'set_promo', 'Промокод, который автоматически получают новые пользователи. Отправьте «-», чтобы убрать.', {}, 'adm:set'))
        if (b === 'welcome') return void (await ask(ctx, 'set_welcome', 'Новый текст приветствия для /start. Можно форматирование Telegram, HTML и премиум-эмодзи.', {}, 'adm:set'))
        if (b === 'btnemoji') {
          return void (await ask(
            ctx,
            'set_btn_emoji',
            'Отправьте одним сообщением два премиум-эмодзи: первое для кнопки «Открыть LYNK», второе для «Перенести подписку». «-» вернёт обычные 🚀 и 🔁.\n\n<i>Премиум-эмодзи видны, если у владельца бота есть Telegram Premium.</i>',
            {},
            'adm:set',
          ))
        }
        if (b === 'maint') {
          const s = await settings.get()
          return show(ctx, confirm(s.maintenance ? 'Снова принимать платежи?' : 'Остановить приём платежей? Пользователи увидят сообщение о техработах.', 'adm:set:maintok', 'adm:set'))
        }
        if (b === 'maintok') {
          const s = await settings.get()
          await settings.set('maintenance', !s.maintenance)
          await staff.audit(ctx.tgId, 'maintenance', undefined, { on: !s.maintenance })
          return show(ctx, await settingsView())
        }
        return show(ctx, await settingsView())
      }
      case 'roles': {
        if (ctx.role !== 'owner') return 'Только для владельца'
        if (b === 'add') return void (await ask(ctx, 'role_add', 'Введите tg_id или @username и роль через пробел: support, admin или owner.\nНапример: 123456789 admin', {}, 'adm:roles'))
        if (b === 'rm') {
          await prisma.user.update({ where: { id: BigInt(c) }, data: { role: 'user' } })
          await staff.audit(ctx.tgId, 'role_remove', `user:${c}`)
        }
        return show(ctx, await rolesView())
      }

      case 'logs': {
        if (b === 'search') return void (await ask(ctx, 'logs_search', 'Введите userId, orderId (invoiceId) или tg_id для поиска по логам.', {}, 'adm:logs'))
        if (b === 'csv') {
          const [audit, hooks] = await Promise.all([
            prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 2000 }),
            prisma.paymentLog.findMany({ orderBy: { createdAt: 'desc' }, take: 2000 }),
          ])
          await tg.sendDocument(ctx.chatId, `audit_${Date.now()}.csv`, csv([['at', 'admin', 'action', 'target', 'details'], ...audit.map((r) => [r.createdAt.toISOString(), String(r.adminTgId), r.action, r.target, JSON.stringify(r.details)])]))
          await tg.sendDocument(ctx.chatId, `webhooks_${Date.now()}.csv`, csv([['at', 'orderId', 'event', 'payload'], ...hooks.map((r) => [r.createdAt.toISOString(), r.orderId, r.event, JSON.stringify(r.payload)])]))
          return 'Файлы отправлены'
        }
        return show(ctx, await logsView(b ?? 'audit'))
      }
    }
  }

  // ── помощники для действий ────────────────────────────────────────────────

  /** html: ответ с разметкой и премиум-эмодзи (текст уже экранирован); в истории обращения хранится простой текст. */
  async function replyTicket(ctx: Ctx, id: bigint, text: string, html = esc(text)) {
    const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id }, include: { user: true } })
    await prisma.ticketMessage.create({ data: { ticketId: id, fromStaff: true, authorTgId: BigInt(ctx.tgId), text } })
    await prisma.supportTicket.update({ where: { id }, data: { status: 'answered', firstReplyAt: t.firstReplyAt ?? new Date(), assigneeTgId: t.assigneeTgId ?? BigInt(ctx.tgId) } })
    await staff.notify(t.user.tgId, `🛟 <b>Ответ поддержки</b> · обращение #${id}\n\n${html}\n\n<i>Ответить можно прямо здесь, в чате.</i>`)
    await staff.audit(ctx.tgId, 'ticket_reply', `ticket:${id}`)
  }

  async function saveBroadcast(ctx: Ctx, data: Fsm['data'], when: Date) {
    fsm.delete(ctx.tgId)
    const bc = await prisma.broadcast.create({
      data: {
        segment: String(data.segment),
        text: String(data.text),
        buttonText: data.buttonText ? String(data.buttonText) : null,
        buttonUrl: data.buttonUrl ? String(data.buttonUrl) : null,
        scheduledAt: when,
        createdByTgId: BigInt(ctx.tgId),
      },
    })
    await staff.audit(ctx.tgId, 'broadcast_create', `broadcast:${bc.id}`, { segment: data.segment, at: when.toISOString() })
    return bc
  }

  async function previewBroadcast(ctx: Ctx) {
    const draft = fsm.get(ctx.tgId)
    if (!draft) return
    draft.kind = 'bc_ready'
    const kb: InlineKeyboard = draft.data.buttonUrl ? [[{ text: String(draft.data.buttonText), url: String(draft.data.buttonUrl) }]] : []
    await tg.send(ctx.chatId, String(draft.data.text), { keyboard: kb.length ? kb : undefined }).catch(async (e: Error) => {
      await tg.send(ctx.chatId, `Ошибка разметки: ${esc(e.message)}`)
    })
    const count = await prisma.user.count({ where: segmentWhere(String(draft.data.segment)) })
    await tg.send(ctx.chatId, `${header('👀', 'Предпросмотр выше')}Аудитория: <b>${SEGMENTS[String(draft.data.segment)]}</b>, ${count} чел.`, {
      keyboard: [[btn('🚀 Отправить сейчас', 'adm:bc:send'), btn('🕓 Запланировать', 'adm:bc:sched')], [btn('Отмена', 'adm:cancel')]],
    })
  }

  async function findUser(query: string) {
    const q = query.trim().replace(/^@/, '')
    if (/^\d+$/.test(q)) return prisma.user.findFirst({ where: { OR: [{ tgId: BigInt(q) }, { id: BigInt(q) }] } })
    return prisma.user.findFirst({ where: { username: { equals: q, mode: 'insensitive' } } })
  }

  // ── пошаговый ввод ────────────────────────────────────────────────────────

  /** entities: разметка сообщения админа (в т.ч. премиум-эмодзи), сохраняем её в текстах для пользователей. */
  async function onText(ctx: Ctx, text: string, entities: TgEntity[] = []): Promise<boolean> {
    const state = fsm.get(ctx.tgId)
    if (!state) return false
    const v = text.trim()
    // Поля, где админ пишет HTML руками: текст не экранируем, добавляем только разметку Telegram.
    const html = entitiesToHtml(text, entities, false)
    const data = state.data
    const retry = (msg: string) => tg.send(ctx.chatId, `⚠️ ${msg}`, { keyboard: [[btn('Отмена', 'adm:cancel')]] })
    const n = Number(v.replace(',', '.'))
    const done = () => fsm.delete(ctx.tgId)

    switch (state.kind) {
      case 'user_search': {
        const u = await findUser(v)
        done()
        if (!u) { await tg.send(ctx.chatId, 'Никого не нашлось.', { keyboard: [back('adm:users')] }); return true }
        await show({ ...ctx, messageId: undefined }, await userCard(u.id, ctx.role))
        return true
      }
      case 'user_msg': {
        const u = await userById(BigInt(String(data.userId)))
        done()
        if (u) {
          await tg.send(u.tgId, `💬 <b>Сообщение от LYNK</b>\n\n${html.trim()}`).then(
            () => tg.send(ctx.chatId, '✅ Доставлено', { keyboard: [back(`adm:u:${u.id}`, '‹ К пользователю')] }),
            (e: Error) => tg.send(ctx.chatId, `Не доставлено: ${esc(e.message)}`),
          )
          await staff.audit(ctx.tgId, 'message_user', `user:${u.id}`)
        }
        return true
      }
      case 'user_bal': {
        if (!Number.isFinite(n) || n <= 0) { await retry('Нужна положительная сумма'); return true }
        const id = BigInt(String(data.userId))
        const amount = n * Number(data.sign)
        await billing.adjustBalance(id, amount, `Админ ${ctx.tgId}`)
        await staff.audit(ctx.tgId, 'balance_adjust', `user:${id}`, { amount })
        done()
        await show({ ...ctx, messageId: undefined }, await userCard(id, ctx.role))
        return true
      }
      case 'mass_days': {
        if (!Number.isInteger(n) || n <= 0 || n > 365) { await retry('Число дней от 1 до 365'); return true }
        done()
        await show({ ...ctx, messageId: undefined }, confirm(`Продлить на <b>${n} дн</b> всех, у кого подписка закончилась за последние 7 дней?`, `adm:subs:massok:${n}`, 'adm:subs'))
        return true
      }
      case 'pay_search': {
        done()
        const byOrder = await prisma.payment.findFirst({ where: { OR: [{ orderId: v }, { externalId: v }, ...(/^\d+$/.test(v) ? [{ id: BigInt(v) }] : [])] } })
        if (byOrder) { await show({ ...ctx, messageId: undefined }, await paymentCard(byOrder.id)); return true }
        const u = await findUser(v)
        if (!u) { await tg.send(ctx.chatId, 'Ничего не найдено.', { keyboard: [back('adm:pay:all:0')] }); return true }
        const pays = await prisma.payment.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 10 })
        await tg.send(ctx.chatId, `${header('🔎', `Платежи ${u.username ? '@' + esc(u.username) : u.tgId}`)}${pays.length ? '' : '<i>нет платежей</i>'}`, {
          keyboard: [...pays.map((p) => [btn(`${p.status} · ${rub(p.amountRub)} · ${day(p.createdAt)}`, `adm:p:${p.id}`)]), back('adm:pay:all:0')],
        })
        return true
      }
      case 'ref_reset_find': {
        const u = await findUser(v)
        if (!u) { await retry('Пользователь не найден'); return true }
        done()
        await show({ ...ctx, messageId: undefined }, {
          text: `${header('🧹', 'Обнулить рефералку', u.username ? '@' + esc(u.username) : String(u.tgId))}Все приглашённые отвяжутся, начисления на холде отменятся, уровень станет «Базовый».`,
          kb: [[btn('Обнулить', `adm:u:${u.id}:refresetok:0`)], [btn('Обнулить и списать бонусы', `adm:u:${u.id}:refresetok:1`)], [btn('Отмена', 'adm:ref')]],
        })
        return true
      }
      case 'ref_bonus': {
        if (!Number.isFinite(n) || n <= 0) { await retry('Нужна положительная сумма'); return true }
        done()
        await show({ ...ctx, messageId: undefined }, confirm(`Начислить по <b>${rub(n)}</b> всем реферерам с оплатившими друзьями?`, `adm:ref:bonusok:${n}`, 'adm:ref'))
        return true
      }
      case 'promo_code': {
        const code = v.toUpperCase()
        if (!/^[A-Z0-9_-]{3,32}$/.test(code)) { await retry('Только латиница, цифры, - и _, от 3 до 32 символов'); return true }
        if (await prisma.promoCode.findUnique({ where: { code } })) { await retry('Такой код уже есть'); return true }
        state.kind = 'promo_pct'
        data.code = code
        await tg.send(ctx.chatId, 'Шаг 2 из 4. Скидка в процентах (1–100):', { keyboard: [[btn('Отмена', 'adm:cancel')]] })
        return true
      }
      case 'promo_pct': {
        if (!Number.isInteger(n) || n < 1 || n > 100) { await retry('Целое число от 1 до 100'); return true }
        state.kind = 'promo_limit'
        data.percent = n
        await tg.send(ctx.chatId, 'Шаг 3 из 4. Лимит использований (0, если без лимита):', { keyboard: [[btn('Отмена', 'adm:cancel')]] })
        return true
      }
      case 'promo_limit': {
        if (!Number.isInteger(n) || n < 0) { await retry('Целое число, 0 = без лимита'); return true }
        state.kind = 'promo_days'
        data.limit = n
        await tg.send(ctx.chatId, 'Шаг 4 из 4. Сколько дней действует код (0, если бессрочно):', { keyboard: [[btn('Отмена', 'adm:cancel')]] })
        return true
      }
      case 'promo_days': {
        if (!Number.isInteger(n) || n < 0) { await retry('Целое число, 0 = бессрочно'); return true }
        const promo = await prisma.promoCode.create({
          data: {
            code: String(data.code),
            percent: Number(data.percent),
            maxUses: Number(data.limit) || null,
            expiresAt: n ? new Date(Date.now() + n * DAY) : null,
          },
        })
        await staff.audit(ctx.tgId, 'promo_create', `promo:${promo.id}`, { code: promo.code, percent: promo.percent })
        done()
        await show({ ...ctx, messageId: undefined }, await promoCard(promo.id))
        return true
      }
      case 'gen_count': {
        if (!Number.isInteger(n) || n < 1 || n > 500) { await retry('От 1 до 500'); return true }
        state.kind = 'gen_pct'
        data.count = n
        await tg.send(ctx.chatId, 'Скидка для всех кодов, % (1–100). Каждый код одноразовый.', { keyboard: [[btn('Отмена', 'adm:cancel')]] })
        return true
      }
      case 'gen_pct': {
        if (!Number.isInteger(n) || n < 1 || n > 100) { await retry('Целое число от 1 до 100'); return true }
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        const codes: string[] = []
        while (codes.length < Number(data.count)) {
          let c = 'LYNK-'
          for (let i = 0; i < 6; i++) c += alphabet[Math.floor(Math.random() * alphabet.length)]
          if (!codes.includes(c)) codes.push(c)
        }
        await prisma.promoCode.createMany({ data: codes.map((code) => ({ code, percent: n, maxUses: 1 })), skipDuplicates: true })
        await staff.audit(ctx.tgId, 'promo_generate', undefined, { count: codes.length, percent: n })
        done()
        await tg.sendDocument(ctx.chatId, `codes_${Date.now()}.csv`, csv([['code', 'percent'], ...codes.map((c) => [c, n])]), `Сгенерировано ${codes.length} кодов на −${n}%`)
        return true
      }
      case 'ticket_reply': {
        const id = BigInt(String(data.ticketId))
        await replyTicket(ctx, id, v, entitiesToHtml(text, entities).trim())
        done()
        await show({ ...ctx, messageId: undefined }, await ticketView(id))
        return true
      }
      case 'ticket_note': {
        const id = BigInt(String(data.ticketId))
        await prisma.ticketMessage.create({ data: { ticketId: id, fromStaff: true, authorTgId: BigInt(ctx.tgId), text: v, internal: true } })
        done()
        await show({ ...ctx, messageId: undefined }, await ticketView(id))
        return true
      }
      case 'bc_text': {
        data.text = html
        state.kind = 'bc_button'
        await tg.send(ctx.chatId, 'Добавить кнопку со ссылкой? Отправьте «Текст | https://ссылка» или нажмите «Без кнопки».', {
          keyboard: [[btn('Без кнопки', 'adm:bc:nobtn'), btn('Отмена', 'adm:cancel')]],
        })
        return true
      }
      case 'bc_button': {
        const [label, url] = v.split('|').map((s) => s.trim())
        let okUrl = false
        try {
          okUrl = new URL(url ?? '').protocol === 'https:'
        } catch {
          okUrl = false
        }
        if (!label || !url || !okUrl) { await retry('Формат: Текст | https://ссылка'); return true }
        data.buttonText = label
        data.buttonUrl = url
        await previewBroadcast(ctx)
        return true
      }
      case 'bc_when': {
        const when = parseMsk(v)
        if (!when || when.getTime() < Date.now()) { await retry('Не понял дату, нужен формат ДД.ММ ЧЧ:ММ в будущем'); return true }
        const bc = await saveBroadcast(ctx, data, when)
        await tg.send(ctx.chatId, `🕓 Рассылка #${bc.id} запланирована на ${dt(when)} МСК.`, { keyboard: [back('adm:bc')] })
        return true
      }
      case 'set_price': {
        if (!Number.isFinite(n) || n <= 0) { await retry('Нужна положительная цена'); return true }
        const s = await settings.get()
        const plan = data.plan as PaidPlan
        const period = data.period as Period
        await settings.set('prices', { ...s.prices, [plan]: { ...s.prices[plan], [period]: Math.round(n) } })
        await staff.audit(ctx.tgId, 'set_price', `${plan}:${period}`, { value: Math.round(n) })
        done()
        await show({ ...ctx, messageId: undefined }, await settingsView())
        return true
      }
      case 'set_trial':
      case 'set_trialref': {
        if (!Number.isInteger(n) || n < 0 || n > 60) { await retry('Целое число от 0 до 60'); return true }
        await settings.set(state.kind === 'set_trial' ? 'trialDays' : 'trialDaysReferral', n)
        await staff.audit(ctx.tgId, state.kind, undefined, { value: n })
        done()
        await show({ ...ctx, messageId: undefined }, await settingsView())
        return true
      }
      case 'set_pct': {
        const parts = v.split(/[\s,/]+/).map(Number)
        if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x) || x < 0 || x > 90)) { await retry('Нужно 4 числа от 0 до 90'); return true }
        await settings.set('referralPercents', parts as [number, number, number, number])
        await staff.audit(ctx.tgId, 'set_referral_percents', undefined, { value: parts })
        done()
        await show({ ...ctx, messageId: undefined }, await settingsView())
        return true
      }
      case 'set_stars': {
        if (!Number.isFinite(n) || n <= 0) { await retry('Нужно положительное число'); return true }
        await settings.set('starsRubRate', n)
        await staff.audit(ctx.tgId, 'set_stars_rate', undefined, { value: n })
        done()
        await show({ ...ctx, messageId: undefined }, await settingsView())
        return true
      }
      case 'set_promo': {
        const code = v === '-' ? '' : v.toUpperCase()
        if (code && !(await prisma.promoCode.findUnique({ where: { code } }))) { await retry('Такого промокода нет, сначала создайте его'); return true }
        await settings.set('defaultPromo', code)
        await staff.audit(ctx.tgId, 'set_default_promo', undefined, { value: code })
        done()
        await show({ ...ctx, messageId: undefined }, await settingsView())
        return true
      }
      case 'set_welcome': {
        await settings.set('welcomeMessage', html)
        await staff.audit(ctx.tgId, 'set_welcome')
        done()
        await tg.send(ctx.chatId, 'Готово. Так теперь выглядит приветствие:')
        await tg.send(ctx.chatId, html).catch((e: Error) => tg.send(ctx.chatId, `Ошибка разметки: ${esc(e.message)}`))
        return true
      }
      case 'set_btn_emoji': {
        const ids = entities.filter((e) => e.type === 'custom_emoji' && e.custom_emoji_id).map((e) => e.custom_emoji_id!)
        if (v !== '-' && !ids.length) { await retry('Не нашёл премиум-эмодзи в сообщении. Отправьте эмодзи из премиум-набора или «-»'); return true }
        await settings.set('buttonEmoji', v === '-' ? { open: '', transfer: '' } : { open: ids[0] ?? '', transfer: ids[1] ?? '' })
        await staff.audit(ctx.tgId, 'set_button_emoji', undefined, { ids })
        done()
        await show({ ...ctx, messageId: undefined }, await settingsView())
        return true
      }
      case 'role_add': {
        const [q, role] = v.split(/\s+/)
        if (!q || !['support', 'admin', 'owner'].includes(role ?? '')) { await retry('Формат: 123456789 admin'); return true }
        const u = await findUser(q)
        if (!u) { await retry('Пользователь не найден: он должен хотя бы раз открыть бота или приложение'); return true }
        await prisma.user.update({ where: { id: u.id }, data: { role: role as StaffRole } })
        await staff.audit(ctx.tgId, 'role_add', `user:${u.id}`, { role })
        await staff.notify(u.tgId, `👮 Вам выдана роль <b>${role}</b> в LYNK. Команда /admin откроет меню.`)
        done()
        await show({ ...ctx, messageId: undefined }, await rolesView())
        return true
      }
      case 'logs_search': {
        done()
        const [audit, hooks] = await Promise.all([
          prisma.auditLog.findMany({ where: { OR: [{ target: { contains: v } }, ...(/^\d+$/.test(v) ? [{ adminTgId: BigInt(v) }] : [])] }, orderBy: { createdAt: 'desc' }, take: 10 }),
          prisma.paymentLog.findMany({ where: { orderId: { contains: v } }, orderBy: { createdAt: 'desc' }, take: 10 }),
        ])
        const body =
          `<b>Audit</b>\n${audit.map((r) => `${dt(r.createdAt)} · ${r.adminTgId} · ${esc(r.action)} · ${esc(r.target)}`).join('\n') || '<i>нет</i>'}\n\n` +
          `<b>Вебхуки</b>\n${hooks.map((r) => `${dt(r.createdAt)} · ${esc(r.orderId)} · ${esc(r.event)}`).join('\n') || '<i>нет</i>'}`
        await tg.send(ctx.chatId, `${header('🔎', 'Поиск по логам', esc(v))}${body}`, { keyboard: [back('adm:logs')] })
        return true
      }
    }
    return features ? features.onText(ctx, state, text) : false
  }

  return {
    home,
    show,
    onCallback,
    onText,
    hasState: (tgId: number) => fsm.has(tgId),
  }
}

export type Admin = ReturnType<typeof createAdmin>
