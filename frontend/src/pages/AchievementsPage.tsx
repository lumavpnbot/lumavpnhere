import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Sheet from '@/components/Sheet'
import { Toggle } from '@/components/controls'
import { AchievementIcon, RarityPill, RARITY_COLOR } from '@/components/achievements'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { ChatIcon, ClockIcon, DevicesIcon, PercentIcon, PlusIcon, ShareIcon, StarIcon } from '@/components/icons'
import { BOT_USERNAME } from '@/config'
import { useLang, useT, type TKey } from '@/i18n'
import { useTrialVars } from '@/lib/trial'
import { formatDate } from '@/lib/format'
import { api, apiEnabled } from '@/lib/api'
import { shareReferral } from '@/lib/share'
import { haptic, notify } from '@/lib/telegram'
import { useAppStore, type Rarity } from '@/store/useAppStore'

type Category = 'social' | 'loyalty' | 'special' | 'secret'

interface Achievement {
  code: string
  category: Category
  rarity: Rarity
  secret: boolean
  unlocked: boolean
  unlockedAt: string | null
  showcaseSlot: number | null
  title: string
  desc: string
  progress: { value: number; target: number } | null
  rewards: { kind: 'days' | 'discount' | 'device'; label: string }[]
  date: string | null
}

interface Rewards {
  daysGranted: number
  discounts: { id: string; percent: number; from: string; expiresAt: string | null; reusable: boolean; applyNext: boolean }[]
  bonusDevices: number
  devices: { id: string; value: number; from: string; forever: boolean }[]
  nextPaymentDiscount: number
  maxDiscount: number
}

const CATEGORIES: Category[] = ['social', 'loyalty', 'special', 'secret']
const REWARD_CLS = {
  days: 'text-ok bg-ok/10 border-ok/25',
  discount: 'text-warn bg-warn/10 border-warn/25',
  device: 'text-[#93b8ff] bg-[#93b8ff]/10 border-[#93b8ff]/25',
}

function demoData(): { achievements: Achievement[]; rewards: Rewards } {
  const a = (code: string, category: Category, rarity: Rarity, title: string, desc: string, extra: Partial<Achievement> = {}): Achievement => ({
    code, category, rarity, secret: false, unlocked: false, unlockedAt: null, showcaseSlot: null, title, desc, progress: null, rewards: [], date: null, ...extra,
  })
  return {
    achievements: [
      a('first_friend', 'social', 'common', 'Первый друг', 'Приглашён 1 активный реферал', { unlocked: true, unlockedAt: new Date().toISOString(), showcaseSlot: 0, rewards: [{ kind: 'days', label: '+3 дня' }] }),
      a('referrer', 'social', 'rare', 'Реферер', '5 активных рефералов с оплатой', { progress: { value: 3, target: 5 }, rewards: [{ kind: 'device', label: '+1 устройство' }, { kind: 'days', label: '+3 дня' }] }),
      a('yearly', 'loyalty', 'rare', 'Годовой', 'Купил годовую подписку', { rewards: [{ kind: 'device', label: '+1 устройство навсегда' }] }),
      a('comeback', 'secret', 'rare', '???', 'Продолжайте пользоваться сервисом, чтобы разблокировать', { secret: true, rewards: [{ kind: 'days', label: '???' }] }),
    ],
    rewards: { daysGranted: 3, discounts: [], bonusDevices: 0, devices: [], nextPaymentDiscount: 0, maxDiscount: 25 },
  }
}

/** ТЗ v6.3 · 03: достижения, шоукейс из трёх бейджей и «Мои награды». */
export default function AchievementsPage() {
  const t = useT()
  const lang = useLang()
  const trialVars = useTrialVars()
  const profile = useAppStore((s) => s.profile)
  const refresh = useAppStore((s) => s.refresh)
  const [items, setItems] = useState<Achievement[]>([])
  const [rewards, setRewards] = useState<Rewards | null>(null)
  const [tab, setTab] = useState<'badges' | 'rewards'>('badges')
  const [pinSlot, setPinSlot] = useState<number | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!apiEnabled) {
      const d = demoData()
      setItems(d.achievements)
      setRewards(d.rewards)
      setLoading(false)
      return
    }
    try {
      const [a, r] = await Promise.all([api.get<{ achievements: Achievement[] }>(`/api/achievements?lang=${lang}`), api.get<Rewards>('/api/achievements/rewards')])
      setItems(a.achievements)
      setRewards(r)
    } finally {
      setLoading(false)
    }
  }, [lang])

  useEffect(() => {
    void load()
  }, [load])

  const unlocked = items.filter((a) => a.unlocked)
  const slots = [0, 1, 2].map((i) => items.find((a) => a.showcaseSlot === i) ?? null)

  const saveShowcase = async (codes: string[]) => {
    haptic('select')
    setItems((prev) => prev.map((a) => ({ ...a, showcaseSlot: codes.includes(a.code) ? codes.indexOf(a.code) : null })))
    if (apiEnabled) {
      await api.post('/api/achievements/showcase', { codes }).catch((e: Error) => notify(e.message))
      void refresh()
    }
  }

  const pin = (code: string | null) => {
    if (pinSlot == null) return
    const codes = slots.map((s) => s?.code ?? null)
    const existing = code ? codes.indexOf(code) : -1
    if (existing >= 0) codes[existing] = null
    codes[pinSlot] = code
    setPinSlot(null)
    void saveShowcase(codes.filter((c): c is string => !!c))
  }

  const share = async () => {
    haptic('light')
    const link = profile.referralLink ?? `https://t.me/${BOT_USERNAME}`
    const unlockedNow = await shareReferral(link, t('friends.shareText', trialVars))
    if (unlockedNow) {
      haptic('success')
      notify(t('ach.shareDone'))
      void load()
      void refresh()
    }
  }

  const toggleApply = async (id: string, enabled: boolean) => {
    setRewards((r) => (r ? { ...r, discounts: r.discounts.map((d) => (d.id === id ? { ...d, applyNext: enabled } : d)) } : r))
    if (!apiEnabled) return
    try {
      setRewards(await api.post<Rewards>('/api/achievements/rewards/apply', { rewardId: id, enabled }))
      void refresh()
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
      void load()
    }
  }

  return (
    <>
      <TopBar />
      <PageTitle title={t('ach.title')} subtitle={t('ach.subtitle')} />

      {/* Шоукейс: три слота */}
      <div className="glass glass-hero p-4">
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="label">{t('ach.showcase')}</span>
          <span className="text-[12px] text-faint tabular-nums">
            {unlocked.length} / {items.length || 16}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {slots.map((a, i) => (
            <button
              key={i}
              onClick={() => {
                haptic('light')
                if (!unlocked.length) return notify(t('ach.noneToPin'))
                setPinSlot(i)
              }}
              className={`press flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center ${
                a ? 'bg-white/[0.07]' : 'border border-dashed border-white/[0.14] bg-black/20'
              }`}
              style={a ? { boxShadow: `inset 0 0 0 1px ${RARITY_COLOR[a.rarity]}40` } : undefined}
            >
              {a ? (
                <>
                  <AchievementIcon code={a.code} rarity={a.rarity} size={40} />
                  <span className="line-clamp-2 text-[11.5px] font-semibold leading-tight">{a.title}</span>
                </>
              ) : (
                <>
                  <PlusIcon className="h-6 w-6 text-faint" />
                  <span className="text-[11px] text-faint">{t('ach.pin')}</span>
                </>
              )}
            </button>
          ))}
        </div>
        <p className="mt-3 px-1 text-[12px] text-faint">{t('ach.showcaseHint')}</p>
      </div>

      <div className="mt-4 flex gap-1.5">
        {(['badges', 'rewards'] as const).map((k) => (
          <button key={k} data-active={tab === k} onClick={() => (haptic('select'), setTab(k))} className="chip flex-1 justify-center">
            {k === 'badges' ? t('ach.tabBadges') : t('ach.tabRewards')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="glass mt-4 flex justify-center py-10">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
        </div>
      ) : tab === 'badges' ? (
        CATEGORIES.map((cat) => {
          const list = items.filter((a) => a.category === cat)
          if (!list.length) return null
          return (
            <Section key={cat} title={t(`ach.cat.${cat}` as TKey)}>
              <div className="space-y-2.5">
                {list.map((a) => (
                  <BadgeCard key={a.code} a={a} lang={lang} onShare={a.code === 'sharing' && !a.unlocked ? share : undefined} onFeedback={a.code === 'feedback' && !a.unlocked ? () => setFeedbackOpen(true) : undefined} />
                ))}
              </div>
            </Section>
          )
        })
      ) : (
        rewards && <RewardsTab rewards={rewards} lang={lang} onToggle={toggleApply} />
      )}

      <Sheet open={pinSlot !== null} onClose={() => setPinSlot(null)} title={t('ach.pinTitle')}>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pb-1">
          {pinSlot !== null && slots[pinSlot] && (
            <button onClick={() => pin(null)} className="btn-glass w-full !h-11 !text-[14px]">
              {t('ach.unpin')}
            </button>
          )}
          {unlocked.map((a) => (
            <button key={a.code} onClick={() => pin(a.code)} className="press flex w-full items-center gap-3 rounded-2xl bg-white/[0.05] px-3 py-2.5 text-left">
              <AchievementIcon code={a.code} rarity={a.rarity} size={36} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{a.title}</span>
              <RarityPill rarity={a.rarity} />
            </button>
          ))}
        </div>
      </Sheet>

      <FeedbackSheet
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onDone={() => {
          setFeedbackOpen(false)
          void load()
          void refresh()
        }}
      />
    </>
  )
}

function BadgeCard({ a, lang, onShare, onFeedback }: { a: Achievement; lang: 'ru' | 'en'; onShare?: () => void; onFeedback?: () => void }) {
  const t = useT()
  const locked = !a.unlocked
  const color = RARITY_COLOR[a.rarity]
  return (
    <div
      className={`glass relative overflow-hidden p-4 ${locked && a.secret ? 'opacity-60' : ''}`}
      style={a.unlocked && (a.rarity === 'epic' || a.rarity === 'legendary') ? { background: `radial-gradient(circle at top right, ${color}1f, transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.03))` } : undefined}
    >
      <div className="flex items-start gap-3.5">
        <AchievementIcon code={a.code} rarity={a.rarity} locked={a.secret && locked} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className={`text-[15px] font-semibold ${locked ? 'text-dim' : ''}`}>{a.title}</span>
            <RarityPill rarity={a.rarity} />
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-dim">{a.desc}</p>
          {a.date && <p className="mt-0.5 font-mono text-[11px] text-faint">{new Date(a.date).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU')}</p>}
        </div>
      </div>
      {a.progress && locked && (
        <div className="mt-3">
          <div className="mb-1.5 flex justify-between font-mono text-[11.5px] text-faint">
            <span>{t('ach.progress')}</span>
            <span>
              {a.progress.value} / {a.progress.target}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-pill bg-white/[0.07]">
            <div className="h-full rounded-pill bg-gradient-to-r from-white to-white/40" style={{ width: `${Math.round((a.progress.value / a.progress.target) * 100)}%` }} />
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {a.rewards.map((r, i) => (
          <span key={i} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11.5px] font-semibold ${REWARD_CLS[r.kind]}`}>
            {r.kind === 'days' ? <ClockIcon className="h-3 w-3" /> : r.kind === 'discount' ? <PercentIcon className="h-3 w-3" /> : <DevicesIcon className="h-3 w-3" />}
            {r.label}
          </span>
        ))}
        {a.unlockedAt && <span className="ml-auto text-[11.5px] text-faint">{t('ach.unlockedAt', { date: formatDate(a.unlockedAt, lang) })}</span>}
      </div>
      {(onShare || onFeedback) && (
        <button onClick={onShare ?? onFeedback} className="btn-glass mt-3 w-full !h-10 !text-[14px]">
          {onShare ? <ShareIcon className="h-4 w-4" /> : <ChatIcon className="h-4 w-4" />}
          {onShare ? t('ach.share') : t('ach.feedback')}
        </button>
      )}
    </div>
  )
}

function RewardsTab({ rewards, lang, onToggle }: { rewards: Rewards; lang: 'ru' | 'en'; onToggle: (id: string, enabled: boolean) => void }) {
  const t = useT()
  return (
    <>
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Stat icon={<ClockIcon className="h-5 w-5" />} value={`+${rewards.daysGranted}`} label={t('ach.rewardsDays')} />
        <Stat icon={<PercentIcon className="h-5 w-5" />} value={`${rewards.nextPaymentDiscount}%`} label={t('ach.rewardsDiscount')} />
        <Stat icon={<DevicesIcon className="h-5 w-5" />} value={`+${rewards.bonusDevices}`} label={t('ach.rewardsDevices')} />
      </div>
      <p className="mt-2.5 px-1 text-[12px] text-faint">
        {t('ach.rewardsDiscountHint', { max: rewards.maxDiscount })}. {t('ach.rewardsDevicesHint')}.
      </p>

      <Section title={t('ach.discounts')}>
        <div className="glass divide-y divide-white/[0.06] overflow-hidden">
          {rewards.discounts.length === 0 ? (
            <div className="px-5 py-6 text-center text-[14px] text-faint">{t('ach.noDiscounts')}</div>
          ) : (
            rewards.discounts.map((d) => (
              <div key={d.id} className="px-4 py-3.5">
                <div className="flex items-center gap-3.5">
                  <span className="tile !h-10 !w-10 !rounded-[13px] text-[14px] font-bold">{d.percent}%</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{d.from}</span>
                    <span className="block text-[12.5px] text-faint">
                      {d.expiresAt ? t('ach.until', { date: formatDate(d.expiresAt, lang) }) : t('ach.forever')}
                      {d.reusable ? ` · ${t('ach.reusable')}` : ''}
                    </span>
                  </span>
                </div>
                {!d.reusable && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
                    <span className="text-[13px] text-dim">{t('ach.applyNext')}</span>
                    <Toggle checked={d.applyNext} onChange={(v) => onToggle(d.id, v)} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Section>

      {rewards.devices.length > 0 && (
        <Section title={t('ach.devicesList')}>
          <div className="glass divide-y divide-white/[0.06] overflow-hidden">
            {rewards.devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3.5 px-4 py-3.5">
                <span className="tile !h-10 !w-10 !rounded-[13px]">
                  <StarIcon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">+{d.value} · {d.from}</span>
                  <span className="block text-[12.5px] text-faint">{d.forever ? t('ach.deviceForever') : t('ach.deviceWhileSub')}</span>
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="glass flex flex-col items-center px-2 py-3.5 text-center">
      <span className="text-dim">{icon}</span>
      <span className="mt-1.5 text-[20px] font-bold tabular-nums">{value}</span>
      <span className="mt-0.5 text-[11px] leading-tight text-faint">{label}</span>
    </div>
  )
}

function FeedbackSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const [rating, setRating] = useState(5)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    haptic('medium')
    if (!apiEnabled) return notify(t('common.demoPay'))
    setBusy(true)
    try {
      await api.post('/api/achievements/feedback', { rating, text: text.trim() })
      haptic('success')
      notify(t('ach.feedbackDone'))
      setText('')
      onDone()
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('ach.feedbackTitle')}>
      <p className="mb-3 text-[14px] leading-snug text-dim">{t('ach.feedbackText')}</p>
      <div className="mb-3 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => (haptic('select'), setRating(n))} className="press p-1" aria-label={String(n)}>
            <StarIcon className={`h-8 w-8 ${n <= rating ? 'fill-warn text-warn' : 'text-faint'}`} />
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000} placeholder={t('ach.feedbackPlaceholder')} className="field !h-auto resize-none py-3.5 leading-snug" />
      <div className="mt-1.5 px-1 text-right text-[12px] tabular-nums text-faint">{text.trim().length} / 30</div>
      <button onClick={send} disabled={busy || text.trim().length < 30} className="btn-glass-strong mt-4 w-full">
        {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : t('ach.feedbackSend')}
      </button>
    </Sheet>
  )
}
