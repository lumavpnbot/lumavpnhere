import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { DemoBadge, Divider, ListRow, Section, StatusPill, TopBar } from '@/components/ui'
import { ChatIcon, ChevronRight, DevicesIcon, InfinityIcon, MegaphoneIcon, PulseIcon, ReferralsIcon, ShieldIcon, WalletIcon } from '@/components/icons'
import StatusWidget from '@/components/StatusWidget'
import { ReviewsSection } from '@/components/Reviews'
import { LINKS, PLANS } from '@/config'
import { useLang, useT } from '@/i18n'
import mark from '@/assets/lynk-mark.png'
import { daysWord, formatDate, formatRub } from '@/lib/format'
import { useTrialVars } from '@/lib/trial'
import { haptic, openExternal } from '@/lib/telegram'
import { daysLeft, periodProgress, useAppStore } from '@/store/useAppStore'

/**
 * Главная: подписка и информация о сервисе. Подключения тут нет
 * намеренно, оно во вкладке «Устройства».
 */
export default function HomePage() {
  const t = useT()
  const lang = useLang()
  const trialVars = useTrialVars()
  const navigate = useNavigate()
  const subscription = useAppStore((s) => s.subscription)
  const profile = useAppStore((s) => s.profile)
  const devices = useAppStore((s) => s.devices)

  const plan = PLANS.find((p) => p.id === subscription.plan)
  const active = subscription.status === 'active' || subscription.status === 'trial'
  const left = daysLeft(subscription)
  const expiringSoon = active && left <= 3

  const go = (path: string) => {
    haptic('light')
    navigate(path)
  }

  return (
    <>
      <TopBar home />
      <DemoBadge />
      <StatusWidget />

      {/* ── Подписка ── */}
      <div className="glass glass-hero p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="label">{t('home.subscription')}</span>
          {active ? (
            <StatusPill tone={expiringSoon ? 'warn' : 'ok'}>
              {subscription.status === 'trial' ? t('home.trial') : expiringSoon ? t('home.expiring') : t('home.active')}
            </StatusPill>
          ) : (
            <StatusPill tone={subscription.status === 'expired' ? 'bad' : 'muted'}>
              {subscription.status === 'expired' ? t('home.expired') : t('home.none')}
            </StatusPill>
          )}
        </div>

        {active ? (
          <>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-[34px] font-bold leading-none tracking-[-0.03em]">
                  {plan ? t(plan.nameKey) : 'LYNK'}
                </div>
                {subscription.expiresAt && (
                  <div className="mt-2 text-[14px] text-dim">{t('home.until', { date: formatDate(subscription.expiresAt, lang) })}</div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[28px] font-semibold leading-none tabular-nums">{left}</div>
                <div className="mt-1 text-[12px] text-faint">{daysWord(lang, left)}</div>
              </div>
            </div>

            <div className="mt-5 h-1.5 overflow-hidden rounded-pill bg-white/[0.08]">
              <div
                className="h-full rounded-pill bg-gradient-to-r from-white/40 to-white"
                style={{ width: `${Math.round(periodProgress(subscription) * 100)}%` }}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <MiniMetric
                icon={<InfinityIcon className="h-4 w-4" />}
                label={t('home.traffic')}
                value={
                  subscription.trafficLimitGb == null
                    ? t('home.unlimited')
                    : `${Math.round(subscription.trafficUsedGb)} / ${subscription.trafficLimitGb} GB`
                }
              />
              <MiniMetric
                icon={<DevicesIcon className="h-4 w-4" />}
                label={t('home.devices')}
                value={`${devices.length} / ${profile.devicesLimit}`}
                onClick={() => go('/devices')}
              />
            </div>

            <button onClick={() => go('/plans')} className="btn-glass-strong mt-4 w-full">
              {t('home.extend')}
            </button>
          </>
        ) : (
          <>
            <p className="mt-4 text-[15px] leading-snug text-dim">{t('home.noneText', trialVars)}</p>
            <button onClick={() => go('/plans')} className="btn-glass-strong mt-5 w-full">
              {t('home.choose')}
            </button>
          </>
        )}
      </div>

      {/* ── Баланс и друзья ── */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <InfoCard
          title={t('home.balance')}
          icon={<WalletIcon className="h-[22px] w-[22px]" />}
          value={formatRub(profile.balance)}
          onClick={() => go('/balance')}
        />
        <InfoCard
          title={t('home.friends')}
          icon={<ReferralsIcon className="h-[22px] w-[22px]" />}
          value={String(profile.referralsCount)}
          sub={t('home.earned', { amount: formatRub(profile.referralEarned) })}
          onClick={() => go('/referrals')}
        />
      </div>

      {/* ── Наше отличие: приватность ── */}
      <div className="edge-card relative mt-3 overflow-hidden rounded-card p-5">
        <img src={mark} alt="" className="pointer-events-none absolute -bottom-10 -right-8 h-44 w-44 select-none opacity-[0.08]" draggable={false} />
        <div className="flex items-center gap-2">
          <ShieldIcon className="h-4 w-4 text-fg" />
          <span className="label !text-fg/80">{t('home.edgeLabel')}</span>
        </div>
        <div className="mt-3 text-[20px] font-semibold leading-snug tracking-[-0.01em]">{t('home.edgeTitle')}</div>
        <p className="mt-2 text-[14px] leading-relaxed text-dim">{t('home.edgeText')}</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-pill bg-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          {t('home.edgeOps')}
        </div>
      </div>

      {/* ── Отзывы и рейтинг ── */}
      <Section title={t('reviews.section')}>
        <ReviewsSection onAll={() => go('/reviews')} />
      </Section>

      {/* ── Связь ── */}
      <Section title={t('home.help')}>
        <div className="glass overflow-hidden">
          <ListRow
            icon={<ChatIcon className="h-[18px] w-[18px]" />}
            title={t('home.support')}
            hint={t('home.supportHint')}
            onClick={() => go('/support')}
          />
          <Divider />
          <ListRow icon={<PulseIcon className="h-[18px] w-[18px]" />} title={t('status.row')} hint={t('status.rowHint')} onClick={() => go('/status')} />
          <Divider />
          <ListRow
            icon={<MegaphoneIcon className="h-[18px] w-[18px]" />}
            title={t('home.channel')}
            hint={t('home.channelHint')}
            onClick={() => openExternal(LINKS.channel)}
          />
        </div>
      </Section>
    </>
  )
}

function MiniMetric({ icon, label, value, onClick }: { icon: ReactNode; label: string; value: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="press flex min-w-0 items-center gap-2.5 rounded-2xl bg-white/[0.06] px-3 py-2.5 text-left disabled:active:scale-100"
    >
      <span className="text-dim">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] text-faint">{label}</span>
        <span className="block truncate text-[14px] font-semibold tabular-nums">{value}</span>
      </span>
    </button>
  )
}

function InfoCard({
  title,
  icon,
  value,
  sub,
  onClick,
}: {
  title: string
  icon: ReactNode
  value: string
  sub?: string
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="glass press flex min-w-0 flex-col p-4 text-left">
      <span className="flex w-full items-center justify-between">
        <span className="text-[13px] text-dim">{title}</span>
        <ChevronRight className="h-4 w-4 text-faint" />
      </span>
      <span className="mt-3 flex w-full min-w-0 items-center gap-3">
        <span className="tile">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[20px] font-semibold leading-tight tabular-nums">{value}</span>
          {sub && <span className="block truncate text-[12px] text-faint">{sub}</span>}
        </span>
      </span>
    </button>
  )
}

