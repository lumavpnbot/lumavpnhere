export const BRAND = 'LYNK'
export const APP_VERSION = '0.3.0'

export const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'lynkorobot'

export const LINKS = {
  support: 'https://t.me/lynkvpnsupportbot',
  channel: 'https://t.me/lumaVPN_service',
}

/** Документы лежат рядом с Mini App (frontend/public/*.html). */
const pageUrl = (file: string) => new URL(file, window.location.href.split('#')[0]).href
export const DOCS = {
  terms: pageUrl('terms.html'),
  privacy: pageUrl('privacy.html'),
}
export type DocId = keyof typeof DOCS

/** Цены по умолчанию (ТЗ 4). Актуальные приходят с бэкенда и меняются из админ-меню. */
export const PRICES_RUB: Record<'start' | 'pro', Record<'month' | 'year', number>> = {
  start: { month: 80, year: 800 },
  pro: { month: 160, year: 1600 },
}

export const PLANS = [
  {
    id: 'start',
    nameKey: 'plan.start',
    trafficKey: 'plan.startTraffic',
    devices: 3,
    features: ['feat.devices3', 'feat.traffic100', 'feat.allLocations', 'feat.speed100', 'feat.support'],
  },
  {
    id: 'pro',
    nameKey: 'plan.pro',
    trafficKey: 'plan.proTraffic',
    devices: 5,
    features: ['feat.devices5', 'feat.unlimited', 'feat.priority', 'feat.noSpeedLimit', 'feat.prioritySupport', 'feat.earlyAccess'],
  },
] as const

export type PlanId = (typeof PLANS)[number]['id']

export const REFERRAL = { percent: 30, holdDays: 7, trialBonusDays: 3 }

export type CountryCode = 'fi' | 'nl' | 'de' | 'ru' | 'se' | 'pl' | 'us' | 'gb' | 'tr' | 'kz' | 'jp'

/*
 * Все страны, которые показываем. Какие из них реально работают, приходит
 * с бэкенда (/me → countries, по списку панелей в H1_PANELS). Остальные «Скоро».
 */
export const COUNTRIES: CountryCode[] = ['fi', 'nl', 'de', 'us', 'ru', 'se', 'pl', 'gb', 'tr', 'kz', 'jp']

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
