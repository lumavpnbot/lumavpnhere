import crypto from 'node:crypto'

export interface TelegramInitData {
  tgId: number
  username: string | null
  authDate: number
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60 // 24 часа, требование из ТЗ 4.1

/**
 * Проверка подписи Telegram WebApp initData по алгоритму из документации
 * Telegram: secret_key = HMAC_SHA256("WebAppData", bot_token), затем
 * hash = HMAC_SHA256(secret_key, data_check_string). Возвращает null,
 * если подпись невалидна или initData устарела.
 */
export function verifyTelegramInitData(initData: string, botToken: string): TelegramInitData | null {
  if (!initData || !botToken) return null

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (computedHash !== hash) return null

  const authDate = Number(params.get('auth_date') ?? 0)
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null

  const userRaw = params.get('user')
  if (!userRaw) return null

  const user = JSON.parse(userRaw) as { id: number; username?: string }
  return { tgId: user.id, username: user.username ?? null, authDate }
}
