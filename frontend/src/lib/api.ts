import { getInitData } from './telegram'

export const API_BASE = import.meta.env.VITE_API_URL ?? ''

/** Пока бэкенд нигде не задеплоен, приложение работает на демо-данных. */
export const apiEnabled = API_BASE.length > 0

/**
 * Авторизация — через Telegram initData в заголовке (бэкенд проверяет HMAC
 * по токену бота), без паролей и токенов на фронте.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Сколько ждём ответа сервера: зависший запрос иначе держал экран пустым без объяснений. */
const TIMEOUT_MS = 20_000

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // AbortSignal.timeout есть не во всех WebView (iOS 15), поэтому вручную.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        'X-Telegram-Init-Data': getInitData(),
        ...options.headers,
      },
    })
  } catch (err) {
    throw new ApiError(0, controller.signal.aborted ? 'сервер не ответил вовремя' : 'нет соединения с сервером')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let message = body || res.statusText
    try {
      const parsed = JSON.parse(body) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      /* не JSON */
    }
    throw new ApiError(res.status, message)
  }

  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
}
