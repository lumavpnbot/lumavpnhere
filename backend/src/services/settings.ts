import type { Prisma, PrismaClient } from '@prisma/client'

export type PaidPlan = 'start' | 'pro'
export type Period = 'month' | 'year'

export interface LevelBonus {
  plan: PaidPlan
  days: number
}

/**
 * Награда за достижение (ТЗ 3.1). days — дни подписки сразу; discount — % на следующие
 * платежи (validDays: срок действия, null = навсегда; reusable: не расходуется);
 * device — бонусные устройства (forever: не сгорают, когда подписка заканчивается).
 */
export interface RewardSpec {
  kind: 'days' | 'discount' | 'device'
  value: number
  validDays?: number | null
  reusable?: boolean
  forever?: boolean
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
  /** Приветствие /start (HTML). Ключ сменён с welcomeText: старое значение из админки больше не используется. */
  welcomeMessage: string
  /** Премиум-эмодзи (custom_emoji_id) на кнопках /start. Пусто = обычные эмодзи 🚀 / 🔁. */
  buttonEmoji: { open: string; transfer: string }
  /** Фото / видео / GIF приветствия (file_id бота); null = только текст. */
  welcomeMedia: { type: 'photo' | 'video' | 'animation'; fileId: string } | null
  defaultPromo: string
  /** Достижения: награды, изменённые из админки (код → награды). */
  achievementRewards: Record<string, RewardSpec[]>
  /** Срок действия разовых скидок за достижения, дней. */
  achievementDiscountDays: number
  /** Потолок суммарной скидки за достижения, %. */
  achievementMaxDiscount: number
  /** Дата запуска сервиса (бейдж «Ранний доступ»: покупка в первые 30 дней). */
  launchDate: string
  /** Перенос подписок: минимальный возраст аккаунта, диапазон дней. */
  transferMinAccountDays: number
  transferMinDays: number
  transferMaxDays: number
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
  welcomeMessage:
    '<b>Привет, это Линк!</b>\n\n' +
    'Мы обеспечиваем стабильное и защищённое соединение доступа к Интернету и зарубежным сервисам для тебя. ' +
    'Ты можешь перенести свою старую подписку на наш сервис одним нажатием\n\n' +
    '<b>Готов начать?</b>',
  buttonEmoji: { open: '', transfer: '' },
  welcomeMedia: null,
  defaultPromo: '',
  achievementRewards: {},
  achievementDiscountDays: 90,
  achievementMaxDiscount: 25,
  launchDate: '2025-09-30',
  transferMinAccountDays: 3,
  transferMinDays: 7,
  transferMaxDays: 90,
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
