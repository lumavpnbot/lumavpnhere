import crypto from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { clientName, type PanelClient, type PanelProvider, type ProvisionParams } from './types'

/**
 * Панель 3x-ui (MHSanaei) на своём VPS. API:
 *   GET  {base}/panel/api/inbounds/list
 *   GET  {base}/panel/api/inbounds/getClientTraffics/{email}
 *   POST {base}/panel/api/inbounds/addClient           { id, settings: '{"clients":[...]}' }
 *   POST {base}/panel/api/inbounds/updateClient/{uuid} { id, settings }
 *   POST {base}/panel/api/inbounds/{id}/delClient/{uuid}
 * Авторизация: API-токен (Authorization: Bearer) или логин/пароль (cookie после POST /login).
 * У панели обычно самоподписанный сертификат, поэтому проверку TLS можно выключить (insecure).
 *
 * Подписка: встроенный сервис подписок 3x-ui (Настройки → Подписка), ссылка subUrl + subId.
 */

export interface XuiConfig {
  /** Адрес панели вместе с секретным путём, например https://1.2.3.4:14742/AbCdEf */
  baseUrl: string
  token?: string
  username?: string
  password?: string
  country: string
  /** Какие инбаунды выдавать: по названию (remark) или id. Пусто = все включённые VLESS. */
  inbounds: string[]
  /** База ссылки подписки 3x-ui, например https://1.2.3.4:2096/sub/ */
  subUrl?: string
  insecure: boolean
  timeoutMs?: number
}

interface XuiInbound {
  id: number
  remark: string
  port: number
  protocol: string
  enable: boolean
  settings: string
  streamSettings: string
}

interface XuiTraffic {
  email: string
  enable: boolean
  up: number
  down: number
  total: number
  expiryTime: number
}

const GB = 1024 ** 3

export function createXuiPanelProvider(cfg: XuiConfig): PanelProvider {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  let cookie: string | null = null

  function raw(method: string, path: string, body?: string, contentType = 'application/json'): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
    const url = new URL(base + path)
    const lib = url.protocol === 'https:' ? https : http
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`
    if (cookie) headers.Cookie = cookie
    if (body != null) {
      headers['Content-Type'] = contentType
      headers['Content-Length'] = String(Buffer.byteLength(body))
    }
    return new Promise((resolve, reject) => {
      const req = lib.request(
        url,
        { method, headers, rejectUnauthorized: !cfg.insecure, timeout: cfg.timeoutMs ?? 10_000 } as https.RequestOptions,
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
        },
      )
      req.on('timeout', () => req.destroy(new Error(`3x-ui ${cfg.country}: таймаут`)))
      req.on('error', reject)
      if (body != null) req.write(body)
      req.end()
    })
  }

  async function login() {
    if (!cfg.username || !cfg.password) throw new Error(`3x-ui ${cfg.country}: нет токена и логина/пароля`)
    const form = new URLSearchParams({ username: cfg.username, password: cfg.password }).toString()
    const r = await raw('POST', '/login', form, 'application/x-www-form-urlencoded')
    const set = r.headers['set-cookie']
    const parsed = JSON.parse(r.text || '{}') as { success?: boolean; msg?: string }
    if (!parsed.success || !set?.length) throw new Error(`3x-ui ${cfg.country}: вход не удался (${parsed.msg ?? r.status})`)
    cookie = set.map((c) => c.split(';')[0]).join('; ')
  }

  async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!cfg.token && !cookie) await login()
    const send = () => raw(method, path, body === undefined ? undefined : JSON.stringify(body))
    let r = await send()
    // Сессия истекла: 401 или редирект на страницу входа.
    // Сессия истекла или токен не принят: 401 / редирект на вход. Если есть логин и пароль, входим по ним.
    const unauthorized = r.status === 401 || r.status === 302 || r.status === 307 || r.text.trimStart().startsWith('<')
    if (unauthorized && cfg.username && cfg.password) {
      cookie = null
      await login()
      r = await send()
    }
    if (r.status === 404) throw new Error(`3x-ui ${cfg.country}: 404 ${path} (проверьте адрес и секретный путь панели)`)
    let data: { success?: boolean; msg?: string; obj?: T }
    try {
      data = JSON.parse(r.text)
    } catch {
      throw new Error(`3x-ui ${cfg.country}: неожиданный ответ ${r.status} на ${path}`)
    }
    if (data.success === false) throw new Error(`3x-ui ${cfg.country}: ${data.msg ?? 'ошибка'} (${path})`)
    return data.obj as T
  }

  // Один и тот же UUID и subId для пользователя на всех инбаундах (стабильно, без хранения).
  const seed = cfg.token || cfg.password || base
  const uuidFor = (tgId: number) => {
    const h = crypto.createHash('sha256').update(`lynk-xui:${seed}:${tgId}`).digest('hex')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
  }
  const subIdFor = (tgId: number) => crypto.createHash('sha256').update(`lynk-xui-sub:${seed}:${tgId}`).digest('hex').slice(0, 16)
  // В 3x-ui email клиента уникален на всю панель: на первом инбаунде tg_<id>, на остальных tg_<id>_<inbound>.
  const emailFor = (tgId: number, inboundId: number, first: boolean) => (first ? clientName(tgId) : `${clientName(tgId)}_${inboundId}`)

  let inboundCache: { at: number; list: XuiInbound[] } | null = null
  async function inbounds(): Promise<XuiInbound[]> {
    if (inboundCache && Date.now() - inboundCache.at < 60_000) return inboundCache.list
    const all = (await api<XuiInbound[]>('GET', '/panel/api/inbounds/list')) ?? []
    const wanted = cfg.inbounds.map((s) => s.toLowerCase())
    const list = all.filter(
      (i) => i.enable && (wanted.length ? wanted.includes(String(i.id)) || wanted.includes(i.remark.toLowerCase()) : i.protocol === 'vless'),
    )
    if (!list.length) throw new Error(`3x-ui ${cfg.country}: не нашёл инбаунды ${cfg.inbounds.join(',') || '(VLESS)'}`)
    inboundCache = { at: Date.now(), list }
    return list
  }

  function flowFor(inb: XuiInbound) {
    try {
      const st = JSON.parse(inb.streamSettings || '{}') as { network?: string; security?: string }
      return inb.protocol === 'vless' && (st.network ?? 'tcp') === 'tcp' && (st.security === 'reality' || st.security === 'tls') ? 'xtls-rprx-vision' : ''
    } catch {
      return ''
    }
  }

  async function traffic(email: string) {
    return api<XuiTraffic | null>('GET', `/panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`).catch(() => null)
  }

  async function upsertClient(tgId: number, params: ProvisionParams | null, enable: boolean) {
    const list = await inbounds()
    const uuid = uuidFor(tgId)
    const subId = subIdFor(tgId)
    for (const [i, inb] of list.entries()) {
      const email = emailFor(tgId, inb.id, i === 0)
      const existing = await traffic(email)
      if (!params && !existing) continue // отключать нечего
      const client = {
        id: uuid,
        flow: flowFor(inb),
        email,
        limitIp: params?.deviceLimit ?? 0,
        totalGB: params?.trafficLimitGb ? Math.round(params.trafficLimitGb * GB) : existing?.total ?? 0,
        expiryTime: params ? params.expiresAt.getTime() : existing?.expiryTime ?? 0,
        enable,
        tgId: '',
        subId,
        reset: 0,
      }
      const body = { id: inb.id, settings: JSON.stringify({ clients: [client] }) }
      if (existing) await api('POST', `/panel/api/inbounds/updateClient/${uuid}`, body)
      else await api('POST', '/panel/api/inbounds/addClient', body)
    }
  }

  async function getClient(tgId: number): Promise<PanelClient | null> {
    const t = await traffic(clientName(tgId))
    if (!t) return null
    const subBase = cfg.subUrl ? cfg.subUrl.replace(/\/?$/, '/') : null
    return {
      name: clientName(tgId),
      uuid: uuidFor(tgId),
      enabled: t.enable && (!t.expiryTime || t.expiryTime > Date.now()),
      expiresAt: t.expiryTime ? new Date(t.expiryTime) : null,
      trafficUsedGb: Math.round(((t.up + t.down) / GB) * 100) / 100,
      trafficLimitGb: t.total ? Math.round((t.total / GB) * 100) / 100 : null,
      deviceLimit: null,
      devicesCount: 0,
      upstreamSubscriptionUrls: subBase ? [`${subBase}${subIdFor(tgId)}`] : [],
    }
  }

  return {
    kind: 'h1',
    countries: [cfg.country],
    getClient,

    async provision(params) {
      await upsertClient(params.tgId, params, true)
      const c = await getClient(params.tgId)
      if (!c) throw new Error(`3x-ui ${cfg.country}: клиент ${clientName(params.tgId)} не появился после создания`)
      return c
    },

    async disable(tgId) {
      await upsertClient(tgId, null, false)
    },

    async remove(tgId) {
      const list = await inbounds()
      for (const inb of list) {
        await api('POST', `/panel/api/inbounds/${inb.id}/delClient/${uuidFor(tgId)}`).catch(() => undefined)
      }
    },

    async describe() {
      const all = (await api<XuiInbound[]>('GET', '/panel/api/inbounds/list')) ?? []
      return {
        panel: '3x-ui',
        inbounds: all.map((i) => ({ id: i.id, tag: i.remark, port: i.port, protocol: i.protocol, enable: i.enable })),
        using: await inbounds().then(
          (l) => l.map((i) => i.remark || String(i.id)),
          (e: Error) => e.message,
        ),
        subscription: cfg.subUrl ? 'включена' : 'нет subUrl: подписка не склеится',
      }
    },
  }
}
