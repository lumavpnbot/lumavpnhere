import { useAppStore } from '@/store/useAppStore'
import { haptic } from '@/lib/telegram'

const MIN_PAYOUT = 500 // ₽ — из ТЗ раздел 9.4

export default function ReferralsPage() {
  const { profile } = useAppStore()
  const balance = profile?.referralBalance ?? 0
  const link = profile ? `https://t.me/LumaVPNBot?start=REF_${profile.tgId}` : ''

  const copyLink = () => {
    navigator.clipboard?.writeText(link)
    haptic('success')
  }

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-1 text-xl font-bold">Рефералы</h1>
      <p className="mb-6 text-sm text-text-dim">Приглашайте друзей и получайте 30% с их платежей</p>

      <div className="rounded-card border border-border bg-surface p-5 text-center">
        <div className="text-3xl font-bold">{balance} ₽</div>
        <div className="mt-1 text-xs text-text-dim">
          {balance >= MIN_PAYOUT ? 'Доступно к выводу' : `Вывод от ${MIN_PAYOUT} ₽`}
        </div>
      </div>

      <div className="mt-4 rounded-card border border-border bg-surface p-4">
        <div className="mb-2 text-xs text-text-dim">Реферальная ссылка</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 truncate rounded-pill bg-surface-2 px-4 py-2.5 text-sm">{link}</div>
          <button onClick={copyLink} className="rounded-pill border border-border px-4 py-2.5 text-sm">
            Копир.
          </button>
        </div>
      </div>

      <button
        disabled={balance < MIN_PAYOUT}
        className="mt-4 w-full rounded-pill bg-accent py-3 text-sm font-semibold text-bg disabled:opacity-40"
      >
        Вывести
      </button>
    </div>
  )
}
