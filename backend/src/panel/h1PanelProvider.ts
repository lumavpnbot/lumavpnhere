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
  inboundIds: string[]
  timeoutMs?: number
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
      upstreamSubscriptionUrl: upstream,
    }
  }

  async function getClient(tgId: number) {
    const c = unwrap(await call('GET', `/clients/${encodeURIComponent(clientName(tgId))}`))
    return c ? toPanelClient(c) : null
  }

  return {
    kind: 'h1',
    getClient,

    async provision({ tgId, expiresAt, trafficLimitGb, deviceLimit }: ProvisionParams) {
      const name = clientName(tgId)
      const limits = {
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        traffic_limit_gb: trafficLimitGb ?? 0,
        device_limit: deviceLimit ?? 0,
      }

      const existing = await getClient(tgId)
      if (existing) {
        await call('PATCH', `/clients/${encodeURIComponent(name)}`, { ...limits, enable: true })
      } else {
        await call('POST', '/clients', { name, ...limits, inbound_ids: cfg.inboundIds, manual: true })
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
