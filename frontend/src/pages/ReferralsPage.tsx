import { useEffect, useState, type ReactNode } from 'react'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { CheckIcon, CopyIcon, GiftIcon, PercentIcon, ReferralsIcon, ShareIcon, WalletIcon } from '@/components/icons'
import { BOT_USERNAME, REFERRAL } from '@/config'
import { useLang, useT, type TKey } from '@/i18n'
import { useTrialVars } from '@/lib/trial'
import { formatDate, formatRub } from '@/lib/format'
import { copyText, haptic, notify } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'
import { shareReferral } from '@/lib/share'
import { useAppStore } from '@/store/useAppStore'

interface Level {
  name: string
  min: number
  percent: number
  bonus: { plan: 'start' | 'pro'; days: number } | null
}

interface ReferralInfo {
  link: string | null
  invited: number
  active: number
  earnedHold: number
  earnedPaid: number
  holdDays: number
  level: number
  levels: Level[]
}

interface Earning {
  id: string
  amount: number
  status: 'hold' | 'paid' | 'cancelled'
  availableAt: string
  at: string
}

interface Friend {
  id: string
  name: string
  joinedAt: string
  paid: boolean
}

const LEVEL_KEYS: TKey[] = ['level.base', 'level.silver', 'level.gold', 'level.platinum']
const DEFAULT_LEVELS: Level[] = [
  { name: 'base', min: 0, percent: 30, bonus: null },
  { name: 'silver', min: 5, percent: 35, bonus: { plan: 'start', days: 14 } },
  { name: 'gold', min: 20, percent: 40, bonus: { plan: 'pro', days: 30 } },
  { name: 'platinum', min: 50, percent: 45, bonus: { plan: 'pro', days: 60 } },
]
// Металлические оттенки уровней в общей монохромной гамме.
const LEVEL_TINT = ['rgba(255,255,255,0.10)', 'rgba(210,214,224,0.22)', 'rgba(230,205,150,0.22)', 'rgba(200,225,255,0.24)']

export default function ReferralsPage() {
  const t = useT()
  const lang = useLang()
  const trialVars = useTrialVars()
  const profile = useAppStore((s) => s.profile)
  const refresh = useAppStore((s) => s.refresh)
  const [copied, setCopied] = useState(false)
  const [info, setInfo] = useState<ReferralInfo | null>(null)
  const [earnings, setEarnings] = useState<Earning[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [tab, setTab] = useState<'earnings' | 'friends'>('earnings')

  useEffect(() => {
    if (!apiEnabled) return
    api.get<ReferralInfo>('/referral').then(setInfo).catch(() => undefined)
    api.get<{ earnings: Earning[] }>('/referral/earnings').then((r) => setEarnings(r.earnings)).catch(() => undefined)
    api.get<{ referrals: Friend[] }>('/referral/referrals').then((r) => setFriends(r.referrals)).catch(() => undefined)
  }, [])

  const levels = info?.levels ?? DEFAULT_LEVELS
  const level = info?.level ?? profile.referralLevel
  const active = info?.active ?? profile.referralsActive
  const next = levels[level + 1]
  const progress = next ? Math.min(1, (active - levels[level].min) / Math.max(1, next.min - levels[level].min)) : 1
  const link = info?.link ?? profile.referralLink ?? `https://t.me/${BOT_USERNAME}?start=REF_${profile.tgId ?? 'DEMO'}`
  const percent = levels[level]?.percent ?? REFERRAL.percent

  const copy = async () => {
    const ok = await copyText(link)
    haptic(ok ? 'success' : 'error')
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  // Нативное «Поделиться» Telegram: если сообщение отправлено, засчитывается бейдж «Шеринг».
  const share = async () => {
    haptic('light')
    if (await shareReferral(link, t('friends.shareText', trialVars))) {
      haptic('success')
      notify(t('ach.shareDone'))
      void refresh()
    }
  }

  return (
    <>
      <TopBar />
      <PageTitle title={t('friends.title')} subtitle={t('friends.subtitle', { percent })} />

      {/* Уровень */}
      <div className="glass glass-hero relative overflow-hidden p-5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-2xl"
          style={{ background: LEVEL_TINT[level] }}
        />
        <div className="relative flex items-center justify-between gap-3">
          <span className="label">{t('friends.level')}</span>
          <span className="rounded-pill bg-white/[0.1] px-2.5 py-1 text-[12px] font-semibold tabular-nums">{percent}%</span>
        </div>
        <div className="relative mt-3 text-[32px] font-bold leading-none tracking-[-0.03em]">{t(LEVEL_KEYS[level] ?? 'level.base')}</div>
        {next ? (
          <>
            <div className="relative mt-5 h-1.5 overflow-hidden rounded-pill bg-white/[0.08]">
              <div className="h-full rounded-pill bg-gradient-to-r from-white/40 to-white transition-[width] duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="relative mt-2.5 text-[13px] text-dim">
              {t('friends.toNext', { n: Math.max(0, next.min - active), level: t(LEVEL_KEYS[level + 1]), percent: next.percent })}
            </div>
          </>
        ) : (
          <div className="relative mt-3 text-[13px] text-dim">{t('friends.maxLevel')}</div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatTile icon={<ReferralsIcon className="h-5 w-5" />} label={t('friends.invited')} value={String(info?.invited ?? profile.referralsCount)} sub={t('friends.active', { n: active })} />
        <StatTile icon={<GiftIcon className="h-5 w-5" />} label={t('friends.earned')} value={formatRub(info?.earnedPaid ?? profile.referralEarned)} sub={info && info.earnedHold > 0 ? t('friends.onHold', { amount: formatRub(info.earnedHold) }) : t('friends.toBalance')} />
      </div>

      {/* Ссылка */}
      <Section title={t('friends.link')}>
        <div className="glass p-3">
          <div className="truncate rounded-2xl bg-white/[0.05] px-4 py-3.5 font-mono text-[13px] text-dim">{link.replace('https://', '')}</div>
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

      {/* Лестница уровней */}
      <Section title={t('friends.levels')}>
        <div className="glass divide-y divide-white/[0.06] overflow-hidden">
          {levels.map((l, i) => {
            const reached = i <= level
            return (
              <div key={i} className={`flex items-center gap-3.5 px-4 py-3.5 ${i === level ? 'bg-white/[0.04]' : ''}`}>
                <span className="tile !h-10 !w-10 !rounded-[13px]" style={{ background: `linear-gradient(160deg, ${LEVEL_TINT[i]}, rgba(255,255,255,0.03))` }}>
                  {reached ? <CheckIcon className="h-[18px] w-[18px]" strokeWidth={2.2} /> : <PercentIcon className="h-[18px] w-[18px] text-dim" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[15px] font-medium ${reached ? '' : 'text-dim'}`}>{t(LEVEL_KEYS[i])}</div>
                  <div className="text-[12.5px] leading-snug text-faint">
                    {i === 0 ? t('friends.fromStart') : t('friends.fromN', { n: l.min })}
                    {l.bonus ? `, ${t('friends.bonus', { days: l.bonus.days, plan: t(l.bonus.plan === 'pro' ? 'plan.pro' : 'plan.start') })}` : ''}
                  </div>
                </div>
                <span className={`text-[16px] font-semibold tabular-nums ${reached ? '' : 'text-dim'}`}>{l.percent}%</span>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Как это работает */}
      <Section title={t('friends.how')}>
        <div className="glass divide-y divide-white/[0.06] px-4">
          {(['friends.how1', 'friends.how2', 'friends.how3', 'friends.how4'] as const).map((k, i) => (
            <div key={k} className="flex items-start gap-3.5 py-3.5">
              <span className="tile !h-7 !w-7 !rounded-[9px] text-[12px] font-semibold">{i + 1}</span>
              <span className="pt-0.5 text-[14px] leading-snug text-dim">{t(k, { percent, days: info?.holdDays ?? REFERRAL.holdDays, bonus: trialVars.bonus })}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* История */}
      <Section
        action={
          <div className="flex gap-1.5">
            {(['earnings', 'friends'] as const).map((k) => (
              <button
                key={k}
                data-active={tab === k}
                onClick={() => {
                  haptic('select')
                  setTab(k)
                }}
                className="chip !h-8 !px-3 !text-[13px]"
              >
                {k === 'earnings' ? t('friends.tabEarnings') : t('friends.tabFriends')}
              </button>
            ))}
          </div>
        }
        title={t('friends.history')}
      >
        <div className="glass divide-y divide-white/[0.06] overflow-hidden">
          {tab === 'earnings' ? (
            earnings.length ? (
              earnings.map((e) => (
                <div key={e.id} className="flex items-center gap-3.5 px-4 py-3.5">
                  <span className="tile !h-10 !w-10 !rounded-[13px]">
                    <WalletIcon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">{t('friends.fromFriend')}</div>
                    <div className="text-[12.5px] text-faint">
                      {e.status === 'hold' ? t('friends.holdUntil', { date: formatDate(e.availableAt, lang) }) : e.status === 'paid' ? t('friends.credited', { date: formatDate(e.at, lang) }) : t('friends.cancelled')}
                    </div>
                  </div>
                  <span className={`text-[15px] font-semibold tabular-nums ${e.status === 'paid' ? 'text-ok' : e.status === 'hold' ? 'text-dim' : 'text-faint line-through'}`}>
                    {formatRub(e.amount, true)}
                  </span>
                </div>
              ))
            ) : (
              <Empty text={t('friends.emptyEarnings')} />
            )
          ) : friends.length ? (
            friends.map((f) => (
              <div key={f.id} className="flex items-center gap-3.5 px-4 py-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-[14px] font-semibold">{f.name.replace('@', '').slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{f.name}</div>
                  <div className="text-[12.5px] text-faint">{formatDate(f.joinedAt, lang)}</div>
                </div>
                <span className={`rounded-pill px-2.5 py-1 text-[12px] font-medium ${f.paid ? 'bg-ok/15 text-ok' : 'bg-white/[0.06] text-faint'}`}>
                  {f.paid ? t('friends.paid') : t('friends.notPaid')}
                </span>
              </div>
            ))
          ) : (
            <Empty text={t('friends.emptyFriends')} />
          )}
        </div>
      </Section>

      <p className="mt-5 px-3 text-center text-[12px] leading-relaxed text-faint">{t('friends.balanceNote')}</p>
    </>
  )
}

function StatTile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="glass p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-dim">{label}</span>
        <span className="tile !h-8 !w-8 !rounded-[10px]">{icon}</span>
      </div>
      <div className="mt-2 truncate text-[22px] font-semibold tabular-nums tracking-[-0.02em]">{value}</div>
      <div className="mt-0.5 truncate text-[12px] text-faint">{sub}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="px-5 py-6 text-center text-[14px] text-faint">{text}</div>
}
