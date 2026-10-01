import crypto from 'node:crypto'
import type { Prisma, PrismaClient, ProviderList, TransferRequest, User } from '@prisma/client'
import { SHORTENERS, allowLocal, checkDomain, fetchViaPool, readLimited, resolvePublic, tcpConnect } from '@/lib/net'
import { decodeList, parseUserInfo } from '@/routes/subscription'
import type { AchievementService } from './achievements'
import type { Notifier } from './billing'
import type { SettingsService } from './settings'
import type { VpnService } from './vpn'

const DAY = 24 * 60 * 60 * 1000
const UA = 'v2rayNG/1.8.0'
const SKIPPED = 'пропущено: ссылка не прошла проверку формата'

export type LinkType = 'subscription' | 'vless' | 'vmess' | 'trojan' | 'ss'
export type CheckStatus = 'ok' | 'fail' | 'warn' | 'skip'

export interface TransferCheck {
  n: number
  key: string
  title: string
  status: CheckStatus
  detail: string
}

interface ParsedLink {
  type: LinkType
  host: string
  port: number | null
  /** Ссылка без названия (#…) и мусора — по ней считается SHA-256 для поиска дубликатов. */
  normalized: string
  url?: URL
}

/** Названия пунктов чек-листа (ТЗ 1.2). */
export const CHECK_TITLES: Record<string, string> = {
  format: 'Формат ссылки',
  type: 'Тип ссылки',
  unique: 'Уникальность ссылки',
  provider: 'Провайдер в белом списке',
  http: 'HTTP-запрос успешен',
  content: 'Конфиги получены',
  meta: 'Метаданные извлечены',
  expiry: 'Срок действия корректен',
  age: 'Возраст аккаунта LYNK',
  paid: 'Нет активной платной подписки LYNK',
  once: 'Не использовал перенос ранее',
  device: 'Устройство привязано',
  ip: 'IP-проверка',
  anomaly: 'Аномалии',
}
const ORDER = ['format', 'type', 'unique', 'provider', 'http', 'content', 'meta', 'expiry', 'age', 'paid', 'once', 'device', 'ip', 'anomaly']

export const REJECT_REASONS = [
  'Устройство отвязано, подписка не активна у провайдера',
  'Срок подписки истёк или меньше 7 дней',
  'Ссылка не отвечает',
  'Та же ссылка подавалась другим пользователем',
  'Аккаунт LYNK младше 3 дней',
  'Есть активная платная подписка LYNK',
  'Провайдер в чёрном списке',
  'Ссылка ведёт на личный кабинет, а не на конфигурацию',
  'Подозрение на мошенничество',
]

const b64decode = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

/** Разбор ссылки: subscription URL, vless://, vmess://, trojan://, ss:// (ТЗ 1.3). */
export function parseLink(raw: string): { ok: true; link: ParsedLink } | { ok: false; key: 'format' | 'type'; error: string } {
  const text = raw.trim()
  if (!text) return { ok: false, key: 'format', error: 'пустая ссылка' }
  if (text.length > 4096 || /\s/.test(text)) return { ok: false, key: 'format', error: 'ссылка содержит пробелы или слишком длинная' }
  const m = /^([a-z0-9+.-]+):\/\//i.exec(text)
  if (!m) return { ok: false, key: 'format', error: 'нет схемы (https://, vless:// …)' }
  const scheme = m[1].toLowerCase()
  const noName = text.split('#')[0]
  try {
    if (scheme === 'http' || scheme === 'https') {
      const url = new URL(noName)
      if (url.username || url.password) return { ok: false, key: 'format', error: 'логин и пароль в ссылке не принимаем' }
      const port = url.port ? Number(url.port) : null
      const host = url.hostname.toLowerCase()
      return { ok: true, link: { type: 'subscription', host, port, url, normalized: `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${url.pathname}${url.search}` } }
    }
    if (scheme === 'vless' || scheme === 'trojan') {
      const url = new URL(noName)
      const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
      if (!host || !url.username || !url.port) return { ok: false, key: 'format', error: 'нет сервера, порта или ключа' }
      return { ok: true, link: { type: scheme, host, port: Number(url.port), normalized: `${scheme}://${decodeURIComponent(url.username)}@${host}:${url.port}` } }
    }
    if (scheme === 'vmess') {
      const cfg = JSON.parse(b64decode(noName.slice('vmess://'.length))) as { add?: string; port?: string | number; id?: string }
      if (!cfg.add || !cfg.port || !cfg.id) return { ok: false, key: 'format', error: 'в vmess-конфиге нет сервера, порта или id' }
      return { ok: true, link: { type: 'vmess', host: String(cfg.add).toLowerCase(), port: Number(cfg.port), normalized: `vmess://${cfg.id}@${String(cfg.add).toLowerCase()}:${cfg.port}` } }
    }
    if (scheme === 'ss') {
      let body = noName.slice('ss://'.length).split('?')[0].replace(/\/$/, '')
      if (!body.includes('@')) body = b64decode(body) // старый формат: base64(method:pass@host:port)
      const at = body.lastIndexOf('@')
      const userinfo = body.slice(0, at)
      const hostPort = body.slice(at + 1)
      const cred = userinfo.includes(':') ? decodeURIComponent(userinfo) : b64decode(decodeURIComponent(userinfo))
      const hp = /^\[?([^\]]+?)\]?:(\d+)$/.exec(hostPort)
      if (at < 0 || !hp || !cred.includes(':')) return { ok: false, key: 'format', error: 'не удалось разобрать ss-ссылку' }
      return { ok: true, link: { type: 'ss', host: hp[1].toLowerCase(), port: Number(hp[2]), normalized: `ss://${cred}@${hp[1].toLowerCase()}:${hp[2]}` } }
    }
  } catch {
    return { ok: false, key: 'format', error: 'невалидная ссылка' }
  }
  return { ok: false, key: 'type', error: `схема ${scheme}:// не поддерживается` }
}

export const linkHash = (normalized: string) => crypto.createHash('sha256').update(normalized).digest('hex')

/** Регистрируемый домен для списков провайдеров: sub.provider.com → provider.com. */
export function baseDomain(host: string) {
  const labels = host.split('.')
  if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1])) return host
  const sld = labels[labels.length - 2]
  // Зоны вида co.uk / com.ru: берём три последних уровня.
  return ['co', 'com', 'net', 'org', 'gov', 'ac', 'edu'].includes(sld) && labels.length >= 3 ? labels.slice(-3).join('.') : labels.slice(-2).join('.')
}

/** ID заявки для поиска и трекинга: TRF-2025-10-01-00042. */
export function transferCode(t: { id: bigint; createdAt: Date }) {
  const d = new Date(t.createdAt.getTime() + 3 * 3600_000)
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return `TRF-${ymd}-${String(t.id).padStart(5, '0')}`
}

export function parseTransferCode(q: string): bigint | null {
  const m = /^TRF-\d{4}-\d{2}-\d{2}-0*(\d+)$/i.exec(q.trim())
  return m ? BigInt(m[1]) : null
}

export interface CheckContext {
  ip: string | null
  userAgent: string | null
  /** При перепроверке своя заявка не считается ни дубликатом, ни «уже на рассмотрении». */
  excludeId?: bigint
}

export function createTransferService(deps: {
  prisma: PrismaClient
  settings: SettingsService
  vpn: VpnService
  achievements: AchievementService
  notify: Notifier
  notifyStaff: (text: string, keyboard?: { text: string; callback_data: string }[][]) => Promise<void>
}) {
  const { prisma, settings, vpn, achievements, notify, notifyStaff } = deps

  /**
   * 14 проверок (ТЗ 1.2, 1.4). Ничего не пишет в БД — результат нужен и для
   * «Проверить ссылку», и для заявки, и для ручной перепроверки админом.
   */
  async function runChecks(user: User, raw: string, ctx: CheckContext) {
    const s = await settings.get()
    const started = Date.now()
    const log: Record<string, unknown>[] = []
    const step = (name: string, data: Record<string, unknown> = {}) => log.push({ at: new Date().toISOString(), ms: Date.now() - started, step: name, ...data })
    const res = new Map<string, TransferCheck>()
    const set = (key: string, status: CheckStatus, detail: string) => res.set(key, { n: ORDER.indexOf(key) + 1, key, title: CHECK_TITLES[key], status, detail })

    const out = {
      parsed: null as ParsedLink | null,
      hash: null as string | null,
      provider: null as string | null,
      providerList: null as ProviderList | null,
      httpStatus: null as number | null,
      responseMs: null as number | null,
      bodyBytes: null as number | null,
      configsCount: null as number | null,
      userInfo: null as string | null,
      expireAt: null as Date | null,
      days: null as number | null,
      suggestedDays: null as number | null,
      accountAgeDays: Math.floor((Date.now() - user.createdAt.getTime()) / DAY),
      hadPaidSub: false,
    }

    // ── Этап 1: парсинг и валидация ──
    step('parse', { length: raw.length })
    const parsed = parseLink(raw)
    if (!parsed.ok) {
      set(parsed.key, 'fail', parsed.error)
      if (parsed.key === 'type') set('format', 'ok', 'URL разобран')
    } else {
      const link = parsed.link
      out.parsed = link
      set('format', 'ok', `${link.host}${link.port ? `:${link.port}` : ''}`)
      set('type', 'ok', link.type === 'subscription' ? 'Subscription URL' : `${link.type}://`)
      if (link.type === 'subscription') {
        const domainErr = checkDomain(link.host)
        if (domainErr && !allowLocal()) set('format', 'fail', domainErr)
        else if (SHORTENERS.has(link.host)) set('format', 'fail', 'сокращённые ссылки не принимаем, пришлите исходную')
      }
      out.hash = linkHash(link.normalized)
      out.provider = link.type === 'subscription' ? baseDomain(link.host) : link.host
    }
    step('parsed', { type: out.parsed?.type ?? null, provider: out.provider, hash: out.hash })

    const formatOk = res.get('format')?.status === 'ok' && res.get('type')?.status === 'ok'

    // Уникальность: SHA-256 не подавался другим пользователем.
    if (formatOk && out.hash) {
      const dup = await prisma.transferRequest.findFirst({
        where: { linkHash: out.hash, userId: { not: user.id }, ...(ctx.excludeId ? { id: { not: ctx.excludeId } } : {}) },
        orderBy: { createdAt: 'asc' },
      })
      set('unique', dup ? 'fail' : 'ok', dup ? `уже подавалась в заявке ${transferCode(dup)}` : 'не подавалась')
    } else set('unique', 'skip', SKIPPED)

    // Провайдер: белый / серый / чёрный список.
    if (formatOk && out.provider) {
      const row = await prisma.transferProvider.findFirst({ where: { domain: { in: [out.provider, out.parsed!.host] } } })
      out.providerList = row?.list ?? null
      if (!row) set('provider', 'warn', `${out.provider} нет в базе: решение за модератором`)
      else if (row.list === 'white') set('provider', 'ok', `белый список (${row.domain})`)
      else if (row.list === 'gray') set('provider', 'warn', `серый список (${row.domain})`)
      else set('provider', 'fail', `чёрный список (${row.domain})`)
    } else set('provider', 'skip', SKIPPED)

    // ── Этап 2–3: запрос к провайдеру и метаданные ──
    if (formatOk && out.parsed?.type === 'subscription') {
      const url = out.parsed.url!
      try {
        await resolvePublic(url.hostname)
        const t0 = performance.now()
        const { res: r, via } = await fetchViaPool(url.toString(), {
          headers: { 'User-Agent': UA, Accept: '*/*' },
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        })
        const body = r.status >= 300 && r.status < 400 ? Buffer.alloc(0) : await readLimited(r)
        out.httpStatus = r.status
        out.responseMs = Math.round(performance.now() - t0)
        out.bodyBytes = body.length
        const contentType = r.headers.get('content-type') ?? ''
        out.userInfo = r.headers.get('subscription-userinfo')
        step('http', { status: r.status, ms: out.responseMs, bytes: body.length, contentType, via, userInfo: out.userInfo })

        if (r.status >= 300 && r.status < 400) set('http', 'fail', `редирект ${r.status} на ${r.headers.get('location') ?? '?'}: пришлите прямую ссылку`)
        else if (r.status !== 200) set('http', 'fail', `ответ ${r.status}${r.status === 404 || r.status === 403 ? ': подписка удалена или отключена' : ''}`)
        else if (!body.length) set('http', 'fail', 'пустой ответ')
        else set('http', 'ok', `200 OK · ${out.responseMs} мс · ${body.length} Б`)

        if (res.get('http')?.status === 'ok') {
          const text = body.toString('utf8')
          if (/text\/html/i.test(contentType) || /^\s*</.test(text)) {
            set('content', 'fail', 'пришла веб-страница: это личный кабинет, а не ссылка подписки')
            set('device', 'skip', 'нет конфигов')
          } else {
            const configs = decodeList(text)
            out.configsCount = configs.length
            set('content', 'ok', /:\/\//.test(text) ? 'конфиги в открытом виде' : 'конфиги в base64')
            set('device', configs.length ? 'ok' : 'fail', configs.length ? `провайдер вернул конфиги: ${configs.length}` : 'провайдер не вернул конфиги: устройство отвязано или подписка аннулирована')
          }
        } else {
          set('content', 'skip', 'нет ответа')
          set('device', 'skip', 'нет ответа')
        }

        const ui = parseUserInfo(out.userInfo)
        if (out.userInfo && ('expire' in ui || 'total' in ui)) {
          set('meta', 'ok', `upload=${ui.upload ?? 0}; download=${ui.download ?? 0}; total=${ui.total ?? 0}; expire=${ui.expire ?? 0}`)
        } else set('meta', 'warn', 'нет заголовка subscription-userinfo: срок оценит модератор')

        if (ui.total && (ui.upload ?? 0) + (ui.download ?? 0) >= ui.total) {
          set('expiry', 'fail', 'трафик исчерпан: подписка у провайдера не активна')
        } else if (ui.expire && ui.expire > 0) {
          out.expireAt = new Date(ui.expire * 1000)
          out.days = Math.floor((ui.expire * 1000 - Date.now()) / DAY)
          const until = out.expireAt.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
          if (out.days < s.transferMinDays) set('expiry', 'fail', out.days < 0 ? `подписка истекла ${until}` : `осталось ${out.days} дн (до ${until}), нужно от ${s.transferMinDays}`)
          else if (out.days > s.transferMaxDays) set('expiry', 'ok', `осталось ${out.days} дн (до ${until}), зачислим максимум ${s.transferMaxDays}`)
          else set('expiry', 'ok', `осталось ${out.days} дн (до ${until})`)
        } else {
          // ТЗ: «если срока нет — эвристика по количеству конфигов».
          out.suggestedDays = out.configsCount ? Math.min(30, s.transferMaxDays) : null
          set('expiry', 'warn', out.suggestedDays ? `срок не указан, предварительно ${out.suggestedDays} дн (конфигов: ${out.configsCount})` : 'срок не указан')
        }
      } catch (err) {
        const msg = (err as Error).name === 'TimeoutError' ? 'нет ответа за 10 секунд' : (err as Error).message
        step('http_error', { error: msg })
        set('http', 'fail', msg)
        set('content', 'skip', 'нет ответа')
        set('device', 'skip', 'нет ответа')
        set('meta', 'skip', 'нет ответа')
        set('expiry', 'skip', 'нет ответа')
      }
    } else if (formatOk && out.parsed) {
      // Одиночный конфиг (vless/vmess/trojan/ss): проверяем, что сервер принимает подключения.
      const { host, port } = out.parsed
      try {
        await resolvePublic(host)
        const ms = port ? await tcpConnect(host, port) : null
        out.responseMs = ms
        step('tcp', { host, port, ms })
        set('http', ms != null ? 'ok' : 'fail', ms != null ? `сервер ${host}:${port} отвечает · ${ms} мс` : `сервер ${host}:${port} не отвечает`)
      } catch (err) {
        set('http', 'fail', (err as Error).message)
      }
      out.configsCount = 1
      set('content', res.get('http')?.status === 'ok' ? 'ok' : 'skip', 'конфиг в ссылке')
      set('meta', 'warn', 'у одиночного конфига нет метаданных')
      out.suggestedDays = Math.min(30, s.transferMaxDays)
      set('expiry', 'warn', 'срок по одиночному конфигу не определить: проверит модератор')
      set('device', res.get('http')?.status === 'ok' ? 'warn' : 'skip', 'привязку по одиночному конфигу проверит модератор')
    } else {
      for (const k of ['http', 'content', 'meta', 'expiry', 'device']) set(k, 'skip', SKIPPED)
    }

    // ── Этап 4: антифрод ──
    set('age', out.accountAgeDays >= s.transferMinAccountDays ? 'ok' : 'fail', `${out.accountAgeDays} дн (мин. ${s.transferMinAccountDays})`)
    out.hadPaidSub = await vpn.hasPaidActive(user.id)
    const cur = await vpn.current(user.id)
    set('paid', out.hadPaidSub ? 'fail' : 'ok', out.hadPaidSub ? `есть платная подписка «${cur?.plan === 'pro' ? 'Премиум' : 'Старт'}»` : cur?.status === 'trial' ? 'нет (только Trial)' : 'нет')

    const exclude = ctx.excludeId ? { id: { not: ctx.excludeId } } : {}
    const [approved, pending] = await Promise.all([
      prisma.transferRequest.findFirst({ where: { userId: user.id, status: 'approved', ...exclude } }),
      prisma.transferRequest.findFirst({ where: { userId: user.id, status: { in: ['checking', 'disputed'] }, ...exclude } }),
    ])
    set('once', approved || pending ? 'fail' : 'ok', approved ? `уже был перенос ${transferCode(approved)}` : pending ? `заявка ${transferCode(pending)} уже на рассмотрении` : 'переносов не было')

    if (ctx.ip) {
      const [sameIp, lastHour] = await Promise.all([
        prisma.transferRequest.count({ where: { ip: ctx.ip, userId: { not: user.id }, status: { in: ['approved', 'checking', 'disputed'] }, ...exclude } }),
        prisma.transferRequest.count({ where: { ip: ctx.ip, createdAt: { gte: new Date(Date.now() - 3600_000) }, ...exclude } }),
      ])
      set('ip', sameIp ? 'warn' : 'ok', sameIp ? `с этого IP уже был перенос у другого пользователя (${sameIp})` : 'IP не использовался')
      const botUa = !ctx.userAgent || /curl|wget|python|httpie|postman|insomnia|go-http|java\/|okhttp|bot|spider|headless/i.test(ctx.userAgent)
      const flood = lastHour + 1 > 5
      set('anomaly', flood || botUa ? 'warn' : 'ok', flood ? `${lastHour + 1} заявок за час с одного IP` : botUa ? `подозрительный User-Agent: ${ctx.userAgent ?? 'нет'}` : 'не обнаружены')
    } else {
      set('ip', 'warn', 'IP не определён')
      set('anomaly', 'ok', 'не обнаружены')
    }
    step('antifraud', { accountAgeDays: out.accountAgeDays, hadPaidSub: out.hadPaidSub, ip: ctx.ip })

    const checks = ORDER.map((k) => res.get(k)!).filter(Boolean)
    // Автопометка (ТЗ 1.5, шаг 5): провал → автоотказ; спорные моменты → ручная модерация; иначе автоодобрено.
    const failed = checks.find((c) => c.status === 'fail')
    const verdict = failed ? ('auto_rejected' as const) : checks.some((c) => c.status === 'warn') ? ('disputed' as const) : ('auto_approved' as const)
    const creditDays = out.days != null ? Math.min(out.days, s.transferMaxDays) : out.suggestedDays
    step('verdict', { verdict, failed: failed?.key ?? null, creditDays })
    return { ...out, checks, verdict, creditDays, rejectReason: failed ? `${failed.title}: ${failed.detail}` : null, log }
  }

  type CheckResult = Awaited<ReturnType<typeof runChecks>>

  function fields(r: CheckResult) {
    return {
      linkType: r.parsed?.type ?? 'unknown',
      provider: r.provider,
      providerList: r.providerList,
      days: r.days ?? r.suggestedDays,
      expireAt: r.expireAt,
      httpStatus: r.httpStatus,
      responseMs: r.responseMs,
      bodyBytes: r.bodyBytes,
      configsCount: r.configsCount,
      userInfo: r.userInfo,
      checks: r.checks as unknown as Prisma.InputJsonValue,
      accountAgeDays: r.accountAgeDays,
      hadPaidSub: r.hadPaidSub,
    }
  }

  /** Начисление дней: «Старт» на N дней (Премиум не понижаем), бейдж «Перенос», уведомление. */
  async function approve(id: bigint, days: number, byTgId?: number) {
    const t = await prisma.transferRequest.findUniqueOrThrow({ where: { id }, include: { user: true } })
    if (t.status === 'approved') return t
    const credit = Math.max(1, Math.min(days, (await settings.get()).transferMaxDays))
    // Сначала забираем заявку (защита от двойного нажатия), потом начисляем.
    const claimed = await prisma.transferRequest.updateMany({
      where: { id, status: { not: 'approved' } },
      data: { status: 'approved', creditedDays: credit, decidedAt: new Date(), decidedByTgId: byTgId ? BigInt(byTgId) : null, rejectReason: null },
    })
    if (!claimed.count) return t
    try {
      await vpn.grant(t.user, 'start', credit, 'transfer')
    } catch (err) {
      await prisma.transferRequest.update({ where: { id }, data: { status: t.status, creditedDays: null, decidedAt: null } })
      throw err
    }
    await appendLog(id, { step: 'approved', by: byTgId ?? 'auto', days: credit })
    await notify(t.user.tgId, `✅ <b>Перенос одобрен</b>\nЗаявка ${transferCode(t)}: начислили <b>${credit} дн</b> тарифа «Старт». Добро пожаловать в LYNK!`)
    await achievements.evaluate(t.user).catch(() => undefined)
    return prisma.transferRequest.findUniqueOrThrow({ where: { id } })
  }

  async function reject(id: bigint, reason: string, byTgId?: number) {
    const t = await prisma.transferRequest.update({
      where: { id },
      data: { status: 'rejected', rejectReason: reason, decidedAt: new Date(), decidedByTgId: byTgId ? BigInt(byTgId) : null },
      include: { user: true },
    })
    await appendLog(id, { step: 'rejected', by: byTgId ?? 'auto', reason })
    await notify(t.user.tgId, `❌ <b>Перенос отклонён</b>\nЗаявка ${transferCode(t)}.\nПричина: ${reason}`)
    return t
  }

  async function requestLink(id: bigint, byTgId: number) {
    const t = await prisma.transferRequest.update({ where: { id }, data: { status: 'need_link', decidedAt: new Date(), decidedByTgId: BigInt(byTgId) }, include: { user: true } })
    await appendLog(id, { step: 'need_link', by: byTgId })
    await notify(t.user.tgId, `🔁 <b>Нужна другая ссылка</b>\nПо заявке ${transferCode(t)} не получилось подтвердить подписку. Пришлите ссылку подписки (https://…) в разделе «Аккаунт → Перенос подписки».`)
    return t
  }

  async function appendLog(id: bigint, entry: Record<string, unknown>) {
    const t = await prisma.transferRequest.findUnique({ where: { id }, select: { log: true } })
    const log = Array.isArray(t?.log) ? (t!.log as Prisma.JsonArray) : []
    await prisma.transferRequest.update({ where: { id }, data: { log: [...log, { at: new Date().toISOString(), ...entry }] as Prisma.InputJsonValue } })
  }

  /** Заявка: 14 проверок, автопометка и действие по ней. */
  async function submit(user: User, raw: string, ctx: CheckContext) {
    const r = await runChecks(user, raw, ctx)
    const t = await prisma.transferRequest.create({
      data: {
        userId: user.id,
        link: raw.trim().slice(0, 4096),
        linkHash: r.hash ?? linkHash(raw.trim()),
        ...fields(r),
        verdict: r.verdict,
        status: r.verdict === 'auto_rejected' ? 'rejected' : r.verdict === 'disputed' ? 'disputed' : 'checking',
        rejectReason: r.rejectReason,
        log: r.log as Prisma.InputJsonValue,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 300) ?? null,
        decidedAt: r.verdict === 'auto_rejected' ? new Date() : null,
      },
    })
    if (r.verdict === 'auto_approved' && r.creditDays) {
      return approve(t.id, r.creditDays).catch(async (err: Error) => {
        // Панель недоступна: заявка уходит модератору, чтобы не потерять.
        await prisma.transferRequest.update({ where: { id: t.id }, data: { status: 'disputed' } })
        await appendLog(t.id, { step: 'activation_failed', error: err.message })
        await notifyStaff(`⚠️ Перенос ${transferCode(t)} одобрен автоматически, но начислить дни не удалось: ${err.message}`, [[{ text: 'Открыть заявку', callback_data: `adm:trc:${t.id}` }]])
        return prisma.transferRequest.findUniqueOrThrow({ where: { id: t.id } })
      })
    }
    if (r.verdict === 'disputed') {
      const warns = r.checks.filter((c) => c.status === 'warn').map((c) => `• ${c.title}: ${c.detail}`).join('\n')
      await notifyStaff(
        `🔁 <b>Спорный перенос ${transferCode(t)}</b>\nОт: ${user.username ? '@' + user.username : user.tgId} · аккаунту ${r.accountAgeDays} дн\nДней: ${r.creditDays ?? '?'}\n\n${warns}`,
        [[{ text: 'Открыть заявку', callback_data: `adm:trc:${t.id}` }]],
      )
      await notify(user.tgId, `⏳ Заявка на перенос ${transferCode(t)} отправлена на ручную проверку. Обычно это занимает до 15 минут.`)
    }
    if (r.verdict === 'auto_rejected') await notify(user.tgId, `❌ <b>Перенос отклонён</b>\nЗаявка ${transferCode(t)}.\nПричина: ${r.rejectReason}`)
    return t
  }

  /** Ручная перепроверка ссылки админом: повторный запрос к провайдеру, результаты в карточке. */
  async function recheck(id: bigint, byTgId: number) {
    const t = await prisma.transferRequest.findUniqueOrThrow({ where: { id }, include: { user: true } })
    const r = await runChecks(t.user, t.link, { ip: t.ip, userAgent: t.userAgent, excludeId: t.id })
    const log = Array.isArray(t.log) ? (t.log as Prisma.JsonArray) : []
    await prisma.transferRequest.update({
      where: { id },
      data: { ...fields(r), verdict: r.verdict, log: [...log, { at: new Date().toISOString(), step: 'recheck', by: byTgId }, ...r.log] as Prisma.InputJsonValue },
    })
    return r
  }

  async function latestFor(userId: bigint) {
    return prisma.transferRequest.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } })
  }

  function publicView(t: TransferRequest) {
    return {
      id: t.id.toString(),
      code: transferCode(t),
      status: t.status,
      verdict: t.verdict,
      linkType: t.linkType,
      provider: t.provider,
      days: t.days,
      creditedDays: t.creditedDays,
      expireAt: t.expireAt?.toISOString() ?? null,
      rejectReason: t.rejectReason,
      checks: t.checks,
      createdAt: t.createdAt.toISOString(),
      decidedAt: t.decidedAt?.toISOString() ?? null,
    }
  }

  return { runChecks, submit, approve, reject, requestLink, recheck, latestFor, publicView, appendLog }
}

export type TransferService = ReturnType<typeof createTransferService>
