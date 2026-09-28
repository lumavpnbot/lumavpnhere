import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Divider, ListRow, Section, StatusPill, TopBar } from '@/components/ui'
import { BoltIcon, ChatIcon, GlobeIcon, InfinityIcon, MegaphoneIcon, ShieldIcon } from '@/components/icons'
import { LINKS, PLANS } from '@/config'
import { formatDate, formatRub, ruPlural } from '@/lib/format'
import { haptic, openExternal } from '@/lib/telegram'
import { daysLeft, periodProgress, useAppStore } from '@/store/useAppStore'

/**
 * Главная — только подписка и информация о сервисе. Подключение устройства
 * живёт во вкладке «Устройства» (/connect), здесь его нет намеренно.
 */
export default function HomePage() {
  const navigate = useNavigate()
  const { subscription, profile, devices, demo } = useAppStore()
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

      {demo && (
        <div className="mb-4 flex justify-center">
          <span className="rounded-pill bg-white/[0.06] px-3 py-1 text-[12px] text-faint">
            Демо-данные · бэкенд ещё не подключён
          </span>
        </div>
      )}

      {/* ── Подписка ── */}
      <div className="glass glass-hero p-5">
        <div className="flex items-center justify-between">
          <span className="label">Подписка</span>
          {active ? (
            <StatusPill tone={expiringSoon ? 'warn' : 'ok'}>
              {subscription.status === 'trial' ? 'Пробный период' : expiringSoon ? 'Скоро закончится' : 'Активна'}
            </StatusPill>
          ) : (
            <StatusPill tone={subscription.status === 'expired' ? 'bad' : 'muted'}>
              {subscription.status === 'expired' ? 'Истекла' : 'Нет подписки'}
            </StatusPill>
          )}
        </div>

        {active ? (
          <>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div>
                <div className="text-[34px] font-bold leading-none tracking-[-0.03em]">{plan?.name ?? 'LynkVPN'}</div>
                {subscription.expiresAt && (
                  <div className="mt-2 text-[14px] text-dim">до {formatDate(subscription.expiresAt)}</div>
                )}
              </div>
              <div className="text-right">
                <div className="text-[28px] font-semibold leading-none tabular-nums">{left}</div>
                <div className="mt-1 text-[12px] text-faint">{ruPlural(left, 'день', 'дня', 'дней')}</div>
              </div>
            </div>

            <div className="mt-5 h-1.5 overflow-hidden rounded-pill bg-white/[0.08]">
              <div
                className="h-full rounded-pill bg-gradient-to-r from-white/50 to-white"
                style={{ width: `${Math.round(periodProgress(subscription) * 100)}%` }}
              />
            </div>

            <button onClick={() => go('/plans')} className="btn-glass-strong mt-5 w-full">
              Продлить подписку
            </button>
          </>
        ) : (
          <>
            <p className="mt-4 text-[15px] leading-snug text-dim">
              Оформите подписку, чтобы подключить до 5 устройств. Первые 7 дней — бесплатно.
            </p>
            <button onClick={() => go('/plans')} className="btn-glass-strong mt-5 w-full">
              Выбрать тариф
            </button>
          </>
        )}
      </div>

      {/* ── Показатели ── */}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat
          label="Трафик"
          value={
            subscription.trafficLimitGb == null ? (
              <InfinityIcon className="h-6 w-6" />
            ) : (
              `${Math.round(subscription.trafficUsedGb)}/${subscription.trafficLimitGb}`
            )
          }
          hint={subscription.trafficLimitGb == null ? 'без лимита' : 'ГБ'}
        />
        <Stat
          label="Устройства"
          value={`${devices.length}/${profile.devicesLimit}`}
          hint="подключено"
          onClick={() => go('/devices')}
        />
        <Stat
          label="Баланс"
          value={formatRub(profile.referralBalance)}
          hint="за друзей"
          onClick={() => go('/referrals')}
        />
      </div>

      {/* ── О сервисе ── */}
      <Section title="О сервисе">
        <div className="glass divide-y divide-white/[0.06] px-4">
          <Feature icon={<ShieldIcon className="h-5 w-5" />} title="VLESS + Reality" text="Трафик выглядит как обычный HTTPS" />
          <Feature icon={<GlobeIcon className="h-5 w-5" />} title="Серверы в Европе" text="Нидерланды и Германия, скоро больше" />
          <Feature icon={<BoltIcon className="h-5 w-5" />} title="Подключение за минуту" text="Одна ссылка — все ваши устройства" />
        </div>
      </Section>

      <Section title="Связь">
        <div className="glass overflow-hidden">
          <ListRow icon={<ChatIcon className="h-[18px] w-[18px]" />} title="Поддержка" hint="Ответим в Telegram" onClick={() => openExternal(LINKS.support)} />
          <Divider />
          <ListRow icon={<MegaphoneIcon className="h-[18px] w-[18px]" />} title="Наш канал" hint="Новости и статус серверов" onClick={() => openExternal(LINKS.channel)} />
        </div>
      </Section>
    </>
  )
}

function Stat({
  label,
  value,
  hint,
  onClick,
}: {
  label: string
  value: ReactNode
  hint: string
  onClick?: () => void
}) {
  return (
    <button onClick={onClick} disabled={!onClick} className="glass flex flex-col items-start p-3.5 text-left active:scale-[0.98] disabled:active:scale-100">
      <span className="text-[12px] text-faint">{label}</span>
      <span className="mt-2 flex h-7 items-center text-[19px] font-semibold tabular-nums leading-none">{value}</span>
      <span className="mt-1 text-[11px] text-faint">{hint}</span>
    </button>
  )
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-center gap-3.5 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-fg">{icon}</span>
      <div className="min-w-0">
        <div className="text-[15px] font-medium">{title}</div>
        <div className="text-[13px] text-faint">{text}</div>
      </div>
    </div>
  )
}
