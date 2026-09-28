export const BRAND = 'LynkVPN'
export const APP_VERSION = '0.3.0'

// TODO: поставить реальный юзернейм бота (без @) через VITE_BOT_USERNAME.
export const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'LynkVPNBot'

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

export type CountryCode = 'nl' | 'de' | 'fi' | 'us' | 'gb' | 'tr' | 'kz' | 'jp'

// Из ТЗ: на старте NL и DE, дальше по мере роста (раздел 7, план масштабирования).
export const COUNTRIES: { code: CountryCode; cityKey?: 'city.ams' | 'city.fra'; live: boolean }[] = [
  { code: 'nl', cityKey: 'city.ams', live: true },
  { code: 'de', cityKey: 'city.fra', live: true },
  { code: 'fi', live: false },
  { code: 'us', live: false },
  { code: 'gb', live: false },
  { code: 'tr', live: false },
  { code: 'kz', live: false },
  { code: 'jp', live: false },
]

// Клиент, через который пользователь подключается (ссылки проверены).
export const CLIENT_APP = {
  name: 'Happ',
  ios: 'https://apps.apple.com/app/happ-proxy-utility/id6504287215',
  android: 'https://play.google.com/store/apps/details?id=com.happproxy',
  site: 'https://www.happ.su/main',
  /** Импорт подписки в один тап. */
  deeplink: (subUrl: string) => `happ://add/${subUrl}`,
}
