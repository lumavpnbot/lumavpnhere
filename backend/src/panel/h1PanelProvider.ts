import { clientName, type PanelClient, type PanelProvider, type ProvisionParams } from './types'

/**
 * Интеграция с H1 Panel (H1Cloud VLESS). Документация: https://my.h1cloud.net/api-docs#h1-panel-api
 *
 *   GET    /api/inbounds            список инбаундов (id берём в H1_INBOUND_IDS)
 *   GET    /api/clients/{name}      клиент
 *   POST   /api/clients             создать { name, expires_at, traffic_limit_gb, device_limit, inbound_ids, manual }
 *   PATCH  /api/clients/{name}      обновить { expires_at, traffic_limit_gb, device_limit, enable }
 *   DELETE /api/clients/{name}      удалить
 * Авторизация: Authorization: Bearer <токен панели> (не ключ аккаунта h1_...).
 *
 * Несколько стран: у H1 есть федерация (главная панель + /api/fed/lproxy/{node_id}/...).
 * Подключим, когда появится второй сервер.
 */

interface H1Client {
  name: string
  uuid: string
  enable?: boolean
  enabled?: boolean
  expires_at?: number | null
  traffic_used_gb?: number
  traffic_limit_gb?: number
  device_limit?: number
  devices_count?: number
  subscription_url?: string
  sub_url?: string
}

export interface H1Config {
  baseUrl: string // например http://fi3.h1cloud.net:25589/api
  token: string
  /** Явные id инбаундов. Если пусто, ищем по inboundTags, а если и их нет, берём все. */
  inboundIds: string[]
  inboundTags?: string[]
  /** Код страны сервера (fi, de, nl…), для списка серверов в Mini App. */
  country?: string
  /** Логические каналы H1 (main, reality, bs, wscdn), см. документацию H1. */
  channels?: string[]
  timeoutMs?: number
}

interface H1Inbound {
  id?: string | number
  tag?: string
  remark?: string
  port?: number
}

export class H1ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function createH1PanelProvider(cfg: H1Config): PanelProvider {
  const base = cfg.baseUrl.replace(/\/+$/, '')

  async function call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
    })
    if (res.status === 404) return null
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T
    if (!res.ok || data.ok === false) {
      throw new H1ApiError(res.status, `H1 ${method} ${path}: ${data.error ?? res.statusText}`)
    }
    return data
  }

  let resolvedInbounds: string[] | null = cfg.inboundIds.length ? cfg.inboundIds : null

  async function listInbounds(): Promise<H1Inbound[]> {
    const data = (await call<unknown>('GET', '/inbounds')) as unknown
    if (Array.isArray(data)) return data as H1Inbound[]
    const d = data as Record<string, unknown> | null
    const list = d && (d.inbounds ?? d.items ?? d.data)
    return Array.isArray(list) ? (list as H1Inbound[]) : []
  }

  async function inboundIds(): Promise<string[]> {
    if (resolvedInbounds) return resolvedInbounds
    const all = await listInbounds()
    const tags = cfg.inboundTags ?? []
    // Теги сравниваем без учёта регистра, и по tag, и по названию (remark).
    // «selfsteal*» в конце со звёздочкой = все инбаунды, чьё имя начинается с selfsteal.
    const wanted = tags.map((t) => t.toLowerCase())
    const matches = (name: string) => {
      const n = name.toLowerCase()
      return wanted.some((w) => (w.endsWith('*') ? n.startsWith(w.slice(0, -1)) : n === w))
    }
    const picked = tags.length ? all.filter((i) => matches(String(i.tag ?? '')) || matches(String(i.remark ?? ''))) : all
    const ids = picked.map((i) => String(i.id ?? '')).filter(Boolean)
    if (!ids.length) throw new Error(`H1: не нашёл инбаунды ${tags.join(',') || '(любые)'} в /api/inbounds`)
    resolvedInbounds = ids
    return ids
  }

  function unwrap(data: unknown): H1Client | null {
    if (!data || typeof data !== 'object') return null
    const d = data as { client?: H1Client } & H1Client
    return d.client ?? (d.uuid ? d : null)
  }

  function toPanelClient(c: H1Client): PanelClient {
    const upstream = [c.subscription_url, c.sub_url].find((u) => u && /^https?:\/\//.test(u)) ?? null
    return {
      name: c.name,
      uuid: c.uuid,
      enabled: c.enable ?? c.enabled ?? true,
      expiresAt: c.expires_at ? new Date(c.expires_at * 1000) : null,
      trafficUsedGb: c.traffic_used_gb ?? 0,
      trafficLimitGb: c.traffic_limit_gb ? c.traffic_limit_gb : null,
      deviceLimit: c.device_limit ? c.device_limit : null,
      devicesCount: c.devices_count ?? 0,
      upstreamSubscriptionUrls: upstream ? [upstream] : [],
    }
  }

  async function getClient(tgId: number) {
    const c = unwrap(await call('GET', `/clients/${encodeURIComponent(clientName(tgId))}`))
    return c ? toPanelClient(c) : null
  }

  return {
    kind: 'h1',
    countries: cfg.country ? [cfg.country] : [],
    getClient,

    async describe() {
      const all = await listInbounds()
      return {
        inbounds: all.map((i) => ({ id: i.id, tag: i.tag ?? i.remark, port: i.port })),
        using: await inboundIds().catch((e: Error) => e.message),
      }
    },

    async provision({ tgId, expiresAt, trafficLimitGb, deviceLimit }: ProvisionParams) {
      const name = clientName(tgId)
      // Панель требует целое days > 0 даже вместе с expires_at (иначе bad_days).
      const days = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000))
      const limits = {
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        traffic_limit_gb: trafficLimitGb ?? 0,
        device_limit: deviceLimit ?? 0,
      }

      const existing = await getClient(tgId)
      if (existing) {
        // set_days: срок заново от сегодня (days в PATCH прибавил бы к текущему).
        // inbound_ids передаём всегда: так новые инбаунды (например hysteria2) добавятся и старым клиентам.
        await call('PATCH', `/clients/${encodeURIComponent(name)}`, {
          ...limits,
          set_days: days,
          enable: true,
          inbound_ids: await inboundIds(),
          ...(cfg.channels?.length ? { channels: cfg.channels } : {}),
        })
      } else {
        await call('POST', '/clients', {
          name,
          days,
          ...limits,
          inbound_ids: await inboundIds(),
          manual: true,
          ...(cfg.channels?.length ? { channels: cfg.channels } : {}),
        })
      }

      const fresh = await getClient(tgId)
      if (!fresh) throw new Error(`H1: клиент ${name} не найден после создания`)
      return fresh
    },

    async disable(tgId) {
      await call('PATCH', `/clients/${encodeURIComponent(clientName(tgId))}`, { enable: false })
    },

    async remove(tgId) {
      await call('DELETE', `/clients/${encodeURIComponent(clientName(tgId))}`)
    },
  }
}
