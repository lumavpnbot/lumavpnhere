import crypto from 'node:crypto'

export interface TelegramInitData {
  tgId: number
  username: string | null
  authDate: number
  /** Параметр startapp из ссылки t.me/<bot>?startapp=REF_XXXX (реферал в Mini App). */
  startParam: string | null
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60 // 24 часа, требование из ТЗ 4.1

/**
 * Проверка подписи Telegram WebApp initData по алгоритму из документации
 * Telegram: secret_key = HMAC_SHA256("WebAppData", bot_token), затем
 * hash = HMAC_SHA256(secret_key, data_check_string). Возвращает null,
 * если подпись невалидна или initData устарела.
 */
/**
 * TELEGRAM_BOT_TOKEN может содержать несколько токенов через запятую
 * (например, старый и новый бот на время переезда). Пробелы и кавычки срезаем.
 */
export function parseBotTokens(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean)
}

/** Публичная часть токена (id бота до двоеточия), для диагностики в /health. */
export function botIdOf(token: string): string {
  return token.split(':')[0] ?? '?'
}

export function verifyTelegramInitDataAny(initData: string, botTokens: string[]): TelegramInitData | null {
  for (const token of botTokens) {
    const ok = verifyTelegramInitData(initData, token)
    if (ok) return ok
  }
  return null
}

export function verifyTelegramInitData(initData: string, botToken: string): TelegramInitData | null {
  if (!initData || !botToken) return null

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
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
  return { tgId: user.id, username: user.username ?? null, authDate, startParam: params.get('start_param') }
}
