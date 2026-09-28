export const BRAND = 'LynkVPN'
export const APP_VERSION = '0.3.0'

export const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'vpnlynkbot'

export const LINKS = {
  support: 'https://t.me/lynkvpnsupportbot',
  channel: 'https://t.me/lumaVPN_service',
}

export const PRICES_RUB = {
  start: { month: 149, year: 1250 },
  pro: { month: 249, year: 1990 },
} as const

export const PLANS = [
  { id: 'start', nameKey: 'plan.start', trafficKey: 'plan.startTraffic', devices: 3 },
  { id: 'pro', nameKey: 'plan.pro', trafficKey: 'plan.proTraffic', devices: 5 },
] as const

export type PlanId = (typeof PLANS)[number]['id']

export const REFERRAL = { percent: 30, minPayout: 500 }

export type CountryCode = 'fi' | 'nl' | 'de' | 'se' | 'pl' | 'us' | 'gb' | 'tr' | 'kz' | 'jp'

/*
 * Все страны, которые показываем. Какие из них реально работают, приходит
 * с бэкенда (/me → countries, по списку панелей в H1_PANELS). Остальные «Скоро».
 */
export const COUNTRIES: CountryCode[] = ['fi', 'nl', 'de', 'se', 'pl', 'us', 'gb', 'tr', 'kz', 'jp']

/** Что показать, пока бэкенд не ответил или в демо-режиме. */
export const DEFAULT_LIVE: CountryCode[] = ['fi']

// Клиент, через который пользователь подключается (ссылки проверены).
export const CLIENT_APP = {
  name: 'Happ',
  ios: 'https://apps.apple.com/app/happ-proxy-utility/id6504287215',
  android: 'https://play.google.com/store/apps/details?id=com.happproxy',
  site: 'https://www.happ.su/main',
  /** Импорт подписки в один тап (работает вне Telegram; внутри Mini App используем happUrl с бэкенда). */
  deeplink: (subUrl: string) => `happ://add/${subUrl}`,
}
