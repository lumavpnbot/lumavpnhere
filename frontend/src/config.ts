export const BRAND = 'LynkVPN'
export const APP_VERSION = '0.2.0'

// TODO: поставить реальный юзернейм бота (без @) через VITE_BOT_USERNAME.
export const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'LynkVPNBot'

// TODO: реальные ссылки на поддержку и канал.
export const LINKS = {
  support: `https://t.me/${BOT_USERNAME}`,
  channel: 'https://t.me/',
}

export const PRICES_RUB = {
  start: { month: 149, year: 1250 },
  pro: { month: 249, year: 1990 },
} as const

export const PLANS = [
  { id: 'start', name: 'Старт', devices: 3, traffic: '100 ГБ в месяц' },
  { id: 'pro', name: 'Про', devices: 5, traffic: 'Безлимитный трафик' },
] as const

export type PlanId = (typeof PLANS)[number]['id']

// Клиент, через который пользователь подключается (ссылки проверены).
export const CLIENT_APP = {
  name: 'Happ',
  ios: 'https://apps.apple.com/app/happ-proxy-utility/id6504287215',
  android: 'https://play.google.com/store/apps/details?id=com.happproxy',
  site: 'https://www.happ.su/main',
  /** Импорт подписки в один тап. */
  deeplink: (subUrl: string) => `happ://add/${subUrl}`,
}
