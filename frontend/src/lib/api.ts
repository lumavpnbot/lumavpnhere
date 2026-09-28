import { getInitData } from './telegram'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/**
 * Единая точка входа для запросов к бэкенду. Авторизация — через
 * Telegram initData в заголовке (бэкенд валидирует HMAC подписи бота),
 * без паролей и токенов на фронте.
 */
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
    throw new Error(`API ${res.status}: ${body || res.statusText}`)
  }

  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
}
