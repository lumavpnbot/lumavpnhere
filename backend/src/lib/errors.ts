/** Последние ошибки бэкенда в памяти, для раздела «Логи» в админ-меню. */
export interface ErrorEntry {
  at: Date
  where: string
  message: string
}

const MAX = 200
const buffer: ErrorEntry[] = []

export function recordError(where: string, err: unknown) {
  buffer.push({ at: new Date(), where, message: err instanceof Error ? err.message : String(err) })
  if (buffer.length > MAX) buffer.shift()
}

export function recentErrors(hours = 24): ErrorEntry[] {
  const since = Date.now() - hours * 3600_000
  return buffer.filter((e) => e.at.getTime() >= since).reverse()
}

/** Последние запросы подписки (для диагностики устройств в админ-меню). */
export interface SubRequest {
  at: Date
  tgId: number
  ua: string
  hwid: boolean
  os: string | null
  model: string | null
  /** Что ответили клиенту: код, время и причина (кэш, нет подписки, панель не ответила…). */
  status?: number
  ms?: number
  note?: string
}
const subRequests: SubRequest[] = []
export function recordSubRequest(r: SubRequest) {
  subRequests.push(r)
  if (subRequests.length > 50) subRequests.shift()
}
export function recentSubRequests(): SubRequest[] {
  return [...subRequests].reverse()
}
