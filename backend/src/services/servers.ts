import net from 'node:net'

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

/** Список серверов берём из той же переменной, что и панели (H1_PANELS). Токены сюда не попадают. */
function entries(env: NodeJS.ProcessEnv): Entry[] {
  if (env.H1_PANELS) {
    try {
      return (JSON.parse(env.H1_PANELS) as Entry[]).map((e) => ({ country: e.country, url: e.url }))
    } catch {
      return []
    }
  }
  return env.H1_PANEL_URL ? [{ country: env.H1_COUNTRY ?? 'fi', url: env.H1_PANEL_URL }] : []
}

/** Время TCP-подключения к серверу с нашего бэкенда (не пинг пользователя, но показывает, жив ли узел). */
function tcpPing(host: string, port: number, timeoutMs = 3000): Promise<number | null> {
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
