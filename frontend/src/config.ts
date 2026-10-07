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
  start: { month: 50, year: 800 },
  pro: { month: 100, year: 1600 },
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

export const REFERRAL = { percent: 30, holdDays: 7 }

export type CountryCode = 'fi' | 'nl' | 'de' | 'ru' | 'se' | 'pl' | 'gb' | 'tr' | 'kz' | 'jp' | 'us'

/*
 * Все страны, которые показываем. Какие из них реально работают, приходит
 * с бэкенда (/me → countries, по списку панелей в H1_PANELS). Остальные «Скоро».
 */
export const COUNTRIES: CountryCode[] = ['fi', 'nl', 'de', 'ru', 'se', 'pl', 'gb', 'tr', 'kz', 'jp']

/** Что показать, пока бэкенд не ответил или в демо-режиме. */
export const DEFAULT_LIVE: CountryCode[] = ['fi']

export type ClientId = 'happ' | 'incy' | 'hiddify'

export interface ClientApp {
  id: ClientId
  name: string
  ios: string
  android: string
  /** Сайт или страница загрузок для остальных ОС. */
  site: string
  /** Импорт подписки в один тап (работает вне Telegram; внутри Mini App используем openUrls с бэкенда). */
  deeplink: (subUrl: string) => string
}

// Клиенты, через которые пользователь подключается. Первый: по умолчанию.
export const CLIENT_APPS: ClientApp[] = [
  {
    id: 'happ',
    name: 'Happ',
    ios: 'https://apps.apple.com/app/happ-proxy-utility/id6504287215',
    android: 'https://play.google.com/store/apps/details?id=com.happproxy',
    site: 'https://www.happ.su/main',
    deeplink: (subUrl) => `happ://add/${subUrl}`,
  },
  {
    id: 'incy',
    name: 'INCY',
    ios: 'https://apps.apple.com/ru/app/incy/id6756943388',
    android: 'https://play.google.com/store/apps/details?id=llc.itdev.incy',
    site: 'https://github.com/INCY-DEV/incy-platforms#downloads',
    deeplink: (subUrl) => `incy://add/${subUrl}`,
  },
  {
    id: 'hiddify',
    name: 'Hiddify',
    ios: 'https://apps.apple.com/app/id6596777532',
    android: 'https://play.google.com/store/apps/details?id=app.hiddify.com',
    site: 'https://github.com/hiddify/hiddify-app/releases/latest',
    deeplink: (subUrl) => `hiddify://import/${subUrl}#${BRAND}`,
  },
]
