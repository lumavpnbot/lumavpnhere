import net from 'node:net'
import { disabledCountries, h1DisabledCountries } from '@/lib/countries'

export interface ServerStatus {
  country: string
  host: string
  online: boolean
  pingMs: number | null
}

interface Entry {
  country: string
  url: string
}

/**
 * Список серверов берём из той же переменной, что и панели (H1_PANELS). Токены сюда не попадают.
 * Страны из DISABLED_COUNTRIES пропускаем.
 */
export function entries(env: NodeJS.ProcessEnv): Entry[] {
  let list: Entry[] = []
  if (env.H1_PANELS) {
    try {
      list = (JSON.parse(env.H1_PANELS) as Entry[]).map((e) => ({ country: e.country, url: e.url }))
    } catch {
      return []
    }
  } else if (env.H1_PANEL_URL) {
    list = [{ country: env.H1_COUNTRY ?? 'fi', url: env.H1_PANEL_URL }]
  }
  const h1Off = h1DisabledCountries(env)
  list = list.filter((e) => !h1Off.has(String(e.country).toLowerCase()))
  // Свои серверы с 3x-ui (XUI_PANELS).
  if (env.XUI_PANELS) {
    const off = disabledCountries(env)
    try {
      const own = (JSON.parse(env.XUI_PANELS) as Entry[]).map((e) => ({ country: e.country, url: e.url }))
      list = [...list, ...own.filter((e) => !off.has(String(e.country).toLowerCase()))]
    } catch {
      /* неверный JSON: ошибку покажет createPanelProvider */
    }
  }
  return list
}

/** Время TCP-подключения к серверу с нашего бэкенда (не пинг пользователя, но показывает, жив ли узел). */
export function tcpPing(host: string, port: number, timeoutMs = 3000): Promise<number | null> {
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

export function createServerStatus(env: NodeJS.ProcessEnv) {
  let cache: { at: number; list: ServerStatus[] } | null = null

  async function list(force = false): Promise<ServerStatus[]> {
    if (!force && cache && Date.now() - cache.at < 60_000) return cache.list
    const result = await Promise.all(
      entries(env).map(async (e) => {
        let host = ''
        let port = 443
        try {
          const u = new URL(e.url)
          host = u.hostname
          port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
        } catch {
          return { country: e.country, host: '?', online: false, pingMs: null }
        }
        const pingMs = await tcpPing(host, port)
        return { country: e.country, host, online: pingMs != null, pingMs }
      }),
    )
    cache = { at: Date.now(), list: result }
    return result
  }

  return { list }
}

export type ServerStatusService = ReturnType<typeof createServerStatus>
