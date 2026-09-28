import { create } from 'zustand'

export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'expired'

export interface Subscription {
  status: SubscriptionStatus
  plan: 'free' | 'start' | 'pro' | null
  expiresAt: string | null
  trafficUsedGb: number
  trafficLimitGb: number | null // null = безлимит
}

export interface Profile {
  tgId: number
  username: string | null
  avatarUrl: string | null
  devicesUsed: number
  devicesLimit: number
  referralBalance: number
}

interface AppState {
  profile: Profile | null
  subscription: Subscription | null
  loading: boolean
  setProfile: (p: Profile) => void
  setSubscription: (s: Subscription) => void
  setLoading: (v: boolean) => void
}

/**
 * Глобальное состояние сессии: профиль пользователя и текущая подписка.
 * Данные приходят с бэкенда после авторизации по initData (см. src/lib/api.ts).
 */
export const useAppStore = create<AppState>((set) => ({
  profile: null,
  subscription: null,
  loading: true,
  setProfile: (profile) => set({ profile }),
  setSubscription: (subscription) => set({ subscription }),
  setLoading: (loading) => set({ loading }),
}))
