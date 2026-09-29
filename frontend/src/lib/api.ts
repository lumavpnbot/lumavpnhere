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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': getInitData(),
      ...options.headers,
    },
  })

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
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
}
