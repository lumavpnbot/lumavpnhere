import { create } from 'zustand'
import { DEFAULT_LIVE, PRICES_RUB, type ClientId, type CountryCode, type PlanId } from '@/config'
import type { Lang } from '@/i18n'
import { getTelegramUser } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'
import { load, loadString, save } from '@/lib/storage'

export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'expired'

export interface Subscription {
  status: SubscriptionStatus
  plan: PlanId | null
  startedAt: string | null
  expiresAt: string | null
  trafficUsedGb: number
  trafficLimitGb: number | null // null = безлимит
  subscriptionUrl: string | null
  /** https-страница бэкенда, которая открывает happ://add/... во внешнем браузере. */
  happUrl?: string | null
  /** То же для каждого клиента: /open/happ|incy|hiddify/<токен>. */
  openUrls?: Partial<Record<ClientId, string | null>> | null
  autoRenew?: boolean
}

export interface Device {
  id: string
  label: string
  platform: string
  lastSeenAt: string
}

export interface Transaction {
  id: string
  kind: 'topup' | 'referral' | 'purchase' | 'bonus' | 'refund'
  amount: number // ₽, со знаком
  plan?: PlanId
  at: string
}

export interface Profile {
  tgId: number | null
  username: string | null
  firstName: string | null
  photoUrl: string | null
  registeredAt: string | null
  email: string | null
  devicesLimit: number
  balance: number
  referralsCount: number
  referralsActive: number
  referralEarned: number
  referralLevel: number
  referralPercent: number
  referralLink: string | null
  defaultPromo: string | null
  isAdmin?: boolean
  /** ТЗ v6.3: бонусные устройства и скидка за достижения, закреплённые бейджи. */
  bonusDevices?: number
  rewardDiscount?: number
  achievementsUnlocked?: number
  showcase?: ShowcaseItem[]
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface ShowcaseItem {
  slot: number
  code: string
  rarity: Rarity
  title: string
}

export interface StatusNode {
  id: string
  country: string | null
  online: boolean
  pingMs: number | null
  checkedAt: string | null
  uptime24h: number | null
  uptime30d: number | null
  hourly: (number | null)[]
}

export interface Incident {
  id: string
  title: string
  text: string | null
  severity: 'minor' | 'major'
  status: 'open' | 'resolved'
  node: string | null
  auto: boolean
  eta: string | null
  startedAt: string
  resolvedAt: string | null
}

export interface StatusSnapshot {
  overall: 'ok' | 'degraded' | 'down'
  updatedAt: string
  eta: string | null
  nodes: StatusNode[]
  openIncidents: Incident[]
  incidents: Incident[]
}

export type Prices = Record<PlanId, Record<'month' | 'year', number>>

export interface ServerInfo {
  country: CountryCode
  online: boolean
  pingMs: number | null
}

export interface NotificationPrefs {
  expiry: boolean
  expiryDays: number
  traffic: boolean
  trafficAt: number
  news: boolean
  promo: boolean
}

interface AppState {
  lang: Lang
  profile: Profile
  subscription: Subscription
  devices: Device[]
  transactions: Transaction[]
  liveCountries: CountryCode[]
  servers: ServerInfo[]
  status: StatusSnapshot | null
  prices: Prices
  maintenance: boolean
  prefs: NotificationPrefs
  demo: boolean
  loaded: boolean
  error: string | null
  bootstrap: () => Promise<void>
  /** Перезагрузить /me (после оплаты, промокода и т.п.). */
  refresh: () => Promise<void>
  loadServers: () => Promise<void>
  /** Статус сервиса (виджет на главной и экран «Статус»). */
  loadStatus: () => Promise<void>
  setAutoRenew: (enabled: boolean) => Promise<void>
  removeDevice: (id: string) => Promise<void>
  setLang: (lang: Lang) => void
  setPrefs: (patch: Partial<NotificationPrefs>) => void
  setEmail: (email: string) => void
}

const DAY = 24 * 60 * 60 * 1000

const EMPTY_SUB: Subscription = {
  status: 'none',
  plan: null,
  startedAt: null,
  expiresAt: null,
  trafficUsedGb: 0,
  trafficLimitGb: null,
  subscriptionUrl: null,
}

const DEFAULT_PREFS: NotificationPrefs = {
  expiry: true,
  expiryDays: 3,
  traffic: true,
  trafficAt: 80,
  news: true,
  promo: false,
}

function initialLang(): Lang {
  const saved = loadString('lynk.lang')
  if (saved === 'ru' || saved === 'en') return saved
  const tgLang = getTelegramUser()?.language_code
  const nav = tgLang || navigator.language || 'ru'
  return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

function profileFromTelegram(): Profile {
  const u = getTelegramUser()
  return {
    tgId: u?.id ?? null,
    username: u?.username ?? null,
    firstName: u?.first_name ?? null,
    photoUrl: u?.photo_url ?? null,
    registeredAt: null,
    email: loadString('lynk.email'),
    devicesLimit: 5,
    balance: 0,
    referralsCount: 0,
    referralsActive: 0,
    referralEarned: 0,
    referralLevel: 0,
    referralPercent: 30,
    referralLink: null,
    defaultPromo: null,
  }
}

// Демо-данные, пока бэкенд не задеплоен: видно все состояния интерфейса.
function demo(now = Date.now()) {
  return {
    subscription: {
      status: 'active',
      plan: 'pro',
      startedAt: new Date(now - 7 * DAY).toISOString(),
      expiresAt: new Date(now + 23 * DAY).toISOString(),
      trafficUsedGb: 0,
      trafficLimitGb: null,
      subscriptionUrl: 'https://sub.lynk.example/demo',
    } satisfies Subscription,
    devices: [
      { id: 'd1', label: 'iPhone', platform: 'iOS', lastSeenAt: new Date(now - 12 * 60 * 1000).toISOString() },
      { id: 'd2', label: 'MacBook', platform: 'macOS', lastSeenAt: new Date(now - 2 * DAY).toISOString() },
    ] satisfies Device[],
    transactions: [
      { id: 't3', kind: 'referral', amount: 75, at: new Date(now - 1 * DAY).toISOString() },
      { id: 't2', kind: 'purchase', amount: -160, plan: 'pro', at: new Date(now - 7 * DAY).toISOString() },
      { id: 't1', kind: 'topup', amount: 265, at: new Date(now - 7 * DAY - 3600e3).toISOString() },
    ] satisfies Transaction[],
    profile: {
      registeredAt: new Date(now - 7 * DAY).toISOString(),
      balance: 180,
      referralsCount: 3,
      referralsActive: 1,
      referralEarned: 75,
      referralLevel: 0,
      referralPercent: 30,
      referralLink: 'https://t.me/lynkorobot?start=REF_DEMO42',
    } satisfies Partial<Profile>,
  }
}

function demoStatus(now = Date.now()): StatusSnapshot {
  const hourly = Array.from({ length: 24 }, (_, i) => (i === 20 ? 96.7 : 100))
  return {
    overall: 'ok',
    updatedAt: new Date(now).toISOString(),
    eta: null,
    nodes: [{ id: 'fi', country: 'fi', online: true, pingMs: 38, checkedAt: new Date(now).toISOString(), uptime24h: 99.86, uptime30d: 99.94, hourly }],
    openIncidents: [],
    incidents: [
      { id: '1', title: 'FI: узел не отвечает', text: 'Обнаружено мониторингом.', severity: 'minor', status: 'resolved', node: 'fi', auto: true, eta: null, startedAt: new Date(now - 4 * 3600e3).toISOString(), resolvedAt: new Date(now - 4 * 3600e3 + 120e3).toISOString() },
    ],
  }
}

// Один запрос /me за раз: фокус окна, возврат в Mini App и таймер могут сработать одновременно.
let inflight: Promise<void> | null = null

export const useAppStore = create<AppState>((set, get) => ({
  lang: initialLang(),
  profile: profileFromTelegram(),
  subscription: EMPTY_SUB,
  devices: [],
  transactions: [],
  liveCountries: DEFAULT_LIVE,
  servers: [],
  status: null,
  prices: PRICES_RUB,
  maintenance: false,
  prefs: load('lynk.prefs', DEFAULT_PREFS),
  demo: !apiEnabled,
  loaded: false,
  error: null,

  bootstrap: async () => {
    if (get().loaded) return
    await get().refresh()
    void get().loadServers()
    void get().loadStatus()
  },

  loadStatus: async () => {
    if (!apiEnabled) {
      set({ status: demoStatus() })
      return
    }
    try {
      set({ status: await api.get<StatusSnapshot>('/api/status') })
    } catch {
      /* статус не критичен */
    }
  },

  refresh: () => {
    if (!apiEnabled) {
      const d = demo()
      set((s) => ({
        subscription: d.subscription,
        devices: d.devices,
        transactions: d.transactions,
        profile: { ...s.profile, ...d.profile },
        loaded: true,
      }))
      return Promise.resolve()
    }
    if (inflight) return inflight
    inflight = loadMe().finally(() => {
      inflight = null
    })
    return inflight
  },

  loadServers: async () => {
    if (!apiEnabled) return
    try {
      const res = await api.get<{ servers: ServerInfo[] }>('/servers')
      set({ servers: res.servers ?? [] })
    } catch {
      /* пинг не критичен */
    }
  },

  removeDevice: async (id) => {
    const prev = get().devices
    set({ devices: prev.filter((d) => d.id !== id) })
    if (!apiEnabled) return
    try {
      await api.del(`/user/devices/${id}`)
    } catch (err) {
      set({ devices: prev })
      throw err
    }
  },

  setAutoRenew: async (enabled) => {
    set((s) => ({ subscription: { ...s.subscription, autoRenew: enabled } }))
    if (!apiEnabled) return
    try {
      const res = await api.post<{ autoRenew: boolean }>('/subscription/autorenew', { enabled })
      set((s) => ({ subscription: { ...s.subscription, autoRenew: res.autoRenew } }))
    } catch {
      set((s) => ({ subscription: { ...s.subscription, autoRenew: !enabled } }))
    }
  },

  setLang: (lang) => {
    save('lynk.lang', lang)
    document.documentElement.lang = lang
    set({ lang })
  },

  // TODO: синхронизировать с бэкендом (PATCH /me/notifications), бот читает оттуда.
  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch }
    save('lynk.prefs', prefs)
    set({ prefs })
  },

  // Почта подтверждается на бэкенде (POST /auth/email/start + /auth/email/verify), тут только показ.
  setEmail: (email) => {
    save('lynk.email', email)
    set((s) => ({ profile: { ...s.profile, email } }))
  },
}))

/** Загрузка /me: профиль, подписка, устройства, история. */
async function loadMe() {
  const set = useAppStore.setState
  try {
    const me = await api.get<{
      profile: Partial<Profile>
      subscription: Partial<Subscription> | null
      devices?: Device[]
      transactions?: Transaction[]
      countries?: CountryCode[]
      prices?: Prices
      maintenance?: boolean
    }>('/me')
    const provisionError = (me.profile as { provisionError?: string | null }).provisionError ?? null
    set((s) => ({
      error: provisionError ? `panel: ${provisionError}` : null,
      profile: { ...s.profile, ...me.profile },
      subscription: { ...EMPTY_SUB, ...(me.subscription ?? {}) },
      devices: me.devices ?? [],
      transactions: me.transactions ?? [],
      liveCountries: me.countries?.length ? me.countries : s.liveCountries,
      prices: me.prices ?? s.prices,
      maintenance: Boolean(me.maintenance),
      loaded: true,
    }))
  } catch (err) {
    console.warn('[api] /me failed', err)
    set({ loaded: true, error: err instanceof Error ? err.message : String(err) })
  }
}

export function daysLeft(sub: Subscription): number {
  if (!sub.expiresAt) return 0
  return Math.max(0, Math.ceil((new Date(sub.expiresAt).getTime() - Date.now()) / DAY))
}

export function periodProgress(sub: Subscription): number {
  if (!sub.expiresAt || !sub.startedAt) return 0
  const start = new Date(sub.startedAt).getTime()
  const end = new Date(sub.expiresAt).getTime()
  if (end <= start) return 0
  return Math.min(1, Math.max(0, (end - Date.now()) / (end - start)))
}
