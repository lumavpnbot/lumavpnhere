import { create } from 'zustand'
import type { PlanId } from '@/config'
import { getTelegramUser } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'

export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'expired'

export interface Subscription {
  status: SubscriptionStatus
  plan: PlanId | null
  startedAt: string | null
  expiresAt: string | null
  trafficUsedGb: number
  trafficLimitGb: number | null // null = безлимит
  subscriptionUrl: string | null
}

export interface Device {
  id: string
  label: string
  platform: string
  lastSeenAt: string
}

export interface Profile {
  tgId: number | null
  username: string | null
  firstName: string | null
  photoUrl: string | null
  devicesLimit: number
  referralBalance: number
  referralsCount: number
}

interface AppState {
  profile: Profile
  subscription: Subscription
  devices: Device[]
  demo: boolean
  loaded: boolean
  bootstrap: () => Promise<void>
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

// Демо-данные — пока бэкенд не задеплоен, чтобы было видно все состояния UI.
function demoState(): Pick<AppState, 'subscription' | 'devices'> & { profilePatch: Partial<Profile> } {
  const now = Date.now()
  return {
    subscription: {
      status: 'active',
      plan: 'pro',
      startedAt: new Date(now - 7 * DAY).toISOString(),
      expiresAt: new Date(now + 23 * DAY).toISOString(),
      trafficUsedGb: 0,
      trafficLimitGb: null,
      subscriptionUrl: 'https://sub.lynkvpn.example/demo',
    },
    devices: [
      { id: 'd1', label: 'iPhone', platform: 'iOS', lastSeenAt: new Date(now - 12 * 60 * 1000).toISOString() },
      { id: 'd2', label: 'MacBook', platform: 'macOS', lastSeenAt: new Date(now - 2 * DAY).toISOString() },
    ],
    profilePatch: { devicesLimit: 5, referralBalance: 180, referralsCount: 3 },
  }
}

function profileFromTelegram(): Profile {
  const u = getTelegramUser()
  return {
    tgId: u?.id ?? null,
    username: u?.username ?? null,
    firstName: u?.first_name ?? null,
    photoUrl: u?.photo_url ?? null,
    devicesLimit: 5,
    referralBalance: 0,
    referralsCount: 0,
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  profile: profileFromTelegram(),
  subscription: EMPTY_SUB,
  devices: [],
  demo: !apiEnabled,
  loaded: false,

  bootstrap: async () => {
    if (get().loaded) return

    if (!apiEnabled) {
      const d = demoState()
      set((s) => ({
        subscription: d.subscription,
        devices: d.devices,
        profile: { ...s.profile, ...d.profilePatch },
        loaded: true,
      }))
      return
    }

    try {
      const me = await api.get<{ profile: Partial<Profile>; subscription: Partial<Subscription> | null; devices?: Device[] }>('/me')
      set((s) => ({
        profile: { ...s.profile, ...me.profile },
        subscription: { ...EMPTY_SUB, ...(me.subscription ?? {}) },
        devices: me.devices ?? [],
        loaded: true,
      }))
    } catch (err) {
      console.warn('[api] /me failed', err)
      set({ loaded: true })
    }
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
