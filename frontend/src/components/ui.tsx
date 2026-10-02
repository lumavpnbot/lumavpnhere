import type { ReactNode } from 'react'
import mark from '@/assets/lynk-mark.png'
import { BRAND } from '@/config'
import { useT } from '@/i18n'
import { useGoBack } from '@/lib/navigation'
import { haptic, nativeBack } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'
import { useLocation, useNavigate } from 'react-router-dom'
import { BellIcon, ChevronLeft, ChevronRight } from './icons'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <img src={mark} alt="" className={`${compact ? 'h-8 w-8' : 'h-6 w-6'} select-none`} draggable={false} />
      {!compact && <span className="wordmark text-[17px]">{BRAND}</span>}
    </div>
  )
}

export function Avatar({ size = 40 }: { size?: number }) {
  const { photoUrl, firstName, username } = useAppStore((s) => s.profile)
  const letter = (firstName || username || 'L').slice(0, 1).toUpperCase()
  return photoUrl ? (
    <img
      src={photoUrl}
      alt=""
      className="shrink-0 rounded-full object-cover ring-1 ring-white/15"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-white/10 font-semibold text-fg ring-1 ring-white/15"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {letter}
    </div>
  )
}

export function useDisplayName() {
  const t = useT()
  const { username, firstName } = useAppStore((s) => s.profile)
  return username ? `@${username}` : firstName ?? t('common.guest')
}

/**
 * Верхняя строка. Главная: аватар и ник слева. Остальные экраны: слева
 * запасная «Назад» (только вне Telegram, внутри работает нативная BackButton).
 * Справа всегда колокольчик уведомлений и лого (без названия).
 */
export function TopBar({ home = false }: { home?: boolean }) {
  const t = useT()
  const goBack = useGoBack()
  const name = useDisplayName()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <header className="mb-6 flex h-11 items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        {home ? (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar />
            <div className="truncate text-[16px] font-semibold">{name}</div>
          </div>
        ) : !nativeBack ? (
          <button onClick={goBack} className="btn-glass !h-10 !px-3 !text-[14px]">
            <ChevronLeft className="h-4 w-4" />
            {t('common.back')}
          </button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {pathname !== '/account/notifications' && (
          <button
            onClick={() => {
              haptic('light')
              navigate('/account/notifications')
            }}
            className="btn-glass !h-10 !w-10 !px-0"
            aria-label={t('account.notifications')}
          >
            <BellIcon className="h-[19px] w-[19px]" />
          </button>
        )}
        <Brand compact />
      </div>
    </header>
  )
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[15px] leading-snug text-dim">{subtitle}</p>}
    </div>
  )
}

export function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-7">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between px-1">
          {title && <h2 className="label">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function ListRow({
  icon,
  title,
  hint,
  right,
  onClick,
}: {
  icon: ReactNode
  title: string
  hint?: string
  right?: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      onClick={() => {
        haptic('light')
        onClick?.()
      }}
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors active:bg-white/5"
    >
      <span className="tile !h-10 !w-10 !rounded-[13px]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        {hint && <span className="block truncate text-[13px] text-faint">{hint}</span>}
      </span>
      {right}
      <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
    </button>
  )
}

export function Divider() {
  return <div className="mx-4 h-px bg-white/[0.07]" />
}

export function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  const dot = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', muted: 'bg-faint' }[tone]
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-white/[0.08] px-2.5 py-1 text-[12px] font-medium text-fg">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

export function DemoBadge() {
  const t = useT()
  const demo = useAppStore((s) => s.demo)
  const error = useAppStore((s) => s.error)
  const refresh = useAppStore((s) => s.refresh)
  if (error)
    return (
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-bad/10 px-4 py-3 text-[13px] leading-snug text-bad">
        <span className="min-w-0 flex-1">
          {t('common.loadError')}: {error}
        </span>
        <button onClick={() => void refresh()} className="shrink-0 rounded-pill bg-bad/15 px-3 py-1.5 text-[12px] font-semibold active:opacity-70">
          {t('common.retry')}
        </button>
      </div>
    )
  if (!demo) return null
  return (
    <div className="mb-4 flex justify-center">
      <span className="rounded-pill bg-white/[0.06] px-3 py-1 text-[12px] text-faint">{t('common.demo')}</span>
    </div>
  )
}
