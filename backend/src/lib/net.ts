import dns from 'node:dns/promises'
import net from 'node:net'

/**
 * Сетевые проверки для переноса подписок: бэкенд ходит по ссылке, которую прислал
 * пользователь, поэтому внутренние адреса (localhost, сеть Railway, метаданные облака)
 * запрещены — иначе через перенос можно было бы опросить наши внутренние сервисы.
 */

const RESERVED_TLDS = new Set(['local', 'localhost', 'internal', 'lan', 'home', 'corp', 'test', 'example', 'invalid', 'onion', 'arpa', 'localdomain'])

// Сокращатели ссылок: ведут редиректом неизвестно куда.
export const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'cutt.ly', 'is.gd', 'v.gd', 'clck.ru', 'vk.cc', 'ow.ly',
  'rebrand.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'u.to', 'lnkd.in', 's.id', 'shorturl.com', 'buff.ly', 'qps.ru',
])

export const allowLocal = () => process.env.TRANSFER_ALLOW_LOCAL === '1'

/** Частные, служебные и зарезервированные адреса IPv4/IPv6. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224
    )
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v === '::' || v === '::1') return true
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7))
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff')
  }
  return true
}

/** Домен настоящий: не IP, не localhost, существующая зона верхнего уровня. */
export function checkDomain(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (!h) return 'пустой домен'
  if (net.isIP(h.replace(/^\[|\]$/g, ''))) return 'вместо домена IP-адрес'
  if (h === 'localhost' || h.endsWith('.localhost')) return 'localhost'
  const labels = h.split('.')
  if (labels.length < 2) return 'нет доменной зоны'
  const tld = labels[labels.length - 1]
  if (RESERVED_TLDS.has(tld)) return `служебная зона .${tld}`
  if (!/^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/.test(tld)) return `неизвестная зона .${tld}`
  if (!labels.every((l) => /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/.test(l))) return 'недопустимые символы в домене'
  return null
}

/** Адреса хоста. Бросает ошибку, если хоста нет или он указывает во внутреннюю сеть. */
export async function resolvePublic(host: string): Promise<string[]> {
  const h = host.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(h) ? [h] : (await dns.lookup(h, { all: true })).map((a) => a.address)
  if (!addrs.length) throw new Error('домен не найден')
  if (!allowLocal() && addrs.some(isPrivateAddress)) throw new Error('адрес во внутренней сети')
  return addrs
}

/** Время TCP-подключения, мс (null — не отвечает). */
export function tcpConnect(host: string, port: number, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const started = performance.now()
    const socket = net.connect({ host, port })
    const done = (v: number | null) => {
      socket.destroy()
      resolve(v)
    }
    socket.setTimeout(timeoutMs, () => done(null))
    socket.once('connect', () => done(Math.round(performance.now() - started)))
    socket.once('error', () => done(null))
  })
}

// ── Прокси-пул (ТЗ 1.4, этап 2): запросы к провайдерам идут с разных IP ──
const proxies = () => (process.env.TRANSFER_PROXIES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
let proxyIndex = 0
const agents = new Map<string, unknown>()

/** fetch через следующий прокси из TRANSFER_PROXIES (http://user:pass@host:port), без прокси — напрямую. */
export async function fetchViaPool(url: string, init: RequestInit): Promise<{ res: Response; via: string }> {
  const list = proxies()
  if (!list.length) return { res: await fetch(url, init), via: 'direct' }
  const proxy = list[proxyIndex++ % list.length]
  const undici = await import('undici')
  let agent = agents.get(proxy)
  if (!agent) {
    agent = new undici.ProxyAgent(proxy)
    agents.set(proxy, agent)
  }
  const res = await undici.fetch(url, { ...(init as object), dispatcher: agent as InstanceType<typeof undici.ProxyAgent> })
  return { res: res as unknown as Response, via: new URL(proxy).host }
}

/** Тело ответа, но не больше limit байт (защита от гигантских ответов). */
export async function readLimited(res: Response, limit = 2 * 1024 * 1024): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      throw new Error('ответ больше 2 МБ')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}
