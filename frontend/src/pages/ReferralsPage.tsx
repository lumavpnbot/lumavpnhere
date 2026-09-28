import { useState } from 'react'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { CheckIcon, CopyIcon, ShareIcon, WalletIcon } from '@/components/icons'
import { BOT_USERNAME, BRAND } from '@/config'
import { formatRub, ruPlural } from '@/lib/format'
import { copyText, haptic, openExternal } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

const MIN_PAYOUT = 500 // ₽ — ТЗ, раздел 9.4
const PERCENT = 30

export default function ReferralsPage() {
  const profile = useAppStore((s) => s.profile)
  const subscription = useAppStore((s) => s.subscription)
  const [copied, setCopied] = useState(false)

  const link = `https://t.me/${BOT_USERNAME}?start=ref_${profile.tgId ?? 'demo'}`
  const canWithdraw =
    profile.referralBalance >= MIN_PAYOUT && (subscription.status === 'active' || subscription.status === 'trial')

  const copy = async () => {
    const ok = await copyText(link)
    haptic(ok ? 'success' : 'error')
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  const share = () => {
    haptic('light')
    const text = `Пользуюсь ${BRAND} — по моей ссылке +3 дня к пробному периоду`
    openExternal(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`)
  }

  return (
    <>
      <TopBar />
      <PageTitle title="Друзья" subtitle={`${PERCENT}% с каждой оплаты приглашённых — на ваш баланс`} />

      <div className="glass glass-hero p-5">
        <div className="flex items-center justify-between">
          <span className="label">Баланс</span>
          <WalletIcon className="h-5 w-5 text-faint" />
        </div>
        <div className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums">
          {formatRub(profile.referralBalance)}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Mini value={String(profile.referralsCount)} label={ruPlural(profile.referralsCount, 'друг', 'друга', 'друзей')} />
          <Mini value={`${PERCENT}%`} label="с оплат" />
          <Mini value={formatRub(MIN_PAYOUT)} label="вывод от" />
        </div>

        <button disabled={!canWithdraw} className="btn-glass-strong mt-5 w-full">
          Вывести
        </button>
        {!canWithdraw && (
          <p className="mt-2.5 text-center text-[12px] text-faint">
            Вывод от {formatRub(MIN_PAYOUT)} при активной подписке. Баланс можно тратить на продление.
          </p>
        )}
      </div>

      <Section title="Ваша ссылка">
        <div className="glass p-2">
          <div className="truncate rounded-pill bg-white/[0.05] px-4 py-3 font-mono text-[13px] text-dim">{link}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={copy} className="btn-glass !h-11 !text-[14px]">
              {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
            <button onClick={share} className="btn-glass-strong !h-11 !text-[14px]">
              <ShareIcon className="h-4 w-4" />
              Поделиться
            </button>
          </div>
        </div>
      </Section>

      <Section title="Как это работает">
        <div className="glass divide-y divide-white/[0.06] px-4">
          <HowRow n={1} text="Друг переходит по вашей ссылке и получает +3 дня пробного периода" />
          <HowRow n={2} text={`Когда он оплачивает подписку, ${PERCENT}% суммы приходят вам`} />
          <HowRow n={3} text="Начисления доступны через 7 дней — защита от возвратов" />
        </div>
      </Section>
    </>
  )
}

function Mini({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.05] px-2 py-3">
      <div className="text-[16px] font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-faint">{label}</div>
    </div>
  )
}

function HowRow({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3.5 py-3.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.1] text-[12px] font-semibold">
        {n}
      </span>
      <span className="text-[14px] leading-snug text-dim">{text}</span>
    </div>
  )
}
