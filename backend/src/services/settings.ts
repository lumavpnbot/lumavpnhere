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

/** Сектор колеса фортуны: сколько билетов даёт и с каким шансом (%). */
export interface WheelSector {
  tickets: number
  chance: number
}

/**
 * Приз розыгрыша. reward = что начисляем победителю автоматически (подписка),
 * null = физический приз, его выдаёт администрация вручную.
 */
export interface HalloweenPrize {
  code: string
  title: string
  place: number
  count: number
  reward: { plan: PaidPlan; days: number } | null
}

/** Хэллоуин-розыгрыш: даты, билеты, колесо, призы. Всё меняется из админ-меню. */
export interface HalloweenSettings {
  enabled: boolean
  /** ISO-даты: старт, конец приёма билетов, розыгрыш. */
  startAt: string
  ticketsUntil: string
  drawAt: string
  /** Приём билетов закрыт досрочно кнопкой в админке. */
  intakeClosed: boolean
  ticketsForJoin: number
  ticketsForPaid: number
  /** Холд на билеты за оплату друга: отменённый платёж аннулирует их. */
  holdDays: number
  maxTickets: number
  maxReferralTickets: number
  maxWheelTickets: number
  wheel: {
    enabled: boolean
    sectors: WheelSector[]
    spinsPerDay: number
    /** Сколько дней подписки должно оставаться на момент спина. */
    minSubDays: number
    /** Через сколько часов после активации подписки доступен первый спин. */
    firstSpinAfterHours: number
  }
  prizes: HalloweenPrize[]
  /** Утешительная скидка всем участникам с билетами: % и срок действия. */
  consolationPercent: number
  consolationDays: number
}

/** Пакет трафика «на месяц»: сколько ГБ и за сколько рублей. */
export interface TrafficPack {
  gb: number
  price: number
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
  /** Когда включили чеки «Мой налог» (ISO): чеки выдаются только по оплатам после этого момента. */
  npdEnabledAt: string
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
  /** Просить в боте оценить сервис (через 3 дня после подключения или день после первой оплаты). */
  reviewAskEnabled: boolean
  /** Докупка трафика на 30 дней (только тарифы с лимитом ГБ, то есть Старт). */
  trafficPacks: TrafficPack[]
  /** Докупка устройства: цена одного устройства на 30 дней и сколько можно докупить сверх тарифа. */
  devicePrice: number
  maxExtraDevices: number
  /** Доплата за переход Старт → Премиум за каждые 30 оставшихся дней. null = разница месячных цен. */
  upgradePer30d: number | null
  halloween: HalloweenSettings
}

/** Хэллоуин: 21 приз в пяти категориях (главный выдаёт администрация, подписки начисляются сами). */
export const DEFAULT_HALLOWEEN: HalloweenSettings = {
  enabled: true,
  startAt: '2026-10-24T00:00:00+03:00',
  ticketsUntil: '2026-10-31T23:59:00+03:00',
  drawAt: '2026-11-01T12:00:00+03:00',
  intakeClosed: false,
  ticketsForJoin: 1,
  ticketsForPaid: 3,
  holdDays: 7,
  maxTickets: 100,
  maxReferralTickets: 30,
  maxWheelTickets: 30,
  wheel: {
    enabled: true,
    sectors: [
      { tickets: 0, chance: 55 },
      { tickets: 1, chance: 25 },
      { tickets: 2, chance: 13 },
      { tickets: 3, chance: 5 },
      { tickets: 5, chance: 2 },
    ],
    spinsPerDay: 1,
    minSubDays: 3,
    firstSpinAfterHours: 24,
  },
  prizes: [
    { code: 'airpods', title: 'AirPods 3 Pro', place: 1, count: 1, reward: null },
    { code: 'pro_year', title: '1 год Премиум', place: 2, count: 2, reward: { plan: 'pro', days: 365 } },
    { code: 'pro_6m', title: '6 месяцев Премиум', place: 3, count: 3, reward: { plan: 'pro', days: 183 } },
    { code: 'start_3m', title: '3 месяца Старт', place: 4, count: 5, reward: { plan: 'start', days: 92 } },
    { code: 'start_1m', title: '1 месяц Старт', place: 5, count: 10, reward: { plan: 'start', days: 30 } },
  ],
  consolationPercent: 20,
  consolationDays: 30,
}

export const DEFAULT_SETTINGS: AppSettings = {
  prices: { start: { month: 50, year: 800 }, pro: { month: 100, year: 1600 } },
  trialDays: 3,
  trialDaysReferral: 4,
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
  npdEnabledAt: '',
  defaultPromo: '',
  achievementRewards: {},
  achievementDiscountDays: 90,
  achievementMaxDiscount: 25,
  launchDate: '2025-09-30',
  transferMinAccountDays: 3,
  transferMinDays: 7,
  transferMaxDays: 90,
  reviewAskEnabled: true,
  trafficPacks: [
    { gb: 50, price: 25 },
    { gb: 150, price: 60 },
  ],
  devicePrice: 20,
  maxExtraDevices: 5,
  upgradePer30d: null,
  halloween: DEFAULT_HALLOWEEN,
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

/** Настройки Хэллоуина поверх значений по умолчанию: в сохранённом из админки JSON может не быть новых полей. */
export const halloweenOf = (s: AppSettings): HalloweenSettings => ({
  ...DEFAULT_HALLOWEEN,
  ...s.halloween,
  wheel: { ...DEFAULT_HALLOWEEN.wheel, ...s.halloween?.wheel },
})

/** Доплата за 30 дней при переходе Старт → Премиум (из настроек или разница месячных цен). */
export const upgradeRate = (s: AppSettings) => s.upgradePer30d ?? Math.max(0, s.prices.pro.month - s.prices.start.month)

/** Индекс уровня по числу активных рефералов. */
export function levelFor(activeReferrals: number, s: AppSettings): number {
  let level = 0
  s.levelThresholds.forEach((min, i) => {
    if (activeReferrals >= min) level = i
  })
  return level
}
