import type { Prisma, PrismaClient } from '@prisma/client'

export type PaidPlan = 'start' | 'pro'
export type Period = 'month' | 'year'

export interface LevelBonus {
  plan: PaidPlan
  days: number
}

/** Всё, что команда может менять из админ-меню в боте, без деплоя. */
export interface AppSettings {
  prices: Record<PaidPlan, Record<Period, number>>
  trialDays: number
  trialDaysReferral: number
  /** Проценты по уровням: Базовый, Серебро, Золото, Платина. */
  referralPercents: [number, number, number, number]
  /** Сколько активных рефералов нужно для уровня. */
  levelThresholds: [number, number, number, number]
  levelBonuses: [LevelBonus | null, LevelBonus | null, LevelBonus | null, LevelBonus | null]
  holdDays: number
  /** Скидка на автопродление через Stars/крипту, %. */
  autoRenewDiscount: number
  /** Сколько рублей стоит 1 Telegram Star для покупателя (для пересчёта цены). */
  starsRubRate: number
  maintenance: boolean
  welcomeText: string
  defaultPromo: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  prices: { start: { month: 80, year: 800 }, pro: { month: 160, year: 1600 } },
  trialDays: 7,
  trialDaysReferral: 10,
  referralPercents: [30, 35, 40, 45],
  levelThresholds: [0, 5, 20, 50],
  levelBonuses: [null, { plan: 'start', days: 14 }, { plan: 'pro', days: 30 }, { plan: 'pro', days: 60 }],
  holdDays: 7,
  autoRenewDiscount: 5,
  starsRubRate: 1.8,
  maintenance: false,
  welcomeText:
    '<b>LYNK</b>: быстрое и защищённое соединение прямо в Telegram.\n\nОткройте приложение кнопкой ниже: первые 7 дней бесплатно, настройка занимает минуту.',
  defaultPromo: '',
}

export const LEVEL_NAMES = ['Базовый', 'Серебро', 'Золото', 'Платина'] as const

export function createSettingsService(prisma: PrismaClient) {
  let cache: { at: number; value: AppSettings } | null = null

  async function get(): Promise<AppSettings> {
    if (cache && Date.now() - cache.at < 30_000) return cache.value
    const rows = await prisma.setting.findMany()
    const value: AppSettings = { ...DEFAULT_SETTINGS }
    for (const row of rows) {
      if (row.key in value) (value as unknown as Record<string, unknown>)[row.key] = row.value
    }
    cache = { at: Date.now(), value }
    return value
  }

  async function set<K extends keyof AppSettings>(key: K, v: AppSettings[K]) {
    const json = v as unknown as Prisma.InputJsonValue
    await prisma.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
    cache = null
  }

  return { get, set }
}

export type SettingsService = ReturnType<typeof createSettingsService>

/** Индекс уровня по числу активных рефералов. */
export function levelFor(activeReferrals: number, s: AppSettings): number {
  let level = 0
  s.levelThresholds.forEach((min, i) => {
    if (activeReferrals >= min) level = i
  })
  return level
}
