import { create } from 'zustand'
import { DEFAULT_LIVE, PRICES_RUB, type CountryCode, type PlanId } from '@/config'
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
  setAutoRenew: (enabled: boolean) => Promise<void>
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
      subscriptionUrl: 'https://sub.lynkvpn.example/demo',
    } satisfies Subscription,
    devices: [
      { id: 'd1', label: 'iPhone', platform: 'iOS', lastSeenAt: new Date(now - 12 * 60 * 1000).toISOString() },
      { id: 'd2', label: 'MacBook', platform: 'macOS', lastSeenAt: new Date(now - 2 * DAY).toISOString() },
    ] satisfies Device[],
    transactions: [
      { id: 't3', kind: 'referral', amount: 75, at: new Date(now - 1 * DAY).toISOString() },
      { id: 't2', kind: 'purchase', amount: -249, plan: 'pro', at: new Date(now - 7 * DAY).toISOString() },
      { id: 't1', kind: 'topup', amount: 354, at: new Date(now - 7 * DAY - 3600e3).toISOString() },
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

export const useAppStore = create<AppState>((set, get) => ({
  lang: initialLang(),
  profile: profileFromTelegram(),
  subscription: EMPTY_SUB,
  devices: [],
  transactions: [],
  liveCountries: DEFAULT_LIVE,
  servers: [],
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
  },

  refresh: async () => {
    if (!apiEnabled) {
      const d = demo()
      set((s) => ({
        subscription: d.subscription,
        devices: d.devices,
        transactions: d.transactions,
        profile: { ...s.profile, ...d.profile },
        loaded: true,
      }))
      return
    }

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

  // TODO: реальная привязка через POST /auth/email/start + /auth/email/verify.
  setEmail: (email) => {
    save('lynk.email', email)
    set((s) => ({ profile: { ...s.profile, email } }))
  },
}))

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
