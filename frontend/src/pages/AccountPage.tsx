import { useAppStore } from '@/store/useAppStore'

/**
 * Аккаунт: профиль из Telegram initData подтягивается автоматически,
 * отдельный вход по e-mail (как в elix) — для доступа вне Telegram,
 * не входит в MVP, добавляется по необходимости.
 */
export default function AccountPage() {
  const { profile } = useAppStore()

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-6 text-xl font-bold">Аккаунт</h1>

      <div className="flex items-center gap-3 rounded-card border border-border bg-surface p-4">
        <div className="h-14 w-14 rounded-full bg-surface-2" />
        <div>
          <div className="font-semibold">@{profile?.username ?? 'guest'}</div>
          <div className="text-xs text-text-dim">ID: {profile?.tgId ?? '—'}</div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <a href="#" className="block rounded-card border border-border bg-surface p-4 text-sm">
          Поддержка
        </a>
        <a href="#" className="block rounded-card border border-border bg-surface p-4 text-sm">
          Telegram-канал
        </a>
      </div>
    </div>
  )
}
