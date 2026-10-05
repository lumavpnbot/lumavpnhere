import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { PanelClient, PanelProvider } from '@/panel'
import { ownerIds } from '@/bot/staff'
import { disabledCountries } from '@/lib/countries'
import { recordError, recordSubRequest, type SubRequest } from '@/lib/errors'
import { PLAN_LIMITS, type VpnService } from '@/services/vpn'

const BRAND = 'LYNK'
const GB = 1024 ** 3

const b64 = (s: string) => Buffer.from(s).toString('base64')

/** Клиенты, в которые подписка добавляется одной кнопкой (страница /open/<клиент>/<токен>). */
export const CLIENT_APPS = {
  happ: { name: 'Happ', deeplink: (url: string) => `happ://add/${url}` },
  incy: { name: 'INCY', deeplink: (url: string) => `incy://add/${url}` },
  hiddify: { name: 'Hiddify', deeplink: (url: string) => `hiddify://import/${url}#${encodeURIComponent(BRAND)}` },
} as const
export type ClientAppId = keyof typeof CLIENT_APPS
const isClientAppId = (v: string): v is ClientAppId => Object.hasOwn(CLIENT_APPS, v)

/** «upload=1; download=2; total=3; expire=4» → объект. */
export function parseUserInfo(v: string | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of (v ?? '').split(';')) {
    const [k, n] = part.split('=').map((s) => s.trim())
    if (k && n && Number.isFinite(Number(n))) out[k.toLowerCase()] = Number(n)
  }
  return out
}

// Чтобы склеить несколько стран, просим у панелей простой список ссылок (как для v2rayNG).
const PLAIN_UA = 'v2rayNG/1.9.0'

// Сколько /sub ждёт панель: сверку клиента и ссылки подписки у панелей. Клиенты (Happ и др.)
// обрывают запрос примерно через 15 с и оставляют старую подписку, поэтому укладываемся раньше,
// а если панель не успела, отдаём последний удачный список конфигов (user.subCache).
const SYNC_WAIT_MS = 6_000
// Сохранённых конфигов ещё нет (только что добавили подписку): ждём панель дольше, чем отдавать ошибку.
const SYNC_WAIT_FIRST_MS = 9_000
const UPSTREAM_WAIT_MS = 4_000

/** Результат работы или fallback, если она не успела за ms (сама работа продолжается в фоне). */
function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms)
    }),
  ])
}

export function decodeList(body: string): string[] {
  const text = body.trim()
  const raw = /^[A-Za-z0-9+/=\s_-]+$/.test(text) && !text.includes('://') ? Buffer.from(text, 'base64').toString('utf8') : text
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[a-z0-9]+:\/\//i.test(l))
}

const COUNTRY_NAMES: Record<string, string> = {
  fi: 'Финляндия', nl: 'Нидерланды', de: 'Германия', us: 'США', ru: 'Россия', se: 'Швеция', pl: 'Польша',
  gb: 'Великобритания', tr: 'Турция', kz: 'Казахстан', jp: 'Япония', fr: 'Франция', ee: 'Эстония', lv: 'Латвия',
}
const COUNTRY_ORDER = ['fi', 'nl', 'de', 'us', 'ru', 'se', 'pl', 'gb', 'tr', 'kz', 'jp']
const PROTO_ORDER = ['TCP 443', 'XHTTP', 'gRPC', 'TCP', 'Hysteria', 'WS']
// Хосты H1: fi3.h1cloud.net → fi, msk2.h1cloud.net → ru.
const HOST_ALIASES: Record<string, string> = { msk: 'ru', spb: 'ru', ams: 'nl', fra: 'de' }

const flagOf = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))

function countryFromFlag(name: string): string | null {
  const cps = [...name].map((c) => c.codePointAt(0) ?? 0)
  for (let i = 0; i + 1 < cps.length; i++) {
    if (cps[i] >= 0x1f1e6 && cps[i] <= 0x1f1ff && cps[i + 1] >= 0x1f1e6 && cps[i + 1] <= 0x1f1ff) {
      return String.fromCharCode(cps[i] - 0x1f1e6 + 97, cps[i + 1] - 0x1f1e6 + 97)
    }
  }
  return null
}

// Ищем страну в любой части адреса: fi3.h1cloud.net, 82fdf9df.fi3.h1clayd.click (свой домен 443).
function countryFromHost(host: string): string | null {
  for (const label of host.toLowerCase().split('.')) {
    const m = /^([a-z]{2,3})\d*$/.exec(label)
    if (!m) continue
    const k = HOST_ALIASES[m[1]] ?? m[1]
    if (COUNTRY_NAMES[k]) return k
  }
  return null
}

function protoOf(link: string, params: URLSearchParams): string {
  const scheme = link.split('://')[0].toLowerCase()
  if (scheme === 'hysteria2' || scheme === 'hy2' || scheme === 'hysteria') return 'Hysteria'
  if (scheme === 'trojan') return 'Trojan'
  if (scheme === 'ss') return 'Shadowsocks'
  if (scheme === 'vmess') return 'VMess'
  const type = (params.get('type') ?? 'tcp').toLowerCase()
  return ({ tcp: 'TCP', raw: 'TCP', xhttp: 'XHTTP', splithttp: 'XHTTP', ws: 'WS', grpc: 'gRPC', httpupgrade: 'HTTPUpgrade', hysteria: 'Hysteria', hysteria2: 'Hysteria' } as Record<string, string>)[type] ?? type.toUpperCase()
}

/**
 * Переименование конфигов: «🇫🇮 Финляндия | TCP», «🇫🇮 Финляндия | Hysteria», и сортировка по стране.
 * Конфиги убранных стран (off, DISABLED_COUNTRIES) выбрасываем: панели H1 связаны и могут их подтянуть.
 */
export function renameLinks(links: string[], off: Set<string> = new Set()): string[] {
  const rows = links.map((link) => {
    const [body, fragment = ''] = link.split('#')
    const oldName = (() => {
      try {
        return decodeURIComponent(fragment)
      } catch {
        return fragment
      }
    })()
    let host = ''
    let params = new URLSearchParams()
    try {
      const u = new URL(body)
      host = u.hostname
      params = u.searchParams
    } catch {
      /* vmess:// и прочие base64-форматы: имя оставляем */
    }
    const country = countryFromFlag(oldName) ?? countryFromHost(host)
    let proto = protoOf(body, params)
    // Подключение на 443 со своим доменом (Selfsteal) отличаем от обычного TCP.
    try {
      const port = new URL(body).port
      if (proto === 'TCP' && (port === '443' || port === '8443')) proto = 'TCP 443'
    } catch {
      /* без порта */
    }
    return { body, oldName, country, proto }
  }).filter((r) => !r.country || !off.has(r.country))
  rows.sort((a, b) => {
    const ca = a.country ? COUNTRY_ORDER.indexOf(a.country) : 99
    const cb = b.country ? COUNTRY_ORDER.indexOf(b.country) : 99
    if (ca !== cb) return (ca < 0 ? 98 : ca) - (cb < 0 ? 98 : cb)
    return (PROTO_ORDER.indexOf(a.proto) + 99) % 99 - (PROTO_ORDER.indexOf(b.proto) + 99) % 99
  })
  const used = new Map<string, number>()
  return rows.map((r) => {
    if (!r.country || !COUNTRY_NAMES[r.country]) return r.oldName ? `${r.body}#${encodeURIComponent(r.oldName)}` : r.body
    let name = `${flagOf(r.country)} ${COUNTRY_NAMES[r.country]} | ${r.proto}`
    const n = (used.get(name) ?? 0) + 1
    used.set(name, n)
    if (n > 1) name += ` ${n}`
    return `${r.body}#${encodeURIComponent(name)}`
  })
}

/**
 * Публичная ссылка подписки: https://<наш домен>/sub/<subToken>.
 *
 * Зачем прокси, а не ссылка панели:
 *  - панель H1 отдаёт подписку по http://, Happ такие ссылки отклоняет;
 *  - пользователь не видит провайдера серверов;
 *  - все страны (отдельные панели) собираются в одну подписку;
 *  - при смене провайдера или добавлении страны ссылка у пользователя та же.
 */
export function registerSubscriptionRoutes(app: FastifyInstance, prisma: PrismaClient, panel: PanelProvider, vpn: VpnService, env: NodeJS.ProcessEnv) {
  // Каждый запрос подписки с итогом (код, время, причина) виден в /admin → Логи → Подписки:
  // по нему понятно, что получил клиент, когда «не добавляется» или «не обновляется».
  const subLog = new WeakMap<FastifyRequest, SubRequest & { start: number }>()
  app.addHook('onResponse', async (request, reply) => {
    const entry = subLog.get(request)
    if (!entry) return
    entry.status = reply.statusCode
    entry.ms = Date.now() - entry.start
    recordSubRequest(entry)
  })

  app.get('/sub/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const header = (k: string) => {
      const v = request.headers[k]
      return (Array.isArray(v) ? v[0] : v)?.toString().slice(0, 120) ?? null
    }
    const ua = header('user-agent') ?? ''
    const log: SubRequest & { start: number } = {
      start: Date.now(),
      at: new Date(),
      tgId: 0,
      ua,
      hwid: Boolean(header('x-hwid')),
      os: header('x-device-os'),
      model: header('x-device-model'),
    }
    subLog.set(request, log)
    const user = await prisma.user.findUnique({ where: { subToken: token } })
    if (!user) {
      log.note = 'ссылка не найдена (токен устарел или обрезан)'
      return reply.code(404).send('not found')
    }
    const tgId = Number(user.tgId)
    log.tgId = tgId
    const isOwner = ownerIds(env).has(tgId)

    reply.header('cache-control', 'no-store')
    reply.header('profile-title', `base64:${b64(BRAND)}`)
    if (env.SUPPORT_URL) reply.header('support-url', env.SUPPORT_URL)
    const announce = (text: string) => reply.header('announce', `base64:${b64(text)}`)

    if (user.banned) {
      announce('Доступ к сервису ограничен. Напишите в поддержку.')
      log.note = 'заблокирован'
      return reply.code(403).send('banned')
    }

    // Ссылку открыли в браузере (нажали в Telegram, вставили в адресную строку): вместо списка
    // конфигов в base64 показываем страницу с кнопками «Добавить в Happ / INCY / Hiddify».
    if (isBrowser(request.headers)) {
      log.note = 'браузер: страница подписки'
      const sub = await vpn.current(user.id)
      reply.header('content-type', 'text/html; charset=utf-8')
      return reply.send(subscriptionPage(env, token, sub?.expiresAt ?? null))
    }

    // Устройство: Happ присылает x-hwid и данные об устройстве при каждом обновлении подписки.
    // Если клиент не прислал HWID (старые версии, другие приложения), узнаём устройство по user-agent.
    const isClientApp = /happ|incy|v2ray|hiddify|streisand|v2box|nekobox|sing-?box|clash|karing|shadowrocket|foxray/i.test(ua)
    const hwid = header('x-hwid') ?? (isClientApp ? `ua:${ua.slice(0, 100)}` : null)

    // Источник правды: подписка в БД. Панель подтягиваем к ней (vpn.sync).
    // Команде проекта «Премиум» выдаётся автоматически, даже если приложение ещё не открывали.
    const sub = (await vpn.current(user.id)) ?? (isOwner ? await vpn.ensureAdmin(user).catch(() => null) : null)
    if (!sub) {
      // Подписки нет, а клиент на панели ещё включён (сбой отключения): выключаем в фоне.
      void panel
        .getClient(tgId)
        .then((c) => (c?.enabled ? panel.disable(tgId) : undefined))
        .catch((err) => recordError('sub disable', err))
      announce('Подписка закончилась. Продлите её в приложении LYNK.')
      log.note = 'нет активной подписки'
      return reply.code(404).send('no active subscription')
    }

    if (hwid) {
      const existing = await prisma.device.findUnique({ where: { userId_hwid: { userId: user.id, hwid } } })
      // Лимит устройств блокирует подписку только если явно включён (DEVICE_LIMIT_ENFORCE=1)
      // и только по настоящему HWID: user-agent у одного телефона бывает разным, и
      // блокировка по нему отрезала людям подписку.
      const enforce = env.DEVICE_LIMIT_ENFORCE === '1' && !hwid.startsWith('ua:')
      if (!existing && enforce) {
        // Лимит тарифа + бонусные устройства за достижения.
        const limit = isOwner ? null : await vpn.deviceLimit(user, sub.plan)
        const count = await prisma.device.count({ where: { userId: user.id, NOT: { hwid: { startsWith: 'ua:' } } } })
        if (limit != null && count >= limit) {
          announce(`Достигнут лимит устройств (${limit}). Удалите старое устройство в приложении LYNK.`)
          log.note = `лимит устройств (${limit})`
          return reply.code(403).send('device limit reached')
        }
      }
      const uaApp = ua.split(/[\s/]/)[0] || null
      const uaOs = /ios|iphone|ipad/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : null
      const os = [header('x-device-os') ?? uaOs, header('x-ver-os')].filter(Boolean).join(' ') || null
      const data = { label: header('x-device-model') || os || uaApp || 'Устройство', platform: os, app: ua || null, lastSeenAt: new Date() }
      await prisma.device
        .upsert({ where: { userId_hwid: { userId: user.id, hwid } }, create: { userId: user.id, hwid, ...data }, update: data })
        .catch((err) => recordError('device upsert', err))
      if (!existing) await prisma.deviceEvent.create({ data: { userId: user.id, hwid, label: data.label, event: 'bound' } }).catch(() => undefined)
    }

    // Если на панели клиента нет, он выключен или срок там меньше оплаченного, выдаём заново.
    // Панель тормозит: не ждём дольше SYNC_WAIT_MS, сверка доделается в фоне.
    const client: PanelClient | null = await within(
      vpn.sync(user).then(
        (r) => r.client,
        (err) => {
          recordError('sub sync', err)
          return null
        },
      ),
      user.subCache ? SYNC_WAIT_MS : SYNC_WAIT_FIRST_MS,
      null,
    )
    const urls = client?.enabled ? client.upstreamSubscriptionUrls : []
    const direct = client?.enabled ? (client.links ?? []) : []

    // Берём у панелей простой список ссылок, чтобы переименовать конфиги и склеить страны.
    const responses = await Promise.allSettled(
      urls.map((u) =>
        fetch(u, { headers: { 'User-Agent': PLAIN_UA }, signal: AbortSignal.timeout(UPSTREAM_WAIT_MS) }).then(async (r) => {
          if (!r.ok) throw new Error(`upstream ${r.status}`)
          return { headers: r.headers, body: Buffer.from(await r.arrayBuffer()) }
        }),
      ),
    )
    responses.forEach((r) => r.status === 'rejected' && recordError('sub upstream', r.reason))
    const ok = responses.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))

    // Панели H1 в одном аккаунте связаны: подписка одной уже может содержать
    // другие страны. Убираем повторы по ссылке без названия (#…).
    const seen = new Set<string>()
    let links = renameLinks(
      [...ok.flatMap((r) => decodeList(r.body.toString('utf8'))), ...direct].filter((l) => {
        const key = l.split('#')[0]
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }),
      disabledCountries(env),
    )
    if (links.length) {
      // Запоминаем удачный список: пригодится, если в следующий раз панель не ответит.
      const text = links.join('\n')
      if (text !== user.subCache) {
        await prisma.user.update({ where: { id: user.id }, data: { subCache: text, subCacheAt: new Date() } }).catch((err) => recordError('sub cache', err))
      }
    } else if (user.subCache) {
      // Панель не ответила вовремя: отдаём прежние конфиги со свежим сроком из БД, чтобы
      // клиент не показывал ошибку и обновил дату окончания.
      links = user.subCache.split('\n').filter(Boolean)
      log.note = 'панель не ответила: сохранённые конфиги'
    } else {
      announce('Серверы готовятся. Обновите подписку через пару минут.')
      log.note = client ? 'панель не отдала конфиги' : 'панель не ответила, сохранённых конфигов нет'
      return reply.code(503).send('panel unavailable')
    }
    log.note ??= `${links.length} конфигов`

    const upstreamAnnounce = ok[0]?.headers.get('announce')
    if (upstreamAnnounce) reply.header('announce', upstreamAnnounce)
    // Подписка добавлена по старому адресу (работает только с VPN у части операторов): просим
    // добавить её заново из приложения, там уже новая ссылка (SUB_URL).
    if (viaOldAddress(env, request.headers, request.hostname)) {
      announce('Обновите ссылку подписки: удалите эту подписку и добавьте заново из приложения LYNK. Новая ссылка работает и без VPN.')
    }

    // Срок и лимит трафика берём из нашей БД: так клиент (Happ) всегда показывает
    // актуальную дату после продления, даже если панель отдала старые данные.
    const up = parseUserInfo(ok[0]?.headers.get('subscription-userinfo') ?? null)
    const limitGb = isOwner ? null : PLAN_LIMITS[sub.plan].trafficGb
    const upload = up.upload ?? 0
    const download = up.download ?? Math.round((client?.trafficUsedGb ?? 0) * GB)
    reply.header(
      'subscription-userinfo',
      `upload=${upload}; download=${download}; total=${limitGb ? limitGb * GB : 0}; expire=${Math.floor(sub.expiresAt.getTime() / 1000)}`,
    )
    // Happ: при открытии проверяет пинг через прокси и сам подключается к самому быстрому серверу.
    // https://www.happ.su/main/dev-docs/app-management
    // Автообновление подписки в клиенте: каждый час.
    reply.header('profile-update-interval', '1')
    reply.header('subscription-autoconnect', 'true')
    reply.header('subscription-autoconnect-type', 'lowestdelay')
    reply.header('subscription-ping-onopen-enabled', 'true')
    reply.header('ping-type', 'proxy-head')
    reply.header('check-url-via-proxy', 'https://cp.cloudflare.com/generate_204')
    reply.header('subscriptions-sort-type', 'ping')

    reply.header('content-type', 'text/plain; charset=utf-8')
    return reply.send(b64(links.join('\n')))
  })

  /**
   * Кнопка «Открыть в Happ / INCY / Hiddify». Telegram на iOS не открывает из Mini App
   * свои схемы вроде happ://, поэтому Mini App открывает эту https-страницу во внешнем
   * браузере, а она уже переходит в happ://add/<ссылка подписки> (incy://add/…, hiddify://import/…).
   */
  app.get('/open/:app/:token', async (request, reply) => {
    const { app: appId, token } = request.params as { app: string; token: string }
    if (!isClientAppId(appId)) return reply.code(404).send('unknown app')
    const client = CLIENT_APPS[appId]
    const url = subscriptionUrl(env, token)
    if (!url) return reply.code(500).send('PUBLIC_URL is not set')
    const deeplink = client.deeplink(url)
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    reply.header('content-type', 'text/html; charset=utf-8')
    return reply.send(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LYNK</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050506;color:#f4f4f6;font:16px/1.5 -apple-system,BlinkMacSystemFont,Inter,sans-serif}
main{max-width:360px;padding:24px;text-align:center}
a.btn{display:block;margin-top:20px;padding:15px;border-radius:999px;background:rgba(255,255,255,.18);color:#fff;text-decoration:none;font-weight:600}
p{color:#a1a1aa}
</style></head><body><main>
<h2>Открываем ${client.name}…</h2>
<p>Если приложение не открылось само, нажмите кнопку. ${client.name} должен быть установлен.</p>
<a class="btn" href="${esc(deeplink)}">Открыть в ${client.name}</a>
</main><script>location.href=${JSON.stringify(deeplink)}</script></body></html>`)
  })
}

/**
 * Браузер, а не VPN-клиент: просит HTML и представляется как Mozilla. Клиенты (Happ, v2rayNG,
 * Hiddify, Streisand и др.) присылают свой user-agent и HTML не просят, им уходит подписка.
 */
function isBrowser(headers: Record<string, string | string[] | undefined>): boolean {
  const ua = String(headers['user-agent'] ?? '')
  const accept = String(headers['accept'] ?? '')
  if (CLIENT_UA.test(ua) || headers['x-hwid']) return false
  return /^Mozilla\//.test(ua) && accept.includes('text/html')
}
const CLIENT_UA = /happ|incy|v2ray|hiddify|streisand|v2box|nekobox|nekoray|sing-?box|clash|mihomo|stash|karing|shadowrocket|foxray|quantumult|surge|loon/i

/** Страница подписки для браузера: срок, кнопки добавления в клиенты, копирование ссылки. */
function subscriptionPage(env: NodeJS.ProcessEnv, token: string, expiresAt: Date | null): string {
  const url = subscriptionUrl(env, token) ?? ''
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  const active = !!expiresAt && expiresAt > new Date()
  const until = expiresAt?.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })
  const buttons = (Object.keys(CLIENT_APPS) as ClientAppId[])
    .map((id, i) => `<a class="btn${i ? '' : ' main'}" href="${esc(clientOpenUrl(env, id, token) ?? CLIENT_APPS[id].deeplink(url))}">Добавить в ${CLIENT_APPS[id].name}</a>`)
    .join('')
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${BRAND} · Подписка</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050506;color:#f4f4f6;font:16px/1.5 -apple-system,BlinkMacSystemFont,Inter,sans-serif}
main{width:100%;max-width:380px;padding:24px;box-sizing:border-box;text-align:center}
h1{margin:0 0 4px;font-size:26px}
p{margin:0;color:#a1a1aa}
.state{margin:6px 0 22px;color:${active ? '#86efac' : '#fca5a5'}}
a.btn,button{display:block;width:100%;box-sizing:border-box;margin-top:10px;padding:15px;border:0;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;text-decoration:none;font:600 16px/1.2 inherit;cursor:pointer}
a.main{background:#fff;color:#0b0b0d}
.link{margin-top:22px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.06);color:#a1a1aa;font:13px/1.4 ui-monospace,monospace;word-break:break-all;text-align:left}
.hint{margin-top:14px;font-size:13px}
</style></head><body><main>
<h1>${BRAND}</h1>
<p class="state">${active ? `Подписка активна до ${esc(until ?? '')}` : 'Подписка не активна. Продлите её в приложении LYNK в Telegram.'}</p>
${buttons}
<div class="link" id="link">${esc(url)}</div>
<button id="copy">Скопировать ссылку</button>
<p class="hint">Эта ссылка открывается в приложении для подключения, а не в браузере. Нажмите «Добавить в …» или скопируйте ссылку и вставьте её в приложение (кнопка «+» → «Из буфера»).</p>
</main><script>
document.getElementById('copy').onclick=function(){var b=this,u=${JSON.stringify(url)};function ok(){b.textContent='Скопировано'}
if(navigator.clipboard)navigator.clipboard.writeText(u).then(ok,fallback);else fallback();
function fallback(){var r=document.createRange();r.selectNodeContents(document.getElementById('link'));var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy');ok()}catch(e){}}}
</script></body></html>`
}

/**
 * Адрес для ссылок подписки и страниц «Открыть в …»: SUB_URL, иначе PUBLIC_URL.
 * *.up.railway.app у части провайдеров и мобильных операторов в России не открывается
 * (ошибка TLS), и подписка без VPN не добавлялась и не обновлялась. SUB_URL: свой домен
 * с прокси на бэкенд (infra/sub-proxy), который открывается без VPN.
 */
export function subBase(env: NodeJS.ProcessEnv) {
  return (env.SUB_URL || env.PUBLIC_URL || '').replace(/\/+$/, '')
}

export function subscriptionUrl(env: NodeJS.ProcessEnv, subToken: string) {
  const base = subBase(env)
  return base ? `${base}/sub/${subToken}` : null
}

export function clientOpenUrl(env: NodeJS.ProcessEnv, app: ClientAppId, subToken: string) {
  const base = subBase(env)
  return base ? `${base}/open/${app}/${subToken}` : null
}

/** Запрос пришёл по старому адресу (Railway), хотя есть SUB_URL: клиенту стоит добавить подписку заново. */
function viaOldAddress(env: NodeJS.ProcessEnv, headers: Record<string, string | string[] | undefined>, hostname: string) {
  if (!env.SUB_URL) return false
  let subHost = ''
  try {
    subHost = new URL(env.SUB_URL).hostname.toLowerCase()
  } catch {
    return false
  }
  // Прокси (infra/sub-proxy) передаёт исходный домен в X-Lynk-Host.
  const via = String(headers['x-lynk-host'] ?? '').split(':')[0].toLowerCase()
  return via !== subHost && hostname.toLowerCase() !== subHost
}

export const happOpenUrl = (env: NodeJS.ProcessEnv, subToken: string) => clientOpenUrl(env, 'happ', subToken)

/** Ссылки «Открыть в …» для всех клиентов: { happ, incy, hiddify }. */
export function clientOpenUrls(env: NodeJS.ProcessEnv, subToken: string) {
  return Object.fromEntries((Object.keys(CLIENT_APPS) as ClientAppId[]).map((id) => [id, clientOpenUrl(env, id, subToken)])) as Record<ClientAppId, string | null>
}
