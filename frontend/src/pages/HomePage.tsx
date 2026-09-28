import { useState } from 'react'
import { haptic } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

type ConnectState = 'idle' | 'connecting' | 'connected' | 'error'

/**
 * Главный экран (ТЗ 4.2): круглая кнопка подключения, статус подписки,
 * трафик, быстрые действия. Реальное VPN-подключение появится, когда
 * бэкенд научится дергать 3x-ui API (сейчас — заглушка состояния).
 */
export default function HomePage() {
  const { profile, subscription } = useAppStore()
  const [state, setState] = useState<ConnectState>('idle')

  const toggleConnect = () => {
    haptic('medium')
    setState((s) => (s === 'connected' ? 'idle' : 'connecting'))
    if (state !== 'connected') {
      setTimeout(() => setState('connected'), 800) // заглушка, до реального API
    }
  }

  return (
    <div className="px-5 pt-6">
      <header className="mb-6 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-surface-2" />
        <div className="text-sm text-text-dim">@{profile?.username ?? 'guest'}</div>
      </header>

      <div className="flex flex-col items-center py-8">
        <button
          onClick={toggleConnect}
          className={`h-48 w-48 rounded-full border-2 transition-colors ${
            state === 'connected'
              ? 'border-success bg-success/10 text-success'
              : state === 'connecting'
              ? 'border-accent bg-accent/10 text-accent animate-pulse'
              : 'border-border bg-surface text-text-dim'
          }`}
        >
          <span className="text-sm font-semibold">
            {state === 'connected' ? 'Подключено' : state === 'connecting' ? 'Подключение…' : 'Подключиться'}
          </span>
        </button>
        <div className="mt-4 text-xs text-text-dim">
          {state === 'connected' ? 'Нидерланды · 24 ms' : 'Нажмите, чтобы подключиться'}
        </div>
      </div>

      <section className="rounded-card border border-border bg-surface p-4">
        <div className="mb-1 text-sm text-text-dim">Подписка</div>
        {subscription?.status === 'active' || subscription?.status === 'trial' ? (
          <div className="text-text-primary">
            {subscription.plan === 'pro' ? 'Про' : subscription.plan === 'start' ? 'Старт' : 'Free'}
            {subscription.status === 'trial' && <span className="ml-2 text-xs text-accent">пробный период</span>}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-text-dim">Нет активной подписки</span>
            <button className="rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-bg">Купить</button>
          </div>
        )}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="text-xs text-text-dim">Устройства</div>
          <div className="mt-1 text-lg font-semibold">
            {profile?.devicesUsed ?? 0} <span className="text-sm text-text-dim">из {profile?.devicesLimit ?? 5}</span>
          </div>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="text-xs text-text-dim">Реферальный баланс</div>
          <div className="mt-1 text-lg font-semibold">{profile?.referralBalance ?? 0} ₽</div>
        </div>
      </section>
    </div>
  )
}
