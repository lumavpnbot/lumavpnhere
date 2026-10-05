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

/** Панель ответила, но отказала (success: false): она жива, это не «лежит». */
export class XuiApiError extends Error {}
class XuiNotFound extends Error {}

export function createXuiPanelProvider(cfg: XuiConfig): PanelProvider {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const cookies = new Map<string, string>()
  let csrf: string | null = null
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  const keepCookies = (set: string[] | undefined) => {
    for (const c of set ?? []) {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
    }
  }

  function raw(method: string, path: string, body?: string, contentType = 'application/json'): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
    const url = new URL(base + path)
    const lib = url.protocol === 'https:' ? https : http
    // X-Requested-With: без него 3x-ui v3 на неавторизованный запрос отвечает 404, а не 401.
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`
    if (cookies.size) headers.Cookie = cookieHeader()
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf
    if (body != null) {
      headers['Content-Type'] = contentType
      headers['Content-Length'] = String(Buffer.byteLength(body))
    }
    return new Promise((resolve, reject) => {
      const req = lib.request(
        url,
        { method, headers, rejectUnauthorized: !cfg.insecure, timeout: cfg.timeoutMs ?? 5_000 } as https.RequestOptions,
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

  /** CSRF-токен сессии (3x-ui v3 требует его на вход и на все POST без API-токена). Старые версии: 404, пропускаем. */
  async function fetchCsrf() {
    const r = await raw('GET', '/csrf-token')
    keepCookies(r.headers['set-cookie'])
    if (r.status !== 200) return
    try {
      const j = JSON.parse(r.text) as { obj?: string }
      if (typeof j.obj === 'string') csrf = j.obj
    } catch {
      /* старая версия без CSRF */
    }
  }

  async function login() {
    if (!cfg.username || !cfg.password) throw new Error(`3x-ui ${cfg.country}: нет токена и логина/пароля`)
    cookies.clear()
    csrf = null
    await fetchCsrf()
    const form = new URLSearchParams({ username: cfg.username, password: cfg.password }).toString()
    const r = await raw('POST', '/login', form, 'application/x-www-form-urlencoded')
    keepCookies(r.headers['set-cookie'])
    let parsed: { success?: boolean; msg?: string } = {}
    try {
      parsed = JSON.parse(r.text || '{}')
    } catch {
      /* HTML вместо JSON */
    }
    if (!parsed.success) throw new Error(`3x-ui ${cfg.country}: вход не удался (${parsed.msg ?? r.status})`)
    // После входа сессия новая: берём её CSRF-токен.
    await fetchCsrf()
    loggedIn = true
  }
  let loggedIn = false

  async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!cfg.token && !loggedIn) await login()
    const send = () => raw(method, path, body === undefined ? undefined : JSON.stringify(body))
    let r = await send()
    // Сессия истекла: 401 или редирект на страницу входа.
    // Сессия истекла или токен не принят: 401 / редирект на вход. Если есть логин и пароль, входим по ним.
    const unauthorized = r.status === 401 || r.status === 403 || r.status === 302 || r.status === 307 || r.text.trimStart().startsWith('<')
    if (unauthorized && cfg.username && cfg.password) {
      loggedIn = false
      await login()
      r = await send()
    }
    if (r.status === 401 || r.status === 403) throw new Error(`3x-ui ${cfg.country}: доступ запрещён (${r.status}): проверьте API-токен или логин/пароль`)
    if (r.status === 404) throw new XuiNotFound(`3x-ui ${cfg.country}: 404 ${path} (проверьте адрес и секретный путь панели)`)
    let data: { success?: boolean; msg?: string; obj?: T }
    try {
      data = JSON.parse(r.text)
    } catch {
      throw new Error(`3x-ui ${cfg.country}: неожиданный ответ ${r.status} на ${path}`)
    }
    if (data.success === false) throw new XuiApiError(`3x-ui ${cfg.country}: ${data.msg ?? 'ошибка'} (${path})`)
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

  /**
   * 3x-ui v3 (с разделом «Клиенты»): клиент один на всю панель, API /panel/api/clients/*.
   * Старые версии: клиенты внутри инбаунда, /panel/api/inbounds/addClient и т.п.
   */
  let v3: boolean | null = null
  async function isV3() {
    if (v3 != null) return v3
    try {
      await api('GET', '/panel/api/clients/traffic/__lynk_probe__')
      v3 = true
    } catch (e) {
      if (e instanceof XuiNotFound) v3 = false
      else throw e
    }
    return v3
  }

  async function traffic(email: string) {
    if (await isV3()) {
      return api<XuiTraffic | null>('GET', `/panel/api/clients/traffic/${encodeURIComponent(email)}`).catch((e) => {
        if (e instanceof XuiApiError) return null
        throw e
      })
    }
    // «Клиента нет» = null. Таймаут и сетевые ошибки пробрасываем: иначе лежащая панель выглядит
    // как «клиента нет», каждый запрос подписки ждёт её таймаут, и Happ обрывает добавление.
    return api<XuiTraffic | null>('GET', `/panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`).catch((e) => {
      if (e instanceof XuiApiError) return null
      throw e
    })
  }

  async function upsertClientV3(tgId: number, params: ProvisionParams | null, enable: boolean) {
    const list = await inbounds()
    const email = clientName(tgId)
    const existing = await traffic(email)
    if (!params && !existing) return
    const client = {
      id: uuidFor(tgId),
      flow: list.some((i) => flowFor(i)) ? 'xtls-rprx-vision' : '',
      email,
      limitIp: params?.deviceLimit ?? 0,
      totalGB: params?.trafficLimitGb ? Math.round(params.trafficLimitGb * GB) : existing?.total ?? 0,
      expiryTime: params ? params.expiresAt.getTime() : existing?.expiryTime ?? 0,
      enable,
      tgId: 0,
      subId: subIdFor(tgId),
      reset: 0,
    }
    const inboundIds = list.map((i) => i.id)
    if (existing) {
      await api('POST', `/panel/api/clients/update/${encodeURIComponent(email)}`, client)
      // Инбаунд добавили позже: привязываем клиента и к нему (уже привязанные пропускаются).
      if (params) await api('POST', `/panel/api/clients/${encodeURIComponent(email)}/attach`, { inboundIds }).catch(() => undefined)
    } else {
      await api('POST', '/panel/api/clients/add', { client, inboundIds })
    }
  }

  async function upsertClient(tgId: number, params: ProvisionParams | null, enable: boolean) {
    if (await isV3()) return upsertClientV3(tgId, params, enable)
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
        tgId: 0,
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
    // v3: ссылки берём прямо из API панели (не зависим от порта и пути сервиса подписок).
    const links = (await isV3()) ? await linksFor(clientName(tgId)) : null
    return {
      name: clientName(tgId),
      uuid: uuidFor(tgId),
      enabled: t.enable && (!t.expiryTime || t.expiryTime > Date.now()),
      expiresAt: t.expiryTime ? new Date(t.expiryTime) : null,
      trafficUsedGb: Math.round(((t.up + t.down) / GB) * 100) / 100,
      trafficLimitGb: t.total ? Math.round((t.total / GB) * 100) / 100 : null,
      deviceLimit: null,
      devicesCount: 0,
      upstreamSubscriptionUrls: links?.length ? [] : subBase ? [`${subBase}${subIdFor(tgId)}`] : [],
      links: links ?? [],
    }
  }

  const linkCache = new Map<string, { at: number; links: string[] }>()
  async function linksFor(email: string): Promise<string[] | null> {
    const hit = linkCache.get(email)
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.links
    try {
      const raw = (await api<unknown>('GET', `/panel/api/clients/links/${encodeURIComponent(email)}`)) ?? []
      const links = (Array.isArray(raw) ? raw : []).filter((l): l is string => typeof l === 'string' && /^[a-z0-9]+:\/\//i.test(l))
      if (links.length) {
        linkCache.set(email, { at: Date.now(), links })
        if (linkCache.size > 5000) linkCache.delete(linkCache.keys().next().value!)
      }
      return links
    } catch {
      return null // запасной путь: ссылка подписки subUrl
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
      if (await isV3()) {
        await api('POST', `/panel/api/clients/del/${encodeURIComponent(clientName(tgId))}`).catch(() => undefined)
        return
      }
      const list = await inbounds()
      for (const inb of list) {
        await api('POST', `/panel/api/inbounds/${inb.id}/delClient/${uuidFor(tgId)}`).catch(() => undefined)
      }
    },

    async describe() {
      const all = (await api<XuiInbound[]>('GET', '/panel/api/inbounds/list')) ?? []
      return {
        panel: (await isV3().catch(() => null)) ? '3x-ui v3' : '3x-ui',
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
