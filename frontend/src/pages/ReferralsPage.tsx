import { useState, type ReactNode } from 'react'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { CheckIcon, CopyIcon, GiftIcon, PercentIcon, ReferralsIcon, ShareIcon } from '@/components/icons'
import { BOT_USERNAME, REFERRAL } from '@/config'
import { useT } from '@/i18n'
import { formatRub } from '@/lib/format'
import { copyText, haptic, openExternal } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

export default function ReferralsPage() {
  const t = useT()
  const profile = useAppStore((s) => s.profile)
  const subscription = useAppStore((s) => s.subscription)
  const [copied, setCopied] = useState(false)

  const link = `https://t.me/${BOT_USERNAME}?start=ref_${profile.tgId ?? 'demo'}`
  const canWithdraw =
    profile.balance >= REFERRAL.minPayout && (subscription.status === 'active' || subscription.status === 'trial')

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
    openExternal(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('friends.shareText'))}`)
  }

  return (
    <>
      <TopBar />
      <PageTitle title={t('friends.title')} subtitle={t('friends.subtitle', { percent: REFERRAL.percent })} />

      <div className="glass glass-hero flex items-center gap-4 p-5">
        <span className="tile !h-14 !w-14 !rounded-[18px]">
          <ReferralsIcon className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-dim">{t('friends.invited')}</div>
          <div className="text-[32px] font-bold leading-none tabular-nums tracking-[-0.02em]">{profile.referralsCount}</div>
          <div className="mt-1 text-[13px] text-faint">{t('friends.active', { n: profile.referralsActive })}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatTile icon={<GiftIcon className="h-5 w-5" />} label={t('friends.earned')} value={formatRub(profile.referralEarned, true)} />
        <StatTile icon={<PercentIcon className="h-5 w-5" />} label={t('friends.rate')} value={`${REFERRAL.percent}%`} />
      </div>

      <Section title={t('friends.link')}>
        <div className="glass p-3">
          <div className="truncate rounded-2xl bg-white/[0.05] px-4 py-3.5 font-mono text-[13px] text-dim">{link}</div>
          <div className="mt-2.5 flex gap-2">
            <button onClick={copy} className="btn-glass-strong flex-1 !h-12">
              {copied ? <CheckIcon className="h-5 w-5" /> : <CopyIcon className="h-5 w-5" />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
            <button onClick={share} className="btn-glass !h-12 !w-12 !px-0" aria-label={t('common.share')}>
              <ShareIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </Section>

      <Section title={t('friends.how')}>
        <div className="glass divide-y divide-white/[0.06] px-4">
          {(['friends.how1', 'friends.how2', 'friends.how3'] as const).map((k, i) => (
            <div key={k} className="flex items-start gap-3.5 py-3.5">
              <span className="tile !h-7 !w-7 !rounded-[9px] text-[12px] font-semibold">{i + 1}</span>
              <span className="pt-0.5 text-[14px] leading-snug text-dim">{t(k, { percent: REFERRAL.percent })}</span>
            </div>
          ))}
        </div>
      </Section>

      <button disabled={!canWithdraw} className="btn-glass mt-6 w-full">
        {t('friends.withdraw')}
      </button>
      {!canWithdraw && (
        <p className="mt-2.5 px-2 text-center text-[12px] text-faint">
          {t('friends.withdrawNote', { amount: formatRub(REFERRAL.minPayout) })}
        </p>
      )}
    </>
  )
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="glass p-4">
      <div className="text-[13px] text-dim">{label}</div>
      <div className="mt-3 flex items-center gap-3">
        <span className="tile">{icon}</span>
        <span className="truncate text-[20px] font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  )
}
