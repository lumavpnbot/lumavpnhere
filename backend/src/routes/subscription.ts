import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { PanelProvider } from '@/panel'
import { ownerIds } from '@/bot/staff'
import { PLAN_LIMITS } from '@/services/vpn'

const BRAND = 'LYNK'

// Заголовки подписки, которые понимают Happ / Hiddify / v2rayTun: трафик и срок, интервал обновления.
const PASS_HEADERS = ['content-type', 'subscription-userinfo', 'profile-update-interval', 'announce']

// Чтобы склеить несколько стран, просим у панелей простой список ссылок (как для v2rayNG).
const PLAIN_UA = 'v2rayNG/1.9.0'

function decodeList(body: string): string[] {
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
const PROTO_ORDER = ['TCP', 'XHTTP', 'Hysteria', 'WS', 'gRPC']
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

function countryFromHost(host: string): string | null {
  const m = /^([a-z]{2,3})\d*\./i.exec(host)
  if (!m) return null
  const k = m[1].toLowerCase()
  return HOST_ALIASES[k] ?? (k.length === 2 ? k : null)
}

function protoOf(link: string, params: URLSearchParams): string {
  const scheme = link.split('://')[0].toLowerCase()
  if (scheme === 'hysteria2' || scheme === 'hy2' || scheme === 'hysteria') return 'Hysteria'
  if (scheme === 'trojan') return 'Trojan'
  if (scheme === 'ss') return 'Shadowsocks'
  if (scheme === 'vmess') return 'VMess'
  const type = (params.get('type') ?? 'tcp').toLowerCase()
  return ({ tcp: 'TCP', raw: 'TCP', xhttp: 'XHTTP', splithttp: 'XHTTP', ws: 'WS', grpc: 'gRPC', httpupgrade: 'HTTPUpgrade' } as Record<string, string>)[type] ?? type.toUpperCase()
}

/** Переименование конфигов: «🇫🇮 Финляндия | TCP», «🇫🇮 Финляндия | Hysteria», и сортировка по стране. */
function renameLinks(links: string[]): string[] {
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
    const proto = protoOf(body, params)
    return { body, oldName, country, proto }
  })
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
export function registerSubscriptionRoutes(app: FastifyInstance, prisma: PrismaClient, panel: PanelProvider, env: NodeJS.ProcessEnv) {
  app.get('/sub/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const user = await prisma.user.findUnique({ where: { subToken: token } })
    if (!user) return reply.code(404).send('not found')

    // Устройство: Happ присылает x-hwid и данные об устройстве при каждом обновлении подписки.
    const header = (k: string) => {
      const v = request.headers[k]
      return (Array.isArray(v) ? v[0] : v)?.toString().slice(0, 120) ?? null
    }
    const hwid = header('x-hwid')
    if (hwid) {
      const existing = await prisma.device.findUnique({ where: { userId_hwid: { userId: user.id, hwid } } })
      if (!existing) {
        const sub = await prisma.subscription.findFirst({
          where: { userId: user.id, status: { in: ['trial', 'active'] }, expiresAt: { gt: new Date() } },
          orderBy: { expiresAt: 'desc' },
        })
        const isOwner = ownerIds(env).has(Number(user.tgId))
        const limit = sub && !isOwner ? PLAN_LIMITS[sub.plan].devices : null
        const count = await prisma.device.count({ where: { userId: user.id } })
        if (limit != null && count >= limit) {
          reply.header('announce', `base64:${Buffer.from(`Достигнут лимит устройств (${limit}). Удалите старое устройство в приложении LYNK.`).toString('base64')}`)
          return reply.code(403).send('device limit reached')
        }
      }
      const os = [header('x-device-os'), header('x-ver-os')].filter(Boolean).join(' ') || null
      const data = { label: header('x-device-model') || os || 'Устройство', platform: os, app: header('user-agent'), lastSeenAt: new Date() }
      await prisma.device
        .upsert({ where: { userId_hwid: { userId: user.id, hwid } }, create: { userId: user.id, hwid, ...data }, update: data })
        .catch(() => undefined)
    }

    const client = await panel.getClient(Number(user.tgId))
    const urls = client?.enabled ? client.upstreamSubscriptionUrls : []
    if (!urls.length) return reply.code(404).send('no active subscription')

    // Берём у панелей простой список ссылок, чтобы переименовать конфиги и склеить страны.
    const responses = await Promise.allSettled(
      urls.map((u) =>
        fetch(u, { headers: { 'User-Agent': PLAIN_UA }, signal: AbortSignal.timeout(10_000) }).then(async (r) => {
          if (!r.ok) throw new Error(`upstream ${r.status}`)
          return { headers: r.headers, body: Buffer.from(await r.arrayBuffer()) }
        }),
      ),
    )
    const ok = responses.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    if (!ok.length) return reply.code(502).send('upstream error')

    for (const h of PASS_HEADERS) {
      const v = ok[0].headers.get(h)
      if (v && h !== 'content-type') reply.header(h, v)
    }
    reply.header('profile-title', `base64:${Buffer.from(BRAND).toString('base64')}`)
    if (env.SUPPORT_URL) reply.header('support-url', env.SUPPORT_URL)
    reply.header('cache-control', 'no-store')
    // Happ: при открытии проверяет пинг через прокси и сам подключается к самому быстрому серверу.
    // https://www.happ.su/main/dev-docs/app-management
    // Автообновление подписки в клиенте: каждые 2 часа.
    reply.header('profile-update-interval', '2')
    reply.header('subscription-autoconnect', 'true')
    reply.header('subscription-autoconnect-type', 'lowestdelay')
    reply.header('subscription-ping-onopen-enabled', 'true')
    reply.header('ping-type', 'proxy-head')
    reply.header('check-url-via-proxy', 'https://cp.cloudflare.com/generate_204')
    reply.header('subscriptions-sort-type', 'ping')

    // Панели H1 в одном аккаунте связаны: подписка одной уже может содержать
    // другие страны. Убираем повторы по ссылке без названия (#…).
    const seen = new Set<string>()
    const links = renameLinks(
      ok
        .flatMap((r) => decodeList(r.body.toString('utf8')))
        .filter((l) => {
          const key = l.split('#')[0]
          if (seen.has(key)) return false
          seen.add(key)
          return true
        }),
    )
    reply.header('content-type', 'text/plain; charset=utf-8')
    return reply.send(Buffer.from(links.join('\n')).toString('base64'))
  })

  /**
   * Кнопка «Открыть в Happ». Telegram на iOS не открывает из Mini App свои схемы
   * вроде happ://, поэтому Mini App открывает эту https-страницу во внешнем
   * браузере, а она уже переходит в happ://add/<ссылка подписки>.
   */
  app.get('/open/happ/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const url = subscriptionUrl(env, token)
    if (!url) return reply.code(500).send('PUBLIC_URL is not set')
    const deeplink = `happ://add/${url}`
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
<h2>Открываем Happ…</h2>
<p>Если приложение не открылось само, нажмите кнопку. Happ должен быть установлен.</p>
<a class="btn" href="${esc(deeplink)}">Открыть в Happ</a>
</main><script>location.href=${JSON.stringify(deeplink)}</script></body></html>`)
  })
}

export function subscriptionUrl(env: NodeJS.ProcessEnv, subToken: string) {
  const base = (env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/sub/${subToken}` : null
}

export function happOpenUrl(env: NodeJS.ProcessEnv, subToken: string) {
  const base = (env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/open/happ/${subToken}` : null
}
