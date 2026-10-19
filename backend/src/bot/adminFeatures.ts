import type { Prisma, PrismaClient, TransferRequest, TransferStatus, User } from '@prisma/client'
import { xlsx } from '@/lib/xlsx'
import { ACHIEVEMENTS, ACH_BY_CODE, RARITY_NAMES, rewardLabel, type AchievementService } from '@/services/achievements'
import type { HalloweenPrize, RewardSpec, SettingsService } from '@/services/settings'
import type { HalloweenService } from '@/services/halloween'
import type { StatusService } from '@/services/status'
import { REJECT_REASONS, parseTransferCode, transferCode, type TransferCheck, type TransferService } from '@/services/transfer'
import type { VpnService } from '@/services/vpn'
import type { ReviewService } from '@/services/reviews'
import { createReviewsAdmin } from './adminReviews'
import { DAY, PAGE, back, btn, csv, day, dt, header, num, pager, parseMsk, who, confirmView, type Ctx, type Fsm, type View } from './adminUi'
import type { Staff, StaffRole } from './staff'
import { esc, type InlineKeyboard, type Telegram } from './tg'

export interface AdminApi {
  show: (ctx: Ctx, view: View) => Promise<void>
  ask: (ctx: Ctx, kind: string, prompt: string, data?: Fsm['data'], cancelTo?: string) => Promise<unknown>
  fsm: Map<number, Fsm>
  userCard: (id: bigint, role: StaffRole) => Promise<View>
}

const ST_NAMES: Record<TransferStatus, string> = { checking: 'В обработке', approved: 'Одобрено', rejected: 'Отклонено', disputed: 'Спорное', need_link: 'Запрошена ссылка' }
const ST_ICON: Record<TransferStatus, string> = { checking: '⏳', approved: '✅', rejected: '❌', disputed: '🟠', need_link: '🔁' }
const VERDICT_NAMES = { auto_approved: 'Автоодобрено', disputed: 'Спорное', auto_rejected: 'Автоотказ' }
const CHECK_ICON = { ok: '✅', fail: '❌', warn: '⚠️', skip: '▫️' }
const RARITY_ICON = { common: '⚪️', rare: '🔵', epic: '🟣', legendary: '🟡' }
const PERIODS: Record<string, { label: string; ms: number | null }> = {
  all: { label: 'всё время', ms: null },
  day: { label: 'сутки', ms: DAY },
  week: { label: 'неделя', ms: 7 * DAY },
  month: { label: 'месяц', ms: 30 * DAY },
}
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type TransferWithUser = TransferRequest & { user: User }

/**
 * Разделы админ-меню из ТЗ v6.3 · 05: «Переносы подписок», «Достижения», «Статус сервиса»,
 * устройства и бейджи в карточке пользователя.
 */
export function createAdminFeatures(
  deps: {
    prisma: PrismaClient
    tg: Telegram
    staff: Staff
    settings: SettingsService
    vpn: VpnService
    transfer: TransferService
    achievements: AchievementService
    status: StatusService
    halloween: HalloweenService
    sendBroadcast: (id: bigint) => Promise<void>
    statusUrl: string | null
    reviews?: ReviewService
  },
  api: AdminApi,
) {
  const { prisma, tg, staff, settings, vpn, transfer, achievements, status, halloween } = deps
  const { show, ask, fsm } = api
  const reviewsAdmin = deps.reviews ? createReviewsAdmin({ prisma, reviews: deps.reviews, staff, settings: deps.settings }, show) : null

  const SECTIONS: Record<string, string> = {
    tr: 'tr', trl: 'tr', trc: 'tr', tra: 'tr', trs: 'tr', trp: 'tr', trpc: 'tr', trx: 'tr',
    ach: 'ach', achc: 'ach', achs: 'ach', acha: 'ach', achr: 'ach', achx: 'ach', achg: 'ach',
    st: 'st', stn: 'st', stx: 'st', stp: 'st', stpok: 'st', sth: 'st', std: 'st', stdok: 'st',
    hw: 'hw', hwu: 'hw', hww: 'hw', hwc: 'hw', hwd: 'hw', hwx: 'hw', hwp: 'hw',
    ud: 'users', udx: 'users', udh: 'users', ub: 'users', ubg: 'users',
    ...(reviewsAdmin?.sections ?? {}),
  }

  // ── Переносы подписок ─────────────────────────────────────────────────────

  function listWhere(st: string, per: string, flag: string): Prisma.TransferRequestWhereInput {
    const where: Prisma.TransferRequestWhereInput = {}
    if (st !== 'all') where.status = st as TransferStatus
    const ms = PERIODS[per]?.ms
    if (ms) where.createdAt = { gte: new Date(Date.now() - ms) }
    if (flag === 'young') where.accountAgeDays = { lt: 3 }
    if (flag === 'paid') where.hadPaidSub = true
    return where
  }

  async function transfersMenu(): Promise<View> {
    const [byStatus, today] = await Promise.all([
      prisma.transferRequest.groupBy({ by: ['status'], _count: true }),
      prisma.transferRequest.count({ where: { createdAt: { gte: new Date(Date.now() - DAY) } } }),
    ])
    const c = (s: TransferStatus) => byStatus.find((x) => x.status === s)?._count ?? 0
    const total = byStatus.reduce((a, x) => a + x._count, 0)
    return {
      text:
        header('🔁', 'Переносы подписок', `всего ${total} · за сутки ${today}`) +
        `✅ Одобрено: <b>${c('approved')}</b>\n🟠 Спорные: <b>${c('disputed')}</b>\n⏳ В обработке: <b>${c('checking')}</b>\n❌ Отклонено: <b>${c('rejected')}</b>\n🔁 Запрошена ссылка: <b>${c('need_link')}</b>`,
      kb: [
        [btn(`🟠 Спорные (${c('disputed')})`, 'adm:trl:disputed:all:-:date:0')],
        [btn('Все', 'adm:trl:all:all:-:date:0'), btn('Одобрено', 'adm:trl:approved:all:-:date:0'), btn('Отклонено', 'adm:trl:rejected:all:-:date:0')],
        [btn('В обработке', 'adm:trl:checking:all:-:date:0'), btn('Запрошена ссылка', 'adm:trl:need_link:all:-:date:0')],
        [btn('👶 Аккаунт < 3 дн', 'adm:trl:all:all:young:date:0'), btn('💳 Была платная LYNK', 'adm:trl:all:all:paid:date:0')],
        [btn('🔎 Поиск', 'adm:tr:search'), btn('📊 Аналитика', 'adm:trs:month')],
        [btn('📄 CSV', 'adm:trx:csv'), btn('📗 XLSX', 'adm:trx:xlsx'), btn('⛔ Чёрный список', 'adm:trp')],
        back(),
      ],
    }
  }

  async function transfersList(st: string, per: string, flag: string, sort: string, page: number): Promise<View> {
    const orderBy: Prisma.TransferRequestOrderByWithRelationInput =
      sort === 'days' ? { days: { sort: 'desc', nulls: 'last' } } : sort === 'age' ? { accountAgeDays: 'asc' } : { createdAt: 'desc' }
    const rows = await prisma.transferRequest.findMany({
      where: listWhere(st, per, flag),
      include: { user: true },
      orderBy,
      skip: page * PAGE,
      take: PAGE + 1,
    })
    const list = rows.slice(0, PAGE)
    const base = (s: string, p: string, f: string, o: string) => `adm:trl:${s}:${p}:${f}:${o}:0`
    const mark = (on: boolean, t: string) => (on ? `• ${t}` : t)
    const kb: InlineKeyboard = [
      [btn(mark(per === 'all', 'Всё'), base(st, 'all', flag, sort)), btn(mark(per === 'day', 'День'), base(st, 'day', flag, sort)), btn(mark(per === 'week', 'Неделя'), base(st, 'week', flag, sort)), btn(mark(per === 'month', 'Месяц'), base(st, 'month', flag, sort))],
      [btn(mark(sort === 'date', 'По дате'), base(st, per, flag, 'date')), btn(mark(sort === 'days', 'По дням'), base(st, per, flag, 'days')), btn(mark(sort === 'age', 'По возрасту'), base(st, per, flag, 'age'))],
      ...list.map((t) => [
        btn(`${ST_ICON[t.status]} ${transferCode(t).slice(4)} · ${t.user.username ? '@' + t.user.username : t.user.tgId} · ${t.days ?? '?'}д${t.accountAgeDays < 3 ? ' · 👶' : ''}${t.hadPaidSub ? ' · 💳' : ''}`, `adm:trc:${t.id}`),
      ]),
      pager(`adm:trl:${st}:${per}:${flag}:${sort}`, page, rows.length > PAGE),
      back('adm:tr'),
    ]
    const filters = [st === 'all' ? 'все статусы' : ST_NAMES[st as TransferStatus], PERIODS[per]?.label, flag === 'young' ? 'аккаунт < 3 дн' : flag === 'paid' ? 'была платная LYNK' : null].filter(Boolean).join(' · ')
    return { text: `${header('🔁', 'Заявки на перенос', filters)}${list.length ? '👶 аккаунт младше 3 дней · 💳 была платная подписка' : '<i>Ничего не найдено.</i>'}`, kb }
  }

  function checksText(checks: unknown) {
    const list = Array.isArray(checks) ? (checks as unknown as TransferCheck[]) : []
    return list.map((c) => `${CHECK_ICON[c.status] ?? '▫️'} ${c.n}. <b>${esc(c.title)}</b>: ${esc(c.detail)}`).join('\n')
  }

  async function transferCard(id: bigint, ctx: Ctx): Promise<View> {
    const t = await prisma.transferRequest.findUnique({ where: { id }, include: { user: true, comments: { orderBy: { createdAt: 'desc' }, take: 5 } } })
    if (!t) return { text: 'Заявка не найдена', kb: [back('adm:tr')] }
    await staff.audit(ctx.tgId, 'transfer_open', `transfer:${id}`)
    const [dup, sub, opens] = await Promise.all([
      prisma.transferRequest.findFirst({ where: { linkHash: t.linkHash, userId: { not: t.userId } }, orderBy: { createdAt: 'asc' } }),
      vpn.current(t.userId),
      prisma.auditLog.findMany({ where: { target: `transfer:${id}` }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ])
    const link = t.link.length > 300 ? `${t.link.slice(0, 300)}…` : t.link
    const lines = [
      `<b>Юзер:</b> ${who(t.user)} (tg_id <code>${t.user.tgId}</code>, регистрация ${day(t.user.createdAt)}, аккаунту ${t.accountAgeDays} дн${t.accountAgeDays < 3 ? ' ⚠️' : ''})`,
      `<b>Ссылка:</b> <code>${esc(link)}</code>`,
      `<b>Тип:</b> ${t.linkType === 'subscription' ? 'Subscription URL' : `${t.linkType}://`} · <b>провайдер:</b> ${esc(t.provider ?? '?')}${t.providerList === 'black' ? ' (чёрный список ⚠️)' : ''}`,
      `<b>HTTP:</b> ${t.httpStatus ?? '—'} · ${t.responseMs != null ? `${t.responseMs} мс` : '—'} · ${t.bodyBytes != null ? `${t.bodyBytes} Б` : '—'} · конфигов ${t.configsCount ?? '—'}`,
      `<b>subscription-userinfo:</b> <code>${esc(t.userInfo ?? 'нет')}</code>`,
      `<b>Остаток дней:</b> ${t.days ?? '?'}${t.expireAt ? ` (до ${day(t.expireAt)})` : ''}${t.creditedDays ? ` · начислено ${t.creditedDays}` : ''}`,
      `<b>Платная подписка LYNK при подаче:</b> ${t.hadPaidSub ? `была ⚠️` : 'нет'} · сейчас: ${sub ? `${sub.status === 'trial' ? 'Trial' : sub.plan === 'pro' ? 'Премиум' : 'Старт'} до ${day(sub.expiresAt)}` : 'нет'}`,
      `<b>Дубликат ссылки:</b> ${dup ? `найден → ${transferCode(dup)} (/admin → поиск)` : 'не найден'}`,
      `<b>Автопометка:</b> ${t.verdict ? VERDICT_NAMES[t.verdict] : '—'} · <b>статус:</b> ${ST_ICON[t.status]} ${ST_NAMES[t.status]}`,
      t.rejectReason ? `<b>Причина отказа:</b> ${esc(t.rejectReason)}` : '',
      t.decidedAt ? `<b>Решение:</b> ${dt(t.decidedAt)} · ${t.decidedByTgId ? `админ ${t.decidedByTgId}` : 'автоматически'}` : '',
      `<b>IP:</b> <code>${esc(t.ip ?? '?')}</code> · <b>UA:</b> <code>${esc((t.userAgent ?? '?').slice(0, 60))}</code>`,
      '',
      '<b>Проверки</b>',
      checksText(t.checks),
      t.comments.length ? `\n<b>Комментарии</b>\n${t.comments.map((c) => `📝 ${dt(c.createdAt)} · ${c.authorTgId}: ${esc(c.text.slice(0, 200))}`).join('\n')}` : '',
      opens.length ? `\n<b>История</b>\n${opens.map((o) => `${dt(o.createdAt)} · ${o.adminTgId} · ${esc(o.action)}`).join('\n')}` : '',
    ].filter((l) => l !== '')
    const kb: InlineKeyboard = []
    if (t.status !== 'approved') {
      const d = t.days != null ? Math.min(t.days, (await settings.get()).transferMaxDays) : null
      kb.push([...(d ? [btn(`✅ Одобрить (${d} дн)`, `adm:tra:${id}:ok`)] : []), btn('✏️ Одобрить, указать дни', `adm:tra:${id}:okd`)])
      kb.push([btn('❌ Отклонить', `adm:tra:${id}:rj`), btn('🔁 Запросить ссылку', `adm:tra:${id}:nl`)])
    }
    kb.push([btn('♻️ Перепроверить', `adm:tra:${id}:re`), btn('👤 Профиль', `adm:u:${t.userId}`)])
    kb.push([btn('⛔ Провайдер в ЧС', `adm:tra:${id}:bl`), btn('📄 Лог JSON', `adm:tra:${id}:log`), btn('📝 Коммент', `adm:tra:${id}:cm`)])
    kb.push(back('adm:tr'))
    return { text: header('🔁', `Заявка ${transferCode(t)}`, `подана ${dt(t.createdAt)}`) + lines.join('\n'), kb }
  }

  async function transfersAnalytics(per: string): Promise<View> {
    const ms = PERIODS[per]?.ms
    const where: Prisma.TransferRequestWhereInput = ms ? { createdAt: { gte: new Date(Date.now() - ms) } } : {}
    const rows = await prisma.transferRequest.findMany({ where, select: { status: true, provider: true, rejectReason: true, createdAt: true, decidedAt: true, creditedDays: true, userId: true } })
    const total = rows.length
    const approved = rows.filter((r) => r.status === 'approved')
    const rejected = rows.filter((r) => r.status === 'rejected')
    const decided = rows.filter((r) => r.decidedAt)
    const avgMin = decided.length ? Math.round(decided.reduce((a, r) => a + (r.decidedAt!.getTime() - r.createdAt.getTime()), 0) / decided.length / 60000) : null
    const count = <T extends string>(arr: (T | null)[]) => {
      const m = new Map<string, number>()
      for (const k of arr) if (k) m.set(k, (m.get(k) ?? 0) + 1)
      return [...m.entries()].sort((a, b) => b[1] - a[1])
    }
    const topProviders = count(rows.map((r) => r.provider)).slice(0, 5)
    const topReasons = count(rejected.map((r) => r.rejectReason?.split(':')[0] ?? null)).slice(0, 3)
    const avgDays = approved.length ? Math.round(approved.reduce((a, r) => a + (r.creditedDays ?? 0), 0) / approved.length) : 0
    const retention = await transferRetention()
    const text =
      header('📊', 'Аналитика переносов', PERIODS[per]?.label) +
      `Заявок: <b>${total}</b> · одобрено <b>${approved.length}</b> · отклонено ${rejected.length}\n` +
      `Конверсия подано → одобрено: <b>${total ? Math.round((approved.length / total) * 100) : 0}%</b>\n` +
      `Среднее время до решения: <b>${avgMin != null ? `${avgMin} мин` : 'нет данных'}</b>\n` +
      `Средний срок переноса: <b>${avgDays} дн</b>\n\n` +
      `<b>Топ-5 провайдеров</b>\n${topProviders.map(([p, n], i) => `${i + 1}. ${esc(p)} · ${n}`).join('\n') || '<i>нет</i>'}\n\n` +
      `<b>Топ-3 причины отказов</b>\n${topReasons.map(([p, n], i) => `${i + 1}. ${esc(p)} · ${n}`).join('\n') || '<i>нет</i>'}\n\n` +
      `<b>Retention после переноса</b>\n30 дн: ${retention[30] ?? '—'} · 60 дн: ${retention[60] ?? '—'} · 90 дн: ${retention[90] ?? '—'}`
    const p = (k: string) => btn(per === k ? `• ${PERIODS[k].label}` : PERIODS[k].label, `adm:trs:${k}`)
    return { text, kb: [[p('day'), p('week'), p('month'), p('all')], [btn('📄 Отчёт CSV', `adm:trx:rcsv:${per}`), btn('📗 Отчёт XLSX', `adm:trx:rxlsx:${per}`)], back('adm:tr')] }
  }

  /** Доля одобренных, у кого через N дней после переноса была действующая подписка. */
  async function transferRetention() {
    const approved = await prisma.transferRequest.findMany({ where: { status: 'approved', decidedAt: { not: null } }, select: { userId: true, decidedAt: true }, take: 500, orderBy: { decidedAt: 'desc' } })
    const out: Record<number, string> = {}
    for (const n of [30, 60, 90]) {
      const eligible = approved.filter((a) => a.decidedAt!.getTime() <= Date.now() - n * DAY)
      if (!eligible.length) continue
      let kept = 0
      for (const a of eligible) {
        const at = new Date(a.decidedAt!.getTime() + n * DAY)
        const has = await prisma.subscription.count({ where: { userId: a.userId, startedAt: { lte: at }, expiresAt: { gt: at } } })
        if (has) kept++
      }
      out[n] = `${Math.round((kept / eligible.length) * 100)}%`
    }
    return out
  }

  async function transfersExportRows() {
    const rows = await prisma.transferRequest.findMany({ include: { user: true }, orderBy: { createdAt: 'desc' }, take: 10000 })
    return [
      ['ID', 'Статус', 'Автопометка', 'tg_id', 'username', 'Возраст аккаунта', 'Тип', 'Провайдер', 'В ЧС', 'Дней', 'Начислено', 'HTTP', 'Мс', 'Была платная', 'Причина', 'Подана', 'Решение', 'Ссылка'],
      ...rows.map((t: TransferWithUser) => [
        transferCode(t), ST_NAMES[t.status], t.verdict ? VERDICT_NAMES[t.verdict] : '', String(t.user.tgId), t.user.username, t.accountAgeDays, t.linkType, t.provider, t.providerList === 'black' ? 'да' : 'нет',
        t.days, t.creditedDays, t.httpStatus, t.responseMs, t.hadPaidSub ? 'да' : 'нет', t.rejectReason, t.createdAt.toISOString(), t.decidedAt?.toISOString(), t.link,
      ]),
    ]
  }

  /** Перенос разрешён от любого провайдера, кроме чёрного списка. */
  async function providersView(): Promise<View> {
    const rows = await prisma.transferProvider.findMany({ where: { list: 'black' }, orderBy: { domain: 'asc' }, take: 40 })
    return {
      text:
        header('⛔', 'Чёрный список провайдеров', 'остальные разрешены') +
        (rows.length ? 'Заявки с этих доменов отклоняются автоматически. Нажмите на домен, чтобы убрать его из списка.' : '<i>Список пуст: перенос разрешён от любого провайдера.</i>'),
      kb: [
        ...rows.map((r) => [btn(`⚫️ ${r.domain}${r.name ? ` (${r.name})` : ''}`, `adm:trpc:${r.id}`)]),
        [btn('➕ Добавить', 'adm:trp:add')],
        back('adm:tr'),
      ],
    }
  }

  // ── Достижения ────────────────────────────────────────────────────────────

  async function achievementsMenu(): Promise<View> {
    const [counts, s] = await Promise.all([prisma.userAchievement.groupBy({ by: ['code'], _count: true }), settings.get()])
    const n = (code: string) => counts.find((c) => c.code === code)?._count ?? 0
    const kb: InlineKeyboard = []
    for (const a of ACHIEVEMENTS) kb.push([btn(`${RARITY_ICON[a.rarity]} ${a.secret ? '🔒 ' : ''}${a.title.ru} · ${n(a.code)}`, `adm:achc:${a.code}`)])
    kb.push([btn(`⚙️ Скидки: ${s.achievementDiscountDays} дн · потолок ${s.achievementMaxDiscount}%`, 'adm:achs')])
    kb.push([btn('📊 Аналитика', 'adm:acha'), btn('🎖 Выдать бейдж', 'adm:achg'), btn('📄 CSV', 'adm:achx')])
    kb.push(back())
    return { text: `${header('🏆', 'Достижения', '13 бейджей + 3 секретных · число получивших')}Нажмите на бейдж: условие, награда, ручная выдача.`, kb }
  }

  async function achievementCard(code: string, role: StaffRole): Promise<View> {
    const def = ACH_BY_CODE.get(code)
    if (!def) return { text: 'Бейдж не найден', kb: [back('adm:ach')] }
    const [rewards, count, last, s] = await Promise.all([
      achievements.rewardsFor(code),
      prisma.userAchievement.count({ where: { code } }),
      prisma.userAchievement.findMany({ where: { code }, orderBy: { unlockedAt: 'desc' }, take: 5, include: { user: true } }),
      settings.get(),
    ])
    const custom = Boolean(s.achievementRewards?.[code])
    const text =
      header(RARITY_ICON[def.rarity], def.title.ru, `${RARITY_NAMES[def.rarity]} · ${{ social: 'Социальные', loyalty: 'Лояльность', special: 'Особые', secret: 'Секретные' }[def.category]}`) +
      `<b>Условие${def.secret ? ' (видно только админу)' : ''}:</b> ${def.desc.ru}\n` +
      `<b>Награда${custom ? ' (изменена)' : ''}:</b> ${rewards.map((r) => rewardLabel(r)).join(', ') || 'нет'}\n` +
      `<b>Получили:</b> ${count}\n\n` +
      `<b>Последние</b>\n${last.map((r) => `${dt(r.unlockedAt)} · ${who(r.user)}${r.grantedByTgId ? ' · вручную' : ''}`).join('\n') || '<i>пока никто</i>'}`
    const kb: InlineKeyboard = []
    if (role === 'owner') kb.push([btn('✏️ Изменить награду', `adm:achc:${code}:edit`), ...(custom ? [btn('↩️ По умолчанию', `adm:achr:${code}`)] : [])])
    kb.push([btn('🎖 Выдать пользователю', `adm:achg:${code}`)])
    kb.push(back('adm:ach'))
    return { text, kb }
  }

  /** «days 3; discount 10; device 1 forever; discount 15 365 reusable» → награды. */
  function parseRewards(input: string, code: string): RewardSpec[] | string {
    const out: RewardSpec[] = []
    for (const part of input.split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean)) {
      const [kindRaw, valueRaw, ...rest] = part.split(/\s+/)
      const kind = ({ days: 'days', дни: 'days', discount: 'discount', скидка: 'discount', device: 'device', устройство: 'device' } as Record<string, RewardSpec['kind']>)[kindRaw.toLowerCase()]
      const value = Number(valueRaw)
      if (!kind || !Number.isInteger(value) || value <= 0) return `Не понял «${part}». Формат: days 3; discount 10; device 1`
      const r: RewardSpec = { kind, value }
      for (const token of rest.map((x) => x.toLowerCase())) {
        if (token === 'forever' || token === 'навсегда') {
          if (kind === 'device') r.forever = true
          else if (kind === 'discount') {
            if (code !== 'veteran') return 'Скидка «навсегда» — только для бейджа «Ветеран»'
            r.validDays = null
            r.reusable = true
          }
        } else if (token === 'reusable' || token === 'многоразовая') r.reusable = true
        else if (/^\d+$/.test(token) && kind === 'discount') r.validDays = Number(token)
        else return `Не понял параметр «${token}»`
      }
      if (kind === 'discount' && value > 50) return 'Скидка за бейдж не больше 50%'
      if (kind === 'days' && value > 60) return 'Не больше 60 дней за бейдж'
      out.push(r)
    }
    return out.length ? out : 'Нужна хотя бы одна награда'
  }

  async function achievementsAnalytics(): Promise<View> {
    const a = await achievements.analytics()
    const text =
      header('📊', 'Аналитика достижений') +
      `<b>Топ-5 получаемых</b>\n${a.top.map((x, i) => `${i + 1}. ${x.title} · ${x.count}`).join('\n')}\n\n` +
      `<b>Топ-3 редких</b>\n${a.rarest.map((x, i) => `${i + 1}. ${x.title} · ${x.count}`).join('\n')}\n\n` +
      `<b>Награды</b>\nДней выдано за 30 дн: <b>${a.daysMonth}</b>\nАктивных скидок: <b>${a.activeDiscounts}</b>\nБонусных устройств: <b>${a.bonusDevices}</b>\n\n` +
      `<b>Retention (аккаунты старше 90 дн, активная подписка)</b>\nС бейджами: <b>${a.retentionWith ?? '—'}%</b> · без: <b>${a.retentionWithout ?? '—'}%</b>`
    return { text, kb: [[btn('📄 Отчёт CSV', 'adm:achx'), btn('📗 XLSX', 'adm:achx:xlsx')], back('adm:ach')] }
  }

  async function userBadges(userId: bigint, role: StaffRole): Promise<View> {
    const u = await prisma.user.findUnique({ where: { id: userId } })
    if (!u) return { text: 'Пользователь не найден', kb: [back('adm:users')] }
    const [rows, summary] = await Promise.all([prisma.userAchievement.findMany({ where: { userId } }), achievements.rewardsSummary(u)])
    const have = new Set(rows.map((r) => r.code))
    const text =
      header('🏆', `Бейджи ${u.username ? '@' + esc(u.username) : u.tgId}`, `${rows.length} из ${ACHIEVEMENTS.length}`) +
      (rows.map((r) => `${RARITY_ICON[ACH_BY_CODE.get(r.code)?.rarity ?? 'common']} ${ACH_BY_CODE.get(r.code)?.title.ru ?? r.code} · ${day(r.unlockedAt)}${r.grantedByTgId ? ' · вручную' : ''}`).join('\n') || '<i>пока нет</i>') +
      `\n\n<b>Награды</b>\nДней начислено: ${summary.daysGranted}\nСкидок активно: ${summary.discounts.map((d) => `${d.percent}%${d.expiresAt ? ` до ${day(new Date(d.expiresAt))}` : ' навсегда'}`).join(', ') || 'нет'}\nБонусных устройств: ${summary.bonusDevices}\nСкидка на следующий платёж: ${summary.nextPaymentDiscount}%`
    const kb: InlineKeyboard = []
    if (role !== 'support') {
      const missing = ACHIEVEMENTS.filter((a) => !have.has(a.code))
      for (let i = 0; i < missing.length; i += 2) kb.push(missing.slice(i, i + 2).map((a) => btn(`🎖 ${a.title.ru}`, `adm:ubg:${userId}:${a.code}`)))
    }
    kb.push(back(`adm:u:${userId}`, '‹ К пользователю'))
    return { text, kb }
  }

  // ── Хэллоуин-розыгрыш ─────────────────────────────────────────────────────

  const PHASE_NAMES: Record<string, string> = {
    off: '⚪️ выключено',
    before: '🕓 до старта',
    live: '🟢 идёт сбор конфет',
    closed: '🔒 приём закрыт',
    published: '🏁 результаты опубликованы',
  }

  async function halloweenMenu(): Promise<View> {
    const d = await halloween.dashboard()
    const c = d.config
    const text =
      header('🎃', 'Хэллоуин-розыгрыш', `${PHASE_NAMES[d.phase]} · ${day(new Date(c.startAt))} — ${day(new Date(c.ticketsUntil))}`) +
      `<b>Конфет в котле:</b> ${num(d.pool)}\n` +
      `<b>Участников:</b> ${num(d.participants)}\n` +
      `За присоединившихся: <b>${num(d.join)}</b> · за оплативших: <b>${num(d.paid)}</b>\n` +
      `С колеса: <b>${num(d.wheel)}</b> · вручную: <b>${num(d.admin)}</b> · аннулировано: <b>${num(d.revoked)}</b>\n` +
      `<b>Спинов:</b> ${num(d.spins)} · средний результат: <b>${d.avgSpin.toFixed(2)}</b> конфеты\n` +
      (d.draw ? `\n<b>Розыгрыш:</b> ${dt(d.draw.createdAt)}, победителей ${d.draw.winners.length}${d.draw.publishedAt ? ' · опубликован' : ' · не опубликован'}` : '')
    return {
      text,
      kb: [
        [btn('🏆 Топ-10', 'adm:hw:top'), btn('🔎 Поиск участника', 'adm:hw:search')],
        [btn('🎡 Колесо', 'adm:hww'), btn('🎁 Розыгрыш', 'adm:hwd')],
        [btn('🚩 Аномалии', 'adm:hw:anom'), btn('📄 Конфеты CSV', 'adm:hwx:tickets'), btn('📗 XLSX', 'adm:hwx:tickets:xlsx')],
        [btn('🗓 Даты', 'adm:hwc'), btn(c.enabled ? '⏸ Выключить событие' : '▶️ Включить событие', 'adm:hw:toggle')],
        back(),
      ],
    }
  }

  async function halloweenTop(): Promise<View> {
    const rows = await halloween.topUsers(10)
    return {
      text:
        header('🏆', 'Топ-10 по конфетам') +
        (rows.map((r, i) => `${i + 1}. ${who(r.user)} · <b>${r.tickets}</b>`).join('\n') || '<i>конфет пока нет</i>'),
      kb: [...rows.map((r) => [btn(`🎟 ${r.user.username ? '@' + r.user.username : r.user.tgId} · ${r.tickets}`, `adm:hwu:${r.user.id}`)]), back('adm:hw')],
    }
  }

  async function halloweenUser(userId: bigint, role: StaffRole): Promise<View> {
    const u = await prisma.user.findUnique({ where: { id: userId } })
    if (!u) return { text: 'Пользователь не найден', kb: [back('adm:hw')] }
    const [total, rows, spins, status] = await Promise.all([
      halloween.ticketsOf(userId),
      halloween.history(userId, 10),
      halloween.wheelHistory(userId, 5),
      halloween.wheelStatus(u),
    ])
    const text =
      header('🍬', `Конфеты ${u.username ? '@' + esc(u.username) : u.tgId}`, `всего ${total}`) +
      `${rows.map((r) => `${dt(new Date(r.at))} · ${r.title}${r.friend ? ` (@${esc(r.friend)})` : ''} → ${r.amount ? `+${r.amount}` : 'пусто'}${r.revoked ? ' · аннулирован' : ''}${r.holdUntil ? ' · холд' : ''}`).join('\n') || '<i>конфет нет</i>'}\n\n` +
      `<b>Спины:</b> ${spins.map((s) => `${dt(new Date(s.at))} → ${s.tickets || 'пусто'}`).join('\n') || 'нет'}\n` +
      `<b>Колесо сейчас:</b> ${status.available ? 'доступно' : `недоступно (${status.reason})`}`
    const kb: InlineKeyboard = []
    if (role !== 'support') {
      kb.push([btn('➕ Начислить конфеты', `adm:hwu:${userId}:grant`), btn('🚫 Аннулировать все', `adm:hwu:${userId}:revoke`)])
      kb.push([btn('🔄 Сбросить лимит спина', `adm:hwu:${userId}:spin`)])
    }
    kb.push([btn('‹ К пользователю', `adm:u:${userId}`), btn('‹ Хэллоуин', 'adm:hw')])
    return { text, kb }
  }

  async function halloweenWheel(): Promise<View> {
    const c = await halloween.config()
    const w = c.wheel
    const sum = w.sectors.reduce((a, s) => a + s.chance, 0)
    const avg = w.sectors.reduce((a, s) => a + (s.chance / (sum || 1)) * s.tickets, 0)
    return {
      text:
        header('🎡', 'Колесо фортуны', w.enabled ? 'включено' : 'выключено') +
        `${w.sectors.map((s) => `${s.tickets ? `+${s.tickets} ${s.tickets === 1 ? 'конфета' : 'конфеты'}` : 'Пусто'} · <b>${s.chance}%</b>`).join('\n')}\n` +
        `Сумма шансов: <b>${sum}%</b> · ожидание <b>${avg.toFixed(2)}</b> конфеты за спин\n\n` +
        `Спинов в сутки: <b>${w.spinsPerDay}</b>\nМин. остаток подписки: <b>${w.minSubDays} дн</b>\nПервый спин через: <b>${w.firstSpinAfterHours} ч</b> после активации\nПотолок конфет с колеса: <b>${c.maxWheelTickets}</b>`,
      kb: [
        [btn('🎲 Шансы', 'adm:hww:chances'), btn('🔁 Спинов в сутки', 'adm:hww:spins')],
        [btn('📆 Мин. дней подписки', 'adm:hww:minsub'), btn('🍬 Потолок конфет', 'adm:hww:cap')],
        [btn(w.enabled ? '⏸ Выключить колесо' : '▶️ Включить колесо', 'adm:hww:toggle')],
        back('adm:hw'),
      ],
    }
  }

  async function halloweenDraw(): Promise<View> {
    const c = await halloween.config()
    const draw = await halloween.lastDraw()
    const stats = await halloween.stats()
    const prizes = c.prizes.slice().sort((a, b) => a.place - b.place)
    const live = draw?.winners.filter((w) => !w.replacedAt) ?? []
    const text =
      header('🎁', 'Розыгрыш', `${prizes.reduce((a, p) => a + p.count, 0)} призов`) +
      `${prizes.map((p) => `${p.place} место · ${esc(p.title)} × ${p.count}${p.reward ? '' : ' (выдаёт администрация)'}`).join('\n')}\n\n` +
      `<b>Котёл:</b> ${num(stats.tickets)} конфет от ${num(stats.participants)} участников\n` +
      `<b>Сбор конфет:</b> ${c.intakeClosed ? '🔒 закрыт' : '🟢 открыт'} (до ${dt(new Date(c.ticketsUntil))})\n` +
      (draw
        ? `\n<b>Последний розыгрыш:</b> ${dt(draw.createdAt)}\n` +
          `Победителей: ${live.length} · призы выданы: ${live.filter((w) => w.grantedAt).length} · уведомлены: ${live.filter((w) => w.notifiedAt).length}\n` +
          `Публикация: ${draw.publishedAt ? dt(draw.publishedAt) : 'не опубликован'}\n` +
          '<i>Публикация только показывает список в приложении. Призы, уведомления и скидки начисляются кнопками ниже.</i>'
        : '\n<i>Розыгрыш ещё не проводился.</i>')
    const kb: InlineKeyboard = [
      [btn('🎁 Призы', 'adm:hwp'), btn('🏅 Победители', 'adm:hwd:list')],
      [btn(c.intakeClosed ? '🔓 Открыть сбор' : '🔒 Закрыть сбор', 'adm:hwd:intake')],
      [btn('🎲 Провести розыгрыш', 'adm:hwd:run')],
    ]
    if (draw) {
      if (!draw.publishedAt) kb.push([btn('📣 Опубликовать результаты', 'adm:hwd:pub')])
      // Призы, уведомления и скидки выдаются отдельно: публикация сама ничего не начисляет.
      kb.push([btn('💸 Начислить призы', 'adm:hwd:prizes'), btn('🔔 Уведомить победителей', 'adm:hwd:notify')])
      kb.push([btn('🎟 Утешительные скидки', 'adm:hwd:cons')])
      kb.push([btn('📄 Протокол CSV', 'adm:hwx:draw'), btn('📗 XLSX', 'adm:hwx:draw:xlsx')])
    }
    kb.push(back('adm:hw'))
    return { text, kb }
  }

  async function halloweenWinners(): Promise<View> {
    const draw = await halloween.lastDraw()
    const live = draw?.winners.filter((w) => !w.replacedAt) ?? []
    return {
      text:
        header('🏅', 'Победители', draw ? `розыгрыш ${dt(draw.createdAt)}${draw.seed === 'manual' ? ' · вручную' : ` · зерно ${draw.seed.slice(0, 8)}`}` : 'розыгрыша ещё не было') +
        (live.map((w) => `${w.place} место · <b>${esc(w.prizeTitle)}</b>\n  ${who(w.user)} · конфет ${w.tickets}${w.grantedAt ? ' · приз выдан' : ''}${w.notifiedAt ? ' · уведомлён' : ''}`).join('\n') ||
          '<i>Пока никого. Проведите розыгрыш или добавьте победителей вручную.</i>') +
        '\n\n<i>Нажмите на победителя: выдать приз, написать, сменить место, заменить или убрать.</i>',
      kb: [
        ...live.map((w) => [btn(`${w.place}. ${w.grantedAt ? '✅' : '⏳'} ${w.user.username ? '@' + w.user.username : w.user.tgId} · ${w.prizeTitle}`, `adm:hwd:w:${w.id}`)]),
        [btn('➕ Добавить победителя', 'adm:hwd:wadd')],
        back('adm:hwd'),
      ],
    }
  }

  const rewardText = (p: HalloweenPrize) => (p.reward ? `${p.reward.plan === 'pro' ? 'Премиум' : 'Старт'} на ${p.reward.days} дн. (начисляется сам)` : 'выдаёт администрация')

  /** Призы розыгрыша: список, добавление, правка, удаление. */
  async function halloweenPrizes(): Promise<View> {
    const c = await halloween.config()
    const list = c.prizes.slice().sort((a, b) => a.place - b.place)
    return {
      text:
        header('🎁', 'Призы', `${list.reduce((a, p) => a + p.count, 0)} шт.`) +
        (list.map((p) => `<b>${p.place} место</b> · ${esc(p.title)} × ${p.count}
  ${rewardText(p)}`).join('\n') || '<i>Призов нет.</i>') +
        '\n\n<i>Эти призы видят участники в приложении. Розыгрыш раздаёт их по местам: сначала 1 место, потом 2-е и т.д.</i>',
      kb: [
        ...list.map((p) => [btn(`✏️ ${p.place}. ${p.title} × ${p.count}`, `adm:hwp:e:${p.code}`)]),
        [btn('➕ Добавить приз', 'adm:hwp:add')],
        back('adm:hwd'),
      ],
    }
  }

  async function halloweenPrize(code: string): Promise<View> {
    const c = await halloween.config()
    const p = c.prizes.find((x) => x.code === code)
    if (!p) return { text: 'Приз не найден', kb: [back('adm:hwp')] }
    return {
      text: header('🎁', esc(p.title), `${p.place} место`) + `Количество: <b>${p.count}</b>\nНаграда: ${rewardText(p)}\nКод: <code>${esc(p.code)}</code>`,
      kb: [
        [btn('Название', `adm:hwp:t:${code}`), btn('Место', `adm:hwp:p:${code}`), btn('Количество', `adm:hwp:n:${code}`)],
        [btn('Награда', `adm:hwp:r:${code}`)],
        [btn('🗑 Удалить приз', `adm:hwp:del:${code}`)],
        back('adm:hwp'),
      ],
    }
  }

  async function halloweenWinner(id: bigint): Promise<View> {
    const w = await prisma.halloweenWinner.findUnique({ where: { id }, include: { user: true } })
    if (!w) return { text: 'Победитель не найден', kb: [back('adm:hwd:list')] }
    return {
      text:
        header('🏅', `${w.place} место`, esc(w.prizeTitle)) +
        `${who(w.user)} · <code>${w.user.tgId}</code>\nКонфет: ${w.tickets}\n` +
        `Приз: ${w.grantedAt ? '✅ выдан ' + dt(w.grantedAt) : '⏳ не выдан'}\nУведомление: ${w.notifiedAt ? '✅ ' + dt(w.notifiedAt) : 'не отправлено'}` +
        (w.replacedAt ? '\n\n<i>Убран из победителей.</i>' : ''),
      kb: w.replacedAt
        ? [back('adm:hwd:list')]
        : [
            [btn(w.grantedAt ? '✅ Приз выдан' : '💸 Выдать приз', `adm:hwd:one:${w.id}`), btn(w.notifiedAt ? '🔕 Уведомлён' : '🔔 Уведомить', `adm:hwd:note:${w.id}`)],
            [btn('🔢 Сменить место', `adm:hwd:wp:${w.id}`), btn('🔄 Заменить случайным', `adm:hwd:rep:${w.id}`)],
            [btn('🗑 Убрать из победителей', `adm:hwd:wdel:${w.id}`)],
            [btn('👤 Пользователь', `adm:u:${w.userId}`)],
            back('adm:hwd:list'),
          ],
    }
  }

  async function halloweenDates(): Promise<View> {
    const c = await halloween.config()
    return {
      text:
        header('🗓', 'Даты мероприятия', 'время московское') +
        `Старт: <b>${dt(new Date(c.startAt))}</b>\nСбор конфет до: <b>${dt(new Date(c.ticketsUntil))}</b>\nРозыгрыш: <b>${dt(new Date(c.drawAt))}</b>`,
      kb: [[btn('Старт', 'adm:hwc:start'), btn('Приём до', 'adm:hwc:until'), btn('Розыгрыш', 'adm:hwc:draw')], back('adm:hw')],
    }
  }

  async function halloweenAnomalies(): Promise<View> {
    const rows = await halloween.anomalies(10)
    return {
      text:
        header('🚩', 'Аномалии', 'один IP, несколько аккаунтов') +
        (rows.map((r) => `<code>${esc(r.ip)}</code> · аккаунтов: <b>${r.accounts}</b>`).join('\n') || '<i>подозрительных IP нет</i>'),
      kb: [back('adm:hw')],
    }
  }

  // ── Статус сервиса ────────────────────────────────────────────────────────

  async function statusView(): Promise<View> {
    const s = await status.snapshot()
    const names = { ok: '🟢 Все системы работают', degraded: '🟠 Есть проблемы', down: '🔴 Сбой' }
    const text =
      header('📶', 'Статус сервиса', `обновлено ${dt(new Date(s.updatedAt))}`) +
      `<b>${names[s.overall]}</b>${s.eta ? `\nВосстановление к ${dt(new Date(s.eta))}` : ''}\n\n` +
      `<b>Узлы</b>\n${s.nodes.map((n) => `${n.online ? '🟢' : '🔴'} <b>${esc(n.id.toUpperCase())}</b> · ${n.pingMs != null ? `${n.pingMs} мс` : 'нет ответа'} · 24ч ${n.uptime24h ?? '—'}% · 30д ${n.uptime30d ?? '—'}%`).join('\n') || '<i>узлы не настроены</i>'}\n\n` +
      `<b>Открытые инциденты</b>\n${s.openIncidents.map((i) => `${i.severity === 'major' ? '🔴' : '🟠'} #${i.id} ${esc(i.title)}${i.auto ? ' · авто' : ''} · с ${dt(new Date(i.startedAt))}`).join('\n') || '<i>нет</i>'}` +
      (deps.statusUrl ? `\n\nПубличная страница: ${esc(deps.statusUrl)}` : '')
    const kb: InlineKeyboard = [[btn('🔄 Обновить', 'adm:st'), btn('🕓 История', 'adm:sth')], [btn('🟠 Опубликовать проблему', 'adm:stn:minor'), btn('🔴 Крупный сбой', 'adm:stn:major')]]
    for (const i of s.openIncidents) {
      const inc = await prisma.incident.findUnique({ where: { id: BigInt(i.id) } })
      kb.push([btn(`✅ Закрыть #${i.id}`, `adm:stx:${i.id}`), ...(inc?.notifiedAll ? [] : [btn(`📢 Оповестить всех #${i.id}`, `adm:stp:${i.id}`)]), btn(`🗑 #${i.id}`, `adm:std:${i.id}`)])
    }
    kb.push(back())
    return { text, kb }
  }

  async function broadcastAll(text: string, byTgId: number) {
    const bc = await prisma.broadcast.create({
      data: {
        segment: 'all',
        text,
        buttonText: deps.statusUrl?.startsWith('https://') ? 'Статус сервиса' : null,
        buttonUrl: deps.statusUrl?.startsWith('https://') ? deps.statusUrl : null,
        scheduledAt: new Date(),
        createdByTgId: BigInt(byTgId),
      },
    })
    void deps.sendBroadcast(bc.id).catch(() => undefined)
    return bc
  }

  // ── Устройства пользователя ───────────────────────────────────────────────

  async function userDevices(userId: bigint, role: StaffRole): Promise<View> {
    const u = await prisma.user.findUnique({ where: { id: userId } })
    if (!u) return { text: 'Пользователь не найден', kb: [back('adm:users')] }
    const [devices, sub, bonus] = await Promise.all([
      prisma.device.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } }),
      vpn.current(userId),
      vpn.bonusDevices(userId),
    ])
    const limit = sub ? await vpn.deviceLimit(u, sub.plan) : 0
    const text =
      header('📱', `Устройства ${u.username ? '@' + esc(u.username) : u.tgId}`, `занято ${devices.length} из ${limit ?? '∞'}${bonus ? ` (в т.ч. +${bonus} бонус)` : ''}`) +
      (devices
        .map((d) => `• <b>${esc(d.label ?? 'Устройство')}</b> · ${esc(d.platform ?? '')}\n  HWID <code>${esc(d.hwid.slice(0, 60))}</code>\n  привязано ${day(d.createdAt)} · было ${dt(d.lastSeenAt)}`)
        .join('\n') || '<i>устройств нет</i>')
    const kb: InlineKeyboard = []
    if (role !== 'support') for (const d of devices) kb.push([btn(`✖️ Отвязать ${(d.label ?? 'устройство').slice(0, 24)}`, `adm:udx:${d.id}`)])
    kb.push([btn('🕓 История привязок', `adm:udh:${userId}`)])
    kb.push(back(`adm:u:${userId}`, '‹ К пользователю'))
    return { text, kb }
  }

  async function deviceHistory(userId: bigint): Promise<View> {
    const rows = await prisma.deviceEvent.findMany({ where: { userId }, orderBy: { at: 'desc' }, take: 20 })
    const names: Record<string, string> = { bound: '➕ привязано', unbound: '➖ отвязал сам', admin_unbound: '🛠 отвязал админ' }
    return {
      text: header('🕓', 'История привязок') + (rows.map((r) => `${dt(r.at)} · ${names[r.event] ?? r.event} · ${esc(r.label ?? '')}${r.byTgId ? ` · ${r.byTgId}` : ''}\n  <code>${esc(r.hwid.slice(0, 50))}</code>`).join('\n') || '<i>пусто</i>'),
      kb: [back(`adm:ud:${userId}`)],
    }
  }

  // ── Обработка кнопок ──────────────────────────────────────────────────────

  async function onCallback(ctx: Ctx, p: string[]): Promise<string | void> {
    if (reviewsAdmin && p[0] in reviewsAdmin.sections) return reviewsAdmin.onCallback(ctx, p)
    const [a, b, c, d, e, f] = p
    const isOwner = ctx.role === 'owner'
    switch (a) {
      case 'tr':
        if (b === 'search') return void (await ask(ctx, 'tr_search', 'Введите tg_id, @username, ID заявки (TRF-…), часть ссылки или домен провайдера.', {}, 'adm:tr'))
        return show(ctx, await transfersMenu())
      case 'trl':
        return show(ctx, await transfersList(b ?? 'all', c ?? 'all', d ?? '-', e ?? 'date', Number(f ?? 0)))
      case 'trc':
        return show(ctx, await transferCard(BigInt(b), ctx))
      case 'tra': {
        const id = BigInt(b)
        const t = await prisma.transferRequest.findUnique({ where: { id } })
        if (!t) return 'Заявка не найдена'
        if (c === 'ok') {
          if (t.days == null) return 'Срок не определён: нажмите «Одобрить, указать дни»'
          await transfer.approve(id, t.days, ctx.tgId)
          await staff.audit(ctx.tgId, 'transfer_approve', `transfer:${id}`, { days: t.days })
          await show(ctx, await transferCard(id, ctx))
          return 'Одобрено, дни начислены'
        }
        if (c === 'okd') return void (await ask(ctx, 'tr_days', `Сколько дней начислить по заявке ${transferCode(t)}? (1–${(await settings.get()).transferMaxDays})`, { id: b }, `adm:trc:${b}`))
        if (c === 'rj') {
          return show(ctx, {
            text: `${header('❌', `Отклонить ${transferCode(t)}`)}Выберите причину: пользователь получит её в уведомлении.`,
            kb: [...REJECT_REASONS.map((r, i) => [btn(r.slice(0, 60), `adm:tra:${b}:rjr:${i}`)]), back(`adm:trc:${b}`, 'Отмена')],
          })
        }
        if (c === 'rjr') {
          const reason = REJECT_REASONS[Number(d)] ?? REJECT_REASONS[0]
          await transfer.reject(id, reason, ctx.tgId)
          await staff.audit(ctx.tgId, 'transfer_reject', `transfer:${id}`, { reason })
          await show(ctx, await transferCard(id, ctx))
          return 'Отклонено'
        }
        if (c === 'nl') {
          await transfer.requestLink(id, ctx.tgId)
          await staff.audit(ctx.tgId, 'transfer_need_link', `transfer:${id}`)
          await show(ctx, await transferCard(id, ctx))
          return 'Пользователь уведомлён'
        }
        if (c === 're') {
          const r = await transfer.recheck(id, ctx.tgId)
          await staff.audit(ctx.tgId, 'transfer_recheck', `transfer:${id}`, { verdict: r.verdict })
          await show(ctx, await transferCard(id, ctx))
          return `Перепроверено: ${VERDICT_NAMES[r.verdict]}`
        }
        if (c === 'bl') return show(ctx, confirmView(`Добавить <b>${esc(t.provider ?? '?')}</b> в чёрный список? Новые заявки с этим провайдером будут отклоняться автоматически.`, `adm:tra:${b}:blok`, `adm:trc:${b}`))
        if (c === 'blok') {
          if (!t.provider) return 'Провайдер не определён'
          await prisma.transferProvider.upsert({ where: { domain: t.provider }, create: { domain: t.provider, list: 'black' }, update: { list: 'black' } })
          await staff.audit(ctx.tgId, 'provider_blacklist', `transfer:${id}`, { provider: t.provider })
          await show(ctx, await transferCard(id, ctx))
          return 'Провайдер в чёрном списке'
        }
        if (c === 'log') {
          const full = await prisma.transferRequest.findUniqueOrThrow({ where: { id }, include: { comments: true } })
          const json = JSON.stringify({ ...full, code: transferCode(full) }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
          await tg.sendDocument(ctx.chatId, `${transferCode(full)}.json`, json, `Лог проверки ${transferCode(full)}`, 'application/json')
          await staff.audit(ctx.tgId, 'transfer_export_log', `transfer:${id}`)
          return 'Файл отправлен'
        }
        if (c === 'cm') return void (await ask(ctx, 'tr_comment', `Внутренний комментарий к ${transferCode(t)}:`, { id: b }, `adm:trc:${b}`))
        return
      }
      case 'trs':
        return show(ctx, await transfersAnalytics(b ?? 'month'))
      case 'trx': {
        if (b === 'csv' || b === 'xlsx') {
          const rows = await transfersExportRows()
          if (b === 'csv') await tg.sendDocument(ctx.chatId, `transfers_${Date.now()}.csv`, csv(rows), `Переносы: ${rows.length - 1}`)
          else await tg.sendDocument(ctx.chatId, `transfers_${Date.now()}.xlsx`, xlsx(rows, 'Переносы'), `Переносы: ${rows.length - 1}`, XLSX_MIME)
          await staff.audit(ctx.tgId, 'transfers_export', undefined, { format: b })
          return 'Файл отправлен'
        }
        if (b === 'rcsv' || b === 'rxlsx') {
          const view = await transfersAnalytics(c ?? 'month')
          const plain = view.text.replace(/<[^>]+>/g, '').split('\n').filter(Boolean).map((l) => [l])
          if (b === 'rcsv') await tg.sendDocument(ctx.chatId, `transfers_report_${Date.now()}.csv`, csv(plain), 'Отчёт по переносам')
          else await tg.sendDocument(ctx.chatId, `transfers_report_${Date.now()}.xlsx`, xlsx(plain, 'Отчёт'), 'Отчёт по переносам', XLSX_MIME)
          return 'Файл отправлен'
        }
        return
      }
      case 'trp':
        if (b === 'add') return void (await ask(ctx, 'tr_provider', 'Домен для чёрного списка. Можно добавить название.\nНапример: provider.com Provider', {}, 'adm:trp'))
        return show(ctx, await providersView())
      case 'trpc': {
        const row = await prisma.transferProvider.findUnique({ where: { id: BigInt(b) } })
        if (!row) return 'Не найден'
        await prisma.transferProvider.delete({ where: { id: row.id } })
        await staff.audit(ctx.tgId, 'provider_unblacklist', row.domain)
        await show(ctx, await providersView())
        return `${row.domain} убран из чёрного списка`
      }

      case 'ach':
        return show(ctx, await achievementsMenu())
      case 'achc':
        if (c === 'edit') {
          if (!isOwner) return 'Только для владельца'
          return void (await ask(
            ctx,
            'ach_reward',
            `Новая награда за «${ACH_BY_CODE.get(b)?.title.ru}». Через точку с запятой:\n• days 3 — дни подписки\n• discount 10 — скидка (срок из настроек), discount 15 365 reusable — многоразовая на год\n• device 1 — бонусное устройство, device 1 forever — навсегда`,
            { code: b },
            `adm:achc:${b}`,
          ))
        }
        return show(ctx, await achievementCard(b, ctx.role))
      case 'achr': {
        if (!isOwner) return 'Только для владельца'
        const s = await settings.get()
        const next = { ...s.achievementRewards }
        delete next[b]
        await settings.set('achievementRewards', next)
        await staff.audit(ctx.tgId, 'achievement_reward_reset', b)
        await show(ctx, await achievementCard(b, ctx.role))
        return 'Награда по умолчанию'
      }
      case 'achs': {
        if (!isOwner) return 'Только для владельца'
        if (b === 'days') return void (await ask(ctx, 'ach_days', 'Сколько дней действуют разовые скидки за достижения? (по умолчанию 90)', {}, 'adm:achs'))
        if (b === 'cap') return void (await ask(ctx, 'ach_cap', 'Максимальная суммарная скидка за достижения, %? (по умолчанию 25)', {}, 'adm:achs'))
        if (b === 'launch') return void (await ask(ctx, 'ach_launch', 'Дата запуска сервиса для бейджа «Ранний доступ» (ДД.ММ.ГГГГ):', {}, 'adm:achs'))
        const s = await settings.get()
        return show(ctx, {
          text: `${header('⚙️', 'Настройки достижений')}Срок разовых скидок: <b>${s.achievementDiscountDays} дн</b>\nПотолок скидок на пользователя: <b>${s.achievementMaxDiscount}%</b>\nДата запуска («Ранний доступ»): <b>${s.launchDate}</b>\n\nСкидка «навсегда» доступна только за «Ветерана».`,
          kb: [[btn('Срок скидок', 'adm:achs:days'), btn('Потолок', 'adm:achs:cap')], [btn('Дата запуска', 'adm:achs:launch')], back('adm:ach')],
        })
      }
      case 'acha':
        return show(ctx, await achievementsAnalytics())
      case 'achx': {
        const a = await achievements.analytics()
        const rows = [['Код', 'Бейдж', 'Получили'], ...a.all.map((x) => [x.code, x.title, x.count]), [], ['Дней выдано за 30 дн', a.daysMonth], ['Активных скидок', a.activeDiscounts], ['Бонусных устройств', a.bonusDevices], ['Retention с бейджами, %', a.retentionWith ?? ''], ['Retention без бейджей, %', a.retentionWithout ?? '']]
        if (b === 'xlsx') await tg.sendDocument(ctx.chatId, `achievements_${Date.now()}.xlsx`, xlsx(rows, 'Достижения'), 'Отчёт по наградам', XLSX_MIME)
        else await tg.sendDocument(ctx.chatId, `achievements_${Date.now()}.csv`, csv(rows), 'Отчёт по наградам')
        return 'Файл отправлен'
      }
      case 'achg':
        return void (await ask(ctx, 'ach_grant', b ? `Кому выдать «${ACH_BY_CODE.get(b)?.title.ru}»? Введите tg_id или @username.` : 'Введите tg_id или @username и код бейджа через пробел.\nКоды: ' + ACHIEVEMENTS.map((x) => x.code).join(', '), { code: b ?? null }, b ? `adm:achc:${b}` : 'adm:ach'))

      case 'hw': {
        if (b === 'top') return show(ctx, await halloweenTop())
        if (b === 'search') return void (await ask(ctx, 'hw_search', 'Введите tg_id или @username участника.', {}, 'adm:hw'))
        if (b === 'anom') return show(ctx, await halloweenAnomalies())
        if (b === 'toggle') {
          if (!isOwner) return 'Только владелец'
          const c = await halloween.config()
          await halloween.save({ enabled: !c.enabled })
          await staff.audit(ctx.tgId, 'halloween_toggle', 'event', { enabled: !c.enabled })
          await show(ctx, await halloweenMenu())
          return c.enabled ? 'Событие выключено' : 'Событие включено'
        }
        return show(ctx, await halloweenMenu())
      }
      case 'hwu': {
        const userId = BigInt(b)
        if (c === 'grant') return void (await ask(ctx, 'hw_grant', 'Сколько конфет начислить? (1–50)', { id: b }, `adm:hwu:${b}`))
        if (c === 'revoke') return show(ctx, confirmView('Аннулировать <b>все</b> конфеты участника? Он выбывает из розыгрыша.', `adm:hwu:${b}:revok`, `adm:hwu:${b}`))
        if (c === 'revok') {
          const n = await halloween.adminRevoke(userId, 'Решение администрации', BigInt(ctx.tgId))
          await staff.audit(ctx.tgId, 'halloween_revoke', `user:${userId}`, { tickets: n })
          await show(ctx, await halloweenUser(userId, ctx.role))
          return `Аннулировано конфет: ${n}`
        }
        if (c === 'spin') {
          const n = await halloween.resetSpin(userId)
          await staff.audit(ctx.tgId, 'halloween_spin_reset', `user:${userId}`)
          await show(ctx, await halloweenUser(userId, ctx.role))
          return n ? 'Лимит спина сброшен' : 'Сегодня пользователь ещё не крутил'
        }
        return show(ctx, await halloweenUser(userId, ctx.role))
      }
      case 'hww': {
        if (b === 'toggle') {
          const cfg = await halloween.config()
          await halloween.save({ wheel: { ...cfg.wheel, enabled: !cfg.wheel.enabled } })
          await staff.audit(ctx.tgId, 'halloween_wheel', 'wheel', { enabled: !cfg.wheel.enabled })
          await show(ctx, await halloweenWheel())
          return cfg.wheel.enabled ? 'Колесо выключено' : 'Колесо включено'
        }
        if (b === 'chances')
          return void (await ask(ctx, 'hw_chances', 'Шансы секторов через пробел: конфеты=шанс.\nНапример: <code>0=55 1=25 2=13 3=5 5=2</code>', {}, 'adm:hww'))
        if (b === 'spins') return void (await ask(ctx, 'hw_spins', 'Сколько спинов в сутки? (1–10)', {}, 'adm:hww'))
        if (b === 'minsub') return void (await ask(ctx, 'hw_minsub', 'Минимальный остаток подписки для спина, дней (0–30).', {}, 'adm:hww'))
        if (b === 'cap') return void (await ask(ctx, 'hw_cap', 'Потолок конфет с колеса за всё мероприятие (1–100).', {}, 'adm:hww'))
        return show(ctx, await halloweenWheel())
      }
      case 'hwc': {
        const field = ({ start: 'startAt', until: 'ticketsUntil', draw: 'drawAt' } as Record<string, string>)[b ?? '']
        if (field) return void (await ask(ctx, 'hw_date', 'Введите дату и время по Москве: <code>ДД.ММ ЧЧ:ММ</code>', { field }, 'adm:hwc'))
        return show(ctx, await halloweenDates())
      }
      case 'hwd': {
        if (b === 'intake') {
          const cfg = await halloween.config()
          await halloween.save({ intakeClosed: !cfg.intakeClosed })
          await staff.audit(ctx.tgId, 'halloween_intake', 'draw', { closed: !cfg.intakeClosed })
          await show(ctx, await halloweenDraw())
          return cfg.intakeClosed ? 'Сбор конфет открыт' : 'Сбор конфет закрыт'
        }
        if (b === 'list') return show(ctx, await halloweenWinners())
        if (b === 'run') {
          if (!isOwner) return 'Только владелец'
          const stats = await halloween.stats()
          return show(
            ctx,
            confirmView(
              `Провести розыгрыш по <b>${num(stats.tickets)}</b> конфетам от <b>${num(stats.participants)}</b> участников?\nПобедители сохранятся, но призы начислятся только после публикации.`,
              'adm:hwd:runok',
              'adm:hwd',
            ),
          )
        }
        if (b === 'runok') {
          if (!isOwner) return 'Только владелец'
          const row = await halloween.draw(BigInt(ctx.tgId))
          await staff.audit(ctx.tgId, 'halloween_draw', `draw:${row.id}`, { winners: row.winners.length, tickets: row.totalTickets })
          await show(ctx, await halloweenWinners())
          return `Розыгрыш проведён: победителей ${row.winners.length}`
        }
        if (b === 'pub') {
          if (!isOwner) return 'Только владелец'
          return show(ctx, confirmView('Опубликовать результаты? Список победителей станет виден в приложении. Призы и уведомления останутся за вами.', 'adm:hwd:pubok', 'adm:hwd'))
        }
        if (b === 'pubok') {
          if (!isOwner) return 'Только владелец'
          const draw = await halloween.lastDraw()
          if (!draw) return 'Розыгрыш ещё не проводился'
          const r = await halloween.publish(draw.id, BigInt(ctx.tgId))
          await staff.audit(ctx.tgId, 'halloween_publish', `draw:${draw.id}`, r)
          await show(ctx, await halloweenDraw())
          return r.already ? 'Уже опубликован' : 'Результаты опубликованы'
        }
        if (b === 'prizes') {
          if (!isOwner) return 'Только владелец'
          return show(ctx, confirmView('Начислить подписки всем победителям, которым приз ещё не выдан?', 'adm:hwd:prizesok', 'adm:hwd'))
        }
        if (b === 'prizesok') {
          if (!isOwner) return 'Только владелец'
          const draw = await halloween.lastDraw()
          if (!draw) return 'Розыгрыш ещё не проводился'
          const r = await halloween.grantPrizes(draw.id)
          await staff.audit(ctx.tgId, 'halloween_prizes', `draw:${draw.id}`, r)
          await show(ctx, await halloweenWinners())
          return `Начислено подписок: ${r.granted}${r.manual ? ` · ${r.manual} приз выдаёт администрация` : ''}`
        }
        if (b === 'one') {
          if (!isOwner) return 'Только владелец'
          const draw = await halloween.lastDraw()
          if (!draw) return 'Розыгрыш ещё не проводился'
          const r = await halloween.grantPrizes(draw.id, BigInt(c))
          if (r.manual) await halloween.markGranted(BigInt(c))
          await staff.audit(ctx.tgId, 'halloween_prize', `winner:${c}`, r)
          await show(ctx, await halloweenWinners())
          return r.granted ? 'Подписка начислена' : r.manual ? 'Отмечено: приз выдан вручную' : 'Приз уже был выдан'
        }
        if (b === 'note') {
          const draw = await halloween.lastDraw()
          if (!draw) return 'Розыгрыш ещё не проводился'
          const sent = await halloween.notifyWinners(draw.id, BigInt(c))
          await staff.audit(ctx.tgId, 'halloween_notify', `winner:${c}`, { sent })
          await show(ctx, await halloweenWinners())
          return sent ? 'Уведомление отправлено' : 'Уже уведомлён или бот не может ему написать'
        }
        if (b === 'notify') {
          if (!isOwner) return 'Только владелец'
          return show(ctx, confirmView('Отправить уведомления всем победителям, которым ещё не писали?', 'adm:hwd:notifyok', 'adm:hwd'))
        }
        if (b === 'notifyok') {
          if (!isOwner) return 'Только владелец'
          const draw = await halloween.lastDraw()
          if (!draw) return 'Розыгрыш ещё не проводился'
          const sent = await halloween.notifyWinners(draw.id)
          await staff.audit(ctx.tgId, 'halloween_notify', `draw:${draw.id}`, { sent })
          await show(ctx, await halloweenWinners())
          return `Уведомлений отправлено: ${sent}`
        }
        if (b === 'cons') {
          if (!isOwner) return 'Только владелец'
          const cfg = await halloween.config()
          return show(ctx, confirmView(`Начислить скидку <b>${cfg.consolationPercent}%</b> всем участникам с конфетами, кроме победителей?`, 'adm:hwd:consok', 'adm:hwd'))
        }
        if (b === 'consok') {
          if (!isOwner) return 'Только владелец'
          const draw = await halloween.lastDraw()
          const n = await halloween.consolation(draw?.id)
          await staff.audit(ctx.tgId, 'halloween_consolation', draw ? `draw:${draw.id}` : 'event', { granted: n })
          await show(ctx, await halloweenDraw())
          return `Скидок начислено: ${n}`
        }
        if (b === 'rep') {
          const next = await halloween.replaceWinner(BigInt(c))
          await staff.audit(ctx.tgId, 'halloween_replace', `winner:${c}`)
          await show(ctx, await halloweenWinners())
          return next ? `Новый победитель: ${next.user.username ? '@' + next.user.username : next.user.tgId}` : 'Некем заменить: свободных конфет нет'
        }
        if (b === 'w') return show(ctx, await halloweenWinner(BigInt(c)))
        if (b === 'wadd') {
          if (!isOwner) return 'Только владелец'
          const cfg = await halloween.config()
          const places = [...new Set(cfg.prizes.map((p) => p.place))].sort((x, y) => x - y)
          return void (await ask(ctx, 'hw_win_add', `Кого и на какое место? Отправьте tg_id или @username и место через пробел, например <code>@ivan 1</code>.\nМеста с призами: ${places.join(', ') || 'нет, сначала добавьте призы'}`, {}, 'adm:hwd:list'))
        }
        if (b === 'wp') {
          if (!isOwner) return 'Только владелец'
          return void (await ask(ctx, 'hw_win_place', 'Новое место (число). Приз сменится на приз этого места.', { id: c }, `adm:hwd:w:${c}`))
        }
        if (b === 'wdel') {
          if (!isOwner) return 'Только владелец'
          return show(ctx, confirmView('Убрать победителя из списка без замены? Если приз уже выдан, сам приз это не отменит.', `adm:hwd:wdelok:${c}`, `adm:hwd:w:${c}`))
        }
        if (b === 'wdelok') {
          if (!isOwner) return 'Только владелец'
          await halloween.removeWinner(BigInt(c))
          await staff.audit(ctx.tgId, 'halloween_winner_remove', `winner:${c}`)
          await show(ctx, await halloweenWinners())
          return 'Убран из победителей'
        }
        return show(ctx, await halloweenDraw())
      }
      case 'hwp': {
        if (!b) return show(ctx, await halloweenPrizes())
        if (!isOwner) return 'Только владелец'
        if (b === 'e') return show(ctx, await halloweenPrize(c))
        if (b === 'add') {
          return void (await ask(
            ctx,
            'hw_prize_add',
            'Новый приз одной строкой: <code>место | название | количество | награда</code>\n' +
              'Награда: <code>pro 365</code> (Премиум на 365 дней), <code>start 30</code> (Старт на 30 дней) или <code>-</code>, если приз выдаёте вы сами.\n' +
              'Например: <code>1 | AirPods 4 | 1 | -</code> или <code>3 | 3 месяца Премиум | 5 | pro 92</code>',
            {},
            'adm:hwp',
          ))
        }
        if (b === 't') return void (await ask(ctx, 'hw_prize_title', 'Новое название приза:', { code: c }, `adm:hwp:e:${c}`))
        if (b === 'p') return void (await ask(ctx, 'hw_prize_place', 'Место (1 — главный приз):', { code: c }, `adm:hwp:e:${c}`))
        if (b === 'n') return void (await ask(ctx, 'hw_prize_count', 'Сколько таких призов (сколько победителей на этом месте)?', { code: c }, `adm:hwp:e:${c}`))
        if (b === 'r') return void (await ask(ctx, 'hw_prize_reward', 'Награда: <code>pro 365</code>, <code>start 30</code> или <code>-</code> (выдаёте сами).', { code: c }, `adm:hwp:e:${c}`))
        if (b === 'del') return show(ctx, confirmView('Удалить приз? Уже выбранные победители останутся в списке.', `adm:hwp:delok:${c}`, `adm:hwp:e:${c}`))
        if (b === 'delok') {
          await halloween.removePrize(c)
          await staff.audit(ctx.tgId, 'halloween_prize_remove', c)
          await show(ctx, await halloweenPrizes())
          return 'Приз удалён'
        }
        return show(ctx, await halloweenPrizes())
      }
      case 'hwx': {
        if (b === 'draw') {
          const draw = await halloween.lastDraw()
          if (!draw) return 'Розыгрыш ещё не проводился'
          const rows = [
            ['Розыгрыш', dt(draw.createdAt), 'зерно', draw.seed],
            ['Конфет', draw.totalTickets, 'Участников', draw.participants],
            [],
            ['Место', 'Приз', 'tg_id', 'username', 'Конфет', 'Выигравшая конфета', 'Статус'],
            ...draw.winners.map((w) => [w.place, w.prizeTitle, String(w.user.tgId), w.user.username ?? '', w.tickets, String(w.ticketId), w.replacedAt ? 'заменён' : w.grantedAt ? 'приз выдан' : 'ожидает']),
          ]
          if (c === 'xlsx') await tg.sendDocument(ctx.chatId, `halloween_draw_${Date.now()}.xlsx`, xlsx(rows, 'Розыгрыш'), 'Протокол розыгрыша', XLSX_MIME)
          else await tg.sendDocument(ctx.chatId, `halloween_draw_${Date.now()}.csv`, csv(rows), 'Протокол розыгрыша')
          return 'Файл отправлен'
        }
        const tickets = await halloween.exportTickets()
        const rows = [
          ['ID конфеты', 'tg_id', 'username', 'Источник', 'Друг', 'Выдана', 'Аннулирована', 'Причина'],
          ...tickets.map((t) => [t.id, t.tgId, t.username, t.source, t.friend, dt(t.createdAt), t.revoked, t.reason]),
        ]
        if (c === 'xlsx') await tg.sendDocument(ctx.chatId, `halloween_tickets_${Date.now()}.xlsx`, xlsx(rows, 'Конфеты'), 'Все конфеты мероприятия', XLSX_MIME)
        else await tg.sendDocument(ctx.chatId, `halloween_tickets_${Date.now()}.csv`, csv(rows), 'Все конфеты мероприятия')
        return 'Файл отправлен'
      }

      case 'st':
        return show(ctx, await statusView())
      case 'sth': {
        const list = await status.history(20)
        // Удаление: по кнопке на каждый инцидент, по три в ряд.
        const del = list.map((i) => btn(`🗑 #${i.id}`, `adm:std:${i.id}`))
        return show(ctx, {
          text:
            header('🕓', 'История инцидентов') +
            (list.map((i) => `${i.status === 'open' ? (i.severity === 'major' ? '🔴' : '🟠') : '⚪️'} #${i.id} ${esc(i.title)}${i.auto ? ' · авто' : ''}\n  ${dt(new Date(i.startedAt))}${i.resolvedAt ? ` — ${dt(new Date(i.resolvedAt))}` : ' — продолжается'}`).join('\n') || '<i>пусто</i>') +
            (list.length ? '\n\n<i>🗑 удаляет инцидент из статуса и истории насовсем.</i>' : ''),
          kb: [...Array.from({ length: Math.ceil(del.length / 3) }, (_, r) => del.slice(r * 3, r * 3 + 3)), back('adm:st')],
        })
      }
      case 'std': {
        const inc = await prisma.incident.findUnique({ where: { id: BigInt(b) } })
        if (!inc) return 'Не найден'
        return show(ctx, confirmView(`Удалить инцидент #${b} «${esc(inc.title)}»? Он пропадёт со страницы статуса и из истории. Отменить нельзя.`, `adm:stdok:${b}`, 'adm:sth'))
      }
      case 'stdok': {
        const inc = await prisma.incident.findUnique({ where: { id: BigInt(b) } })
        if (!inc) return 'Уже удалён'
        await status.remove(inc.id)
        await staff.audit(ctx.tgId, 'incident_delete', `incident:${b}`, { title: inc.title, status: inc.status })
        await show(ctx, await statusView())
        return 'Инцидент удалён'
      }
      case 'stn':
        return void (await ask(ctx, 'st_title', `${b === 'major' ? '🔴 Крупный сбой' : '🟠 Проблема'}. Короткий заголовок, например «Нидерланды: медленная скорость»:`, { severity: b === 'major' ? 'major' : 'minor' }, 'adm:st'))
      case 'stx': {
        const inc = await status.resolve(BigInt(b))
        await staff.audit(ctx.tgId, 'incident_resolve', `incident:${b}`)
        if (inc.notifiedAll) await broadcastAll(`🟢 <b>Работа восстановлена</b>\n${esc(inc.title)}: всё снова работает. Спасибо за терпение!`, ctx.tgId)
        await show(ctx, await statusView())
        return 'Инцидент закрыт'
      }
      case 'stp': {
        const inc = await prisma.incident.findUnique({ where: { id: BigInt(b) } })
        if (!inc) return 'Не найден'
        const count = await prisma.user.count({ where: { botStarted: true, banned: false } })
        return show(ctx, confirmView(`Отправить всем (${count} чел.) уведомление о сбое «${esc(inc.title)}»?`, `adm:stpok:${b}`, 'adm:st'))
      }
      case 'stpok': {
        const inc = await prisma.incident.update({ where: { id: BigInt(b) }, data: { notifiedAll: true } })
        await broadcastAll(`${inc.severity === 'major' ? '🔴' : '🟠'} <b>${esc(inc.title)}</b>\n${esc(inc.text ?? 'Уже разбираемся.')}${inc.eta ? `\nОжидаемое восстановление: ${dt(inc.eta)} МСК` : ''}`, ctx.tgId)
        await staff.audit(ctx.tgId, 'incident_notify_all', `incident:${b}`)
        await show(ctx, await statusView())
        return 'Рассылка запущена'
      }

      case 'ud':
        return show(ctx, await userDevices(BigInt(b), ctx.role))
      case 'udh':
        return show(ctx, await deviceHistory(BigInt(b)))
      case 'udx': {
        if (ctx.role === 'support') return 'Для поддержки доступен только просмотр'
        const dev = await prisma.device.findUnique({ where: { id: BigInt(b) } })
        if (!dev) return 'Устройство не найдено'
        await prisma.device.delete({ where: { id: dev.id } })
        await prisma.deviceEvent.create({ data: { userId: dev.userId, hwid: dev.hwid, label: dev.label, event: 'admin_unbound', byTgId: BigInt(ctx.tgId) } })
        await staff.audit(ctx.tgId, 'device_unbind', `user:${dev.userId}`, { device: dev.label })
        await show(ctx, await userDevices(dev.userId, ctx.role))
        return 'Устройство отвязано'
      }
      case 'ub':
        return show(ctx, await userBadges(BigInt(b), ctx.role))
      case 'ubg': {
        if (ctx.role === 'support') return 'Для поддержки доступен только просмотр'
        const u = await prisma.user.findUnique({ where: { id: BigInt(b) } })
        if (!u) return 'Пользователь не найден'
        const ok = await achievements.unlock(u, c, { byTgId: ctx.tgId })
        await staff.audit(ctx.tgId, 'achievement_grant', `user:${u.id}`, { code: c })
        await show(ctx, await userBadges(u.id, ctx.role))
        return ok ? 'Бейдж выдан, награда начислена' : 'Бейдж уже есть'
      }
    }
  }

  // ── Пошаговый ввод ────────────────────────────────────────────────────────

  /** «pro 365» / «премиум 365» / «start 30» / «старт 30» → подписка; «-» / «нет» → физический приз; иначе undefined. */
  function parseReward(raw: string): HalloweenPrize['reward'] | undefined {
    const t = raw.trim().toLowerCase()
    if (!t || t === '-' || t === 'нет' || t === 'none') return null
    const m = /^(pro|премиум|start|старт)\s+(\d{1,4})$/.exec(t)
    if (!m) return undefined
    const days = Number(m[2])
    if (days < 1 || days > 3650) return undefined
    return { plan: m[1] === 'pro' || m[1] === 'премиум' ? 'pro' : 'start', days }
  }

  async function findUser(query: string) {
    const q = query.trim().replace(/^@/, '')
    if (/^\d+$/.test(q)) return prisma.user.findFirst({ where: { OR: [{ tgId: BigInt(q) }, { id: BigInt(q) }] } })
    return prisma.user.findFirst({ where: { username: { equals: q, mode: 'insensitive' } } })
  }

  async function onText(ctx: Ctx, state: Fsm, text: string): Promise<boolean> {
    const v = text.trim()
    const data = state.data
    const done = () => fsm.delete(ctx.tgId)
    const retry = (msg: string) => tg.send(ctx.chatId, `⚠️ ${msg}`, { keyboard: [[btn('Отмена', 'adm:cancel')]] })
    const fresh = { ...ctx, messageId: undefined }
    const n = Number(v.replace(',', '.'))

    switch (state.kind) {
      case 'tr_search': {
        done()
        const byCode = parseTransferCode(v)
        const or: Prisma.TransferRequestWhereInput[] = [{ link: { contains: v } }, { provider: { contains: v.toLowerCase() } }]
        if (byCode) or.push({ id: byCode })
        const u = await findUser(v)
        if (u) or.push({ userId: u.id })
        const rows = await prisma.transferRequest.findMany({ where: { OR: or }, include: { user: true }, orderBy: { createdAt: 'desc' }, take: 10 })
        if (rows.length === 1) {
          await show(fresh, await transferCard(rows[0].id, ctx))
          return true
        }
        await tg.send(ctx.chatId, `${header('🔎', 'Поиск переносов', esc(v))}${rows.length ? '' : '<i>Ничего не найдено.</i>'}`, {
          keyboard: [...rows.map((t) => [btn(`${ST_ICON[t.status]} ${transferCode(t)} · ${t.user.username ? '@' + t.user.username : t.user.tgId}`, `adm:trc:${t.id}`)]), back('adm:tr')],
        })
        return true
      }
      case 'tr_days': {
        const max = (await settings.get()).transferMaxDays
        if (!Number.isInteger(n) || n < 1 || n > max) {
          await retry(`Целое число от 1 до ${max}`)
          return true
        }
        const id = BigInt(String(data.id))
        done()
        await transfer.approve(id, n, ctx.tgId)
        await staff.audit(ctx.tgId, 'transfer_approve', `transfer:${id}`, { days: n })
        await show(fresh, await transferCard(id, ctx))
        return true
      }
      case 'tr_comment': {
        const id = BigInt(String(data.id))
        done()
        await prisma.transferComment.create({ data: { transferId: id, authorTgId: BigInt(ctx.tgId), text: v.slice(0, 1000) } })
        await staff.audit(ctx.tgId, 'transfer_comment', `transfer:${id}`)
        await show(fresh, await transferCard(id, ctx))
        return true
      }
      case 'tr_provider': {
        const [domain, ...name] = v.split(/\s+/)
        if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
          await retry('Формат: provider.com [название]')
          return true
        }
        done()
        await prisma.transferProvider.upsert({
          where: { domain: domain.toLowerCase() },
          create: { domain: domain.toLowerCase(), list: 'black', name: name.join(' ') || null },
          update: { list: 'black', name: name.join(' ') || undefined },
        })
        await staff.audit(ctx.tgId, 'provider_blacklist', domain)
        await show(fresh, await providersView())
        return true
      }
      case 'ach_reward': {
        const code = String(data.code)
        const parsed = parseRewards(v, code)
        if (typeof parsed === 'string') {
          await retry(parsed)
          return true
        }
        done()
        const s = await settings.get()
        await settings.set('achievementRewards', { ...s.achievementRewards, [code]: parsed })
        await staff.audit(ctx.tgId, 'achievement_reward', code, { rewards: parsed })
        await show(fresh, await achievementCard(code, ctx.role))
        return true
      }
      case 'ach_days':
      case 'ach_cap': {
        const ok = state.kind === 'ach_days' ? Number.isInteger(n) && n >= 1 && n <= 365 : Number.isInteger(n) && n >= 0 && n <= 50
        if (!ok) {
          await retry(state.kind === 'ach_days' ? 'От 1 до 365 дней' : 'От 0 до 50%')
          return true
        }
        done()
        await settings.set(state.kind === 'ach_days' ? 'achievementDiscountDays' : 'achievementMaxDiscount', n)
        await staff.audit(ctx.tgId, state.kind, undefined, { value: n })
        await onCallback(fresh, ['achs'])
        return true
      }
      case 'ach_launch': {
        const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v)
        if (!m) {
          await retry('Формат ДД.ММ.ГГГГ')
          return true
        }
        done()
        await settings.set('launchDate', `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`)
        await staff.audit(ctx.tgId, 'launch_date', undefined, { value: v })
        await onCallback(fresh, ['achs'])
        return true
      }
      case 'ach_grant': {
        const parts = v.split(/\s+/)
        const code = data.code ? String(data.code) : parts[1]
        const u = await findUser(parts[0] ?? '')
        if (!u) {
          await retry('Пользователь не найден')
          return true
        }
        if (!code || !ACH_BY_CODE.has(code)) {
          await retry(`Неизвестный код. Коды: ${ACHIEVEMENTS.map((x) => x.code).join(', ')}`)
          return true
        }
        done()
        const ok = await achievements.unlock(u, code, { byTgId: ctx.tgId })
        await staff.audit(ctx.tgId, 'achievement_grant', `user:${u.id}`, { code })
        await tg.send(ctx.chatId, ok ? `🎖 «${ACH_BY_CODE.get(code)!.title.ru}» выдан ${who(u)}, награда начислена.` : 'У пользователя уже есть этот бейдж.', { keyboard: [back(`adm:ub:${u.id}`, '‹ Бейджи пользователя')] })
        return true
      }
      case 'hw_search': {
        done()
        const u = await findUser(v)
        if (!u) {
          await tg.send(ctx.chatId, '⚠️ Пользователь не найден', { keyboard: [back('adm:hw')] })
          return true
        }
        await show(fresh, await halloweenUser(u.id, ctx.role))
        return true
      }
      case 'hw_prize_add': {
        const parts = v.split('|').map((x) => x.trim())
        const place = Number(parts[0])
        const count = Number(parts[2] ?? 1)
        const reward = parseReward(parts[3] ?? '-')
        if (parts.length < 2 || !Number.isInteger(place) || place < 1 || place > 50 || !parts[1] || !Number.isInteger(count) || count < 1 || count > 100 || reward === undefined) {
          await retry('Формат: место | название | количество | награда. Например: 1 | AirPods 4 | 1 | -')
          return true
        }
        done()
        const prize = await halloween.addPrize({ place, title: parts[1].slice(0, 60), count, reward })
        await staff.audit(ctx.tgId, 'halloween_prize_add', prize.code, { place, count, reward })
        await show(fresh, await halloweenPrizes())
        return true
      }
      case 'hw_prize_title':
      case 'hw_prize_place':
      case 'hw_prize_count':
      case 'hw_prize_reward': {
        const code = String(data.code)
        let patch: Partial<Omit<HalloweenPrize, 'code'>>
        if (state.kind === 'hw_prize_title') {
          if (!v || v.length > 60) { await retry('Название до 60 символов'); return true }
          patch = { title: v }
        } else if (state.kind === 'hw_prize_place') {
          if (!Number.isInteger(n) || n < 1 || n > 50) { await retry('Целое число от 1 до 50'); return true }
          patch = { place: n }
        } else if (state.kind === 'hw_prize_count') {
          if (!Number.isInteger(n) || n < 1 || n > 100) { await retry('Целое число от 1 до 100'); return true }
          patch = { count: n }
        } else {
          const reward = parseReward(v)
          if (reward === undefined) { await retry('pro 365, start 30 или -'); return true }
          patch = { reward }
        }
        done()
        await halloween.updatePrize(code, patch)
        await staff.audit(ctx.tgId, 'halloween_prize_edit', code, patch)
        await show(fresh, await halloweenPrize(code))
        return true
      }
      case 'hw_win_add': {
        const [q, placeRaw] = v.split(/\s+/)
        const place = Number(placeRaw)
        const u = q ? await findUser(q) : null
        if (!u || !Number.isInteger(place) || place < 1) {
          await retry(u ? 'Укажите место числом, например @ivan 1' : 'Пользователь не найден. Формат: @username 1 или 123456789 1')
          return true
        }
        try {
          const w = await halloween.addWinner(u.id, place, BigInt(ctx.tgId))
          done()
          await staff.audit(ctx.tgId, 'halloween_winner_add', `user:${u.id}`, { place })
          await show(fresh, await halloweenWinner(w.id))
        } catch (err) {
          await retry((err as Error).message)
        }
        return true
      }
      case 'hw_win_place': {
        if (!Number.isInteger(n) || n < 1) { await retry('Место числом'); return true }
        const id = BigInt(String(data.id))
        try {
          await halloween.setWinnerPlace(id, n)
          done()
          await staff.audit(ctx.tgId, 'halloween_winner_place', `winner:${id}`, { place: n })
          await show(fresh, await halloweenWinner(id))
        } catch (err) {
          await retry((err as Error).message)
        }
        return true
      }
      case 'hw_grant': {
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          await retry('Целое число от 1 до 50')
          return true
        }
        const userId = BigInt(String(data.id))
        done()
        const given = await halloween.adminGrant(userId, n, BigInt(ctx.tgId))
        await staff.audit(ctx.tgId, 'halloween_grant', `user:${userId}`, { tickets: given })
        await tg.send(ctx.chatId, given === n ? `🍬 Начислено конфет: ${given}` : `🍬 Начислено ${given} из ${n}: сработал лимит конфет на аккаунт.`)
        await show(fresh, await halloweenUser(userId, ctx.role))
        return true
      }
      case 'hw_chances': {
        const sectors: { tickets: number; chance: number }[] = []
        for (const part of v.split(/[\s,;]+/).filter(Boolean)) {
          const m = /^(\d+)=(\d+(?:\.\d+)?)$/.exec(part)
          if (!m) {
            await retry(`Не понял «${part}». Формат: 0=55 1=25 2=13 3=5 5=2`)
            return true
          }
          sectors.push({ tickets: Number(m[1]), chance: Number(m[2]) })
        }
        if (sectors.length < 2) {
          await retry('Нужно хотя бы два сектора')
          return true
        }
        const sum = sectors.reduce((a, x) => a + x.chance, 0)
        if (Math.round(sum) !== 100) {
          await retry(`Сумма шансов должна быть 100%, сейчас ${sum}%`)
          return true
        }
        done()
        const cfg = await halloween.config()
        await halloween.save({ wheel: { ...cfg.wheel, sectors } })
        await staff.audit(ctx.tgId, 'halloween_wheel', 'sectors', { sectors })
        await show(fresh, await halloweenWheel())
        return true
      }
      case 'hw_spins':
      case 'hw_minsub':
      case 'hw_cap': {
        const max = state.kind === 'hw_spins' ? 10 : state.kind === 'hw_minsub' ? 30 : 100
        const min = state.kind === 'hw_minsub' ? 0 : 1
        if (!Number.isInteger(n) || n < min || n > max) {
          await retry(`Целое число от ${min} до ${max}`)
          return true
        }
        done()
        const cfg = await halloween.config()
        if (state.kind === 'hw_cap') await halloween.save({ maxWheelTickets: n })
        else await halloween.save({ wheel: { ...cfg.wheel, ...(state.kind === 'hw_spins' ? { spinsPerDay: n } : { minSubDays: n }) } })
        await staff.audit(ctx.tgId, 'halloween_wheel', state.kind, { value: n })
        await show(fresh, await halloweenWheel())
        return true
      }
      case 'hw_date': {
        const date = parseMsk(v)
        if (!date) {
          await retry('Формат: ДД.ММ ЧЧ:ММ, например 24.10 00:00')
          return true
        }
        done()
        const field = String(data.field) as 'startAt' | 'ticketsUntil' | 'drawAt'
        await halloween.save({ [field]: date.toISOString() })
        await staff.audit(ctx.tgId, 'halloween_date', field, { at: date.toISOString() })
        await show(fresh, await halloweenDates())
        return true
      }
      case 'st_title': {
        if (v.length < 3 || v.length > 120) {
          await retry('Заголовок от 3 до 120 символов')
          return true
        }
        state.kind = 'st_text'
        data.title = v
        await tg.send(ctx.chatId, 'Описание для пользователей и время восстановления в последней строке (ДД.ММ ЧЧ:ММ МСК), или «-», чтобы пропустить.\nНапример:\nПроблемы у хостинга, переключили трафик.\n01.10 18:30', { keyboard: [[btn('Отмена', 'adm:cancel')]] })
        return true
      }
      case 'st_text': {
        const linesIn = v === '-' ? [] : v.split('\n')
        const eta = linesIn.length ? parseMsk(linesIn[linesIn.length - 1]) : null
        const body = (eta ? linesIn.slice(0, -1) : linesIn).join('\n').trim() || null
        done()
        const inc = await status.publish({ title: String(data.title), text: body, severity: data.severity === 'major' ? 'major' : 'minor', eta, byTgId: ctx.tgId })
        await staff.audit(ctx.tgId, 'incident_publish', `incident:${inc.id}`, { severity: inc.severity })
        await show(fresh, await statusView())
        if (inc.severity === 'major') await show(fresh, confirmView(`Крупный сбой опубликован. Отправить уведомление всем пользователям?`, `adm:stpok:${inc.id}`, 'adm:st'))
        return true
      }
    }
    return false
  }

  return {
    homeItems: [
      ['tr', '🔁 Переносы', 'adm:tr'],
      ['ach', '🏆 Достижения', 'adm:ach'],
      ['st', '📶 Статус', 'adm:st'],
      ['hw', '🎃 Хэллоуин', 'adm:hw'],
      ...(reviewsAdmin ? [reviewsAdmin.homeItem] : []),
    ] as [string, string, string][],
    handles: (a: string) => a in SECTIONS,
    section: (a: string) => SECTIONS[a] ?? 'owner',
    onCallback,
    onText,
    userRows: (userId: bigint, _role: StaffRole): InlineKeyboard => [[btn('📱 Устройства', `adm:ud:${userId}`), btn('🏆 Бейджи', `adm:ub:${userId}`), btn('🍬 Конфеты', `adm:hwu:${userId}`)]],
  }
}

export type AdminFeatures = ReturnType<typeof createAdminFeatures>
