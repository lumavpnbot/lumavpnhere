import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SeasonDecor from '@/components/seasonDecor'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { ClockIcon, GiftIcon, ReferralsIcon, ShareIcon, TrophyIcon } from '@/components/icons'
import { BOT_USERNAME } from '@/config'
import { useLang, useT, plural } from '@/i18n'
import { api, apiEnabled } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { shareReferral } from '@/lib/share'
import { haptic, notify } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

type Phase = 'off' | 'before' | 'live' | 'closed' | 'published'
type Source = 'referral_join' | 'referral_paid' | 'wheel' | 'admin'

interface Summary {
  phase: Phase
  tickets: number
  hold: number
  bySource: { referralJoin: number; referralPaid: number; wheel: number }
  invited: number
  limits: { total: number; referral: number; wheel: number }
  ticketsForJoin: number
  ticketsForPaid: number
  startAt: string
  ticketsUntil: string
  drawAt: string
}

interface WheelStatus {
  available: boolean
  reason: string | null
  sectors: { tickets: number; chance: number }[]
  spinsToday: number
  spinsPerDay: number
  ticketsFromWheel: number
  maxWheelTickets: number
  nextSpinAt: string
}

interface HistoryItem {
  at: string
  source: Source
  title: string
  friend: string | null
  amount: number
  revoked: boolean
  holdUntil: string | null
}

interface Prize {
  code: string
  title: string
  place: number
  count: number
}

interface Winner {
  place: number
  prize: string
  username: string | null
  tgId: string
  tickets: number
}

interface SpinResult {
  tickets: number
  sector: number
  total: number
}

/** Цвета секторов колеса: пусто серое, выигрышные от оранжевого к фиолетовому. */
const SECTOR_COLORS = ['rgba(255,255,255,0.07)', '#f97316', '#fb923c', '#a855f7', '#fbbf24']

const demo = () => ({
  summary: {
    phase: 'live' as Phase,
    tickets: 12,
    hold: 3,
    bySource: { referralJoin: 2, referralPaid: 3, wheel: 7 },
    invited: 2,
    limits: { total: 100, referral: 30, wheel: 30 },
    ticketsForJoin: 1,
    ticketsForPaid: 3,
    startAt: '2026-10-24T00:00:00+03:00',
    ticketsUntil: '2026-10-31T23:59:00+03:00',
    drawAt: '2026-11-01T12:00:00+03:00',
  },
  wheel: {
    available: true,
    reason: null,
    sectors: [
      { tickets: 0, chance: 55 },
      { tickets: 1, chance: 25 },
      { tickets: 2, chance: 13 },
      { tickets: 3, chance: 5 },
      { tickets: 5, chance: 2 },
    ],
    spinsToday: 0,
    spinsPerDay: 1,
    ticketsFromWheel: 7,
    maxWheelTickets: 30,
    nextSpinAt: new Date(Date.now() + 3600_000).toISOString(),
  } as WheelStatus,
  history: [
    { at: new Date().toISOString(), source: 'wheel' as Source, title: 'Колесо фортуны', friend: null, amount: 3, revoked: false, holdUntil: null },
    { at: new Date(Date.now() - 86400_000).toISOString(), source: 'referral_join' as Source, title: 'Друг присоединился', friend: 'friend', amount: 1, revoked: false, holdUntil: null },
  ],
  prizes: [
    { code: 'airpods', title: 'AirPods 3 Pro', place: 1, count: 1 },
    { code: 'pro_year', title: '1 год Премиум', place: 2, count: 2 },
    { code: 'pro_6m', title: '6 месяцев Премиум', place: 3, count: 3 },
    { code: 'start_3m', title: '3 месяца Старт', place: 4, count: 5 },
    { code: 'start_1m', title: '1 месяц Старт', place: 5, count: 10 },
  ],
  stats: { tickets: 2341, participants: 418 },
})

/** Хэллоуин-розыгрыш: билеты за друзей, колесо фортуны раз в сутки, 21 приз. */
export default function HalloweenPage() {
  const t = useT()
  const lang = useLang()
  const profile = useAppStore((s) => s.profile)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [wheel, setWheel] = useState<WheelStatus | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [prizes, setPrizes] = useState<Prize[]>([])
  const [stats, setStats] = useState<{ tickets: number; participants: number }>({ tickets: 0, participants: 0 })
  const [winners, setWinners] = useState<Winner[]>([])
  const [spinning, setSpinning] = useState(false)
  const [angle, setAngle] = useState(0)
  const [result, setResult] = useState<SpinResult | null>(null)
  const [loading, setLoading] = useState(true)
  const turns = useRef(0)

  const load = useCallback(async () => {
    if (!apiEnabled) {
      const d = demo()
      setSummary(d.summary)
      setWheel(d.wheel)
      setHistory(d.history)
      setPrizes(d.prizes)
      setStats(d.stats)
      setLoading(false)
      return
    }
    try {
      const [s, w, h, p, st, win] = await Promise.all([
        api.get<Summary>('/api/halloween/tickets'),
        api.get<WheelStatus>('/api/halloween/wheel/status'),
        api.get<{ history: HistoryItem[] }>('/api/halloween/tickets/history'),
        api.get<{ prizes: Prize[] }>('/api/halloween/prizes'),
        api.get<{ tickets: number; participants: number }>('/api/halloween/stats'),
        api.get<{ published: boolean; winners: Winner[] }>('/api/halloween/winners'),
      ])
      setSummary(s)
      setWheel(w)
      setHistory(h.history)
      setPrizes(p.prizes)
      setStats(st)
      setWinners(win.published ? win.winners : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sectors = wheel?.sectors ?? []
  // Сектора рисуем равными долями круга: шанс задаёт не размер, а вероятность выпадения.
  const gradient = useMemo(() => {
    if (!sectors.length) return 'rgba(255,255,255,0.06)'
    const step = 360 / sectors.length
    return `conic-gradient(${sectors.map((s, i) => `${SECTOR_COLORS[i % SECTOR_COLORS.length]} ${i * step}deg ${(i + 1) * step}deg`).join(', ')})`
  }, [sectors])

  const spin = async () => {
    if (spinning || !wheel?.available) return
    haptic('medium')
    setSpinning(true)
    setResult(null)
    try {
      const r = apiEnabled
        ? await api.post<SpinResult>('/api/halloween/wheel/spin')
        : await new Promise<SpinResult>((resolve) => setTimeout(() => resolve({ tickets: 2, sector: 2, total: (summary?.tickets ?? 0) + 2 }), 600))
      // Докручиваем до выпавшего сектора: четыре полных оборота плюс его середина.
      const step = 360 / Math.max(1, sectors.length)
      turns.current += 4
      setAngle(turns.current * 360 - (r.sector * step + step / 2))
      window.setTimeout(() => {
        setResult(r)
        haptic(r.tickets > 0 ? 'success' : 'light')
        setSummary((prev) => (prev ? { ...prev, tickets: r.total } : prev))
        void load()
      }, 3200)
    } catch (e) {
      notify((e as Error).message)
      void load()
    } finally {
      window.setTimeout(() => setSpinning(false), 3200)
    }
  }

  const share = async () => {
    haptic('light')
    const link = profile.referralLink ?? `https://t.me/${BOT_USERNAME}`
    await shareReferral(link, t('hw.shareText'))
  }

  const candyWord = (n: number) => plural(lang, n, { ru: ['конфета', 'конфеты', 'конфет'], en: ['candy', 'candy'] })
  const phase = summary?.phase ?? 'off'
  const closed = phase === 'closed' || phase === 'published'

  if (loading) {
    return (
      <>
        <TopBar />
        <PageTitle title={t('hw.title')} subtitle={t('hw.subtitle')} />
      </>
    )
  }

  return (
    <>
      {/* Паутина, тыквы и мыши: только на этом экране, общий фон приложения не меняем. */}
      <SeasonDecor />
      <TopBar />
      <PageTitle title={t('hw.title')} subtitle={t('hw.subtitle')} />

      {/* ── Счётчик конфет ── */}
      <div className="glass glass-hero relative overflow-hidden p-5">
        <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 text-[120px] leading-none opacity-[0.12]">
          🎃
        </span>
        <span className="label">{t('hw.yourTickets')}</span>
        <div className="mt-2 flex items-end gap-2">
          <span className="text-[44px] font-bold leading-none tabular-nums">{summary?.tickets ?? 0}</span>
          <span className="pb-1 text-[15px] text-dim">{candyWord(summary?.tickets ?? 0)}</span>
        </div>
        {!!summary?.hold && <div className="mt-2 text-[12px] text-faint">{t('hw.hold', { n: summary.hold })}</div>}
        <div className="mt-4 text-[13px] text-dim">{t('hw.pool', { tickets: stats.tickets, people: stats.participants })}</div>
        <div className="mt-3 flex items-center gap-2 text-[12px] text-faint">
          <ClockIcon className="h-[14px] w-[14px]" />
          {phase === 'before'
            ? t('hw.startsAt', { date: formatDate(summary?.startAt ?? '', lang) })
            : closed
              ? t('hw.closedAt', { date: formatDate(summary?.drawAt ?? '', lang) })
              : t('hw.until', { date: formatDate(summary?.ticketsUntil ?? '', lang) })}
        </div>
      </div>

      {/* ── Колесо фортуны ── */}
      <Section title={t('hw.wheel')}>
        <div className="glass flex flex-col items-center p-5">
          <div className="relative flex h-[220px] w-[220px] items-center justify-center">
            <span
              aria-hidden
              className="absolute -top-1 z-10 h-0 w-0 border-x-[9px] border-t-[14px] border-x-transparent border-t-[#f97316]"
            />
            <div
              className="h-full w-full rounded-full border border-white/10 shadow-[0_18px_50px_rgba(249,115,22,0.18)]"
              style={{
                background: gradient,
                transform: `rotate(${angle}deg)`,
                transition: 'transform 3s cubic-bezier(0.15, 0.6, 0.15, 1)',
              }}
            />
            <div className="pointer-events-none absolute flex h-[86px] w-[86px] flex-col items-center justify-center rounded-full bg-[#0b0b0d] text-center">
              <span className="text-[22px] leading-none">🎃</span>
              {result && (
                <span className="mt-1 text-[12px] font-semibold">
                  {result.tickets > 0 ? `+${result.tickets}` : t('hw.empty')}
                </span>
              )}
            </div>
          </div>

          <button onClick={spin} disabled={!wheel?.available || spinning} className="btn-glass-strong mt-5 w-full disabled:opacity-50">
            {spinning ? t('hw.spinning') : t('hw.spin')}
          </button>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-faint">
            {wheel?.available
              ? t('hw.spinsLeft', { n: Math.max(0, (wheel?.spinsPerDay ?? 1) - (wheel?.spinsToday ?? 0)) })
              : t(`hw.reason.${wheel?.reason ?? 'off'}` as 'hw.reason.off')}
          </p>
          {!!sectors.length && (
            <div className="mt-4 grid w-full grid-cols-5 gap-1.5">
              {sectors.map((s, i) => (
                <span key={i} className="rounded-xl bg-white/[0.05] px-1 py-2 text-center">
                  <span className="block text-[12px] font-semibold" style={{ color: SECTOR_COLORS[i % SECTOR_COLORS.length] }}>
                    {s.tickets ? `+${s.tickets} 🍬` : '—'}
                  </span>
                  <span className="block text-[10px] text-faint tabular-nums">{s.chance}%</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* ── Билеты за друзей ── */}
      <Section title={t('hw.friends')}>
        <div className="glass p-5">
          <div className="grid grid-cols-2 gap-2.5">
            <span className="rounded-2xl bg-white/[0.05] p-3">
              <span className="block text-[20px] font-semibold text-[#f97316]">+{summary?.ticketsForJoin ?? 1}</span>
              <span className="mt-1 block text-[12px] leading-snug text-dim">{t('hw.forJoin')}</span>
            </span>
            <span className="rounded-2xl bg-white/[0.05] p-3">
              <span className="block text-[20px] font-semibold text-[#a855f7]">+{summary?.ticketsForPaid ?? 3}</span>
              <span className="mt-1 block text-[12px] leading-snug text-dim">{t('hw.forPaid')}</span>
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[13px] text-dim">
            <ReferralsIcon className="h-4 w-4" />
            {t('hw.invited', { n: summary?.invited ?? 0, max: summary?.limits.referral ?? 30 })}
          </div>
          <button onClick={share} className="btn-glass mt-4 flex w-full items-center justify-center gap-2">
            <ShareIcon className="h-4 w-4" />
            {t('hw.invite')}
          </button>
        </div>
      </Section>

      {/* ── Призы ── */}
      <Section title={t('hw.prizes')}>
        <div className="glass overflow-hidden">
          {prizes.map((p, i) => (
            <div key={p.code} className={`flex items-center gap-3 px-4 py-3 ${i ? 'border-t border-white/[0.06]' : ''}`}>
              <span className="tile">{p.place === 1 ? <TrophyIcon className="h-[18px] w-[18px]" /> : <GiftIcon className="h-[18px] w-[18px]" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{p.title}</span>
                <span className="block text-[12px] text-faint">{t('hw.winners', { n: p.count })}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-faint">{t('hw.consolation')}</p>
      </Section>

      {/* ── Победители: только после публикации ── */}
      {!!winners.length && (
        <Section title={t('hw.winnersTitle')}>
          <div className="glass overflow-hidden">
            {winners.map((w, i) => (
              <div key={`${w.place}-${i}`} className={`flex items-center gap-3 px-4 py-3 ${i ? 'border-t border-white/[0.06]' : ''}`}>
                <span className="text-[15px]">{w.place === 1 ? '🥇' : w.place === 2 ? '🥈' : '🏅'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{w.username ? `@${w.username}` : `ID ••${w.tgId}`}</span>
                  <span className="block truncate text-[12px] text-faint">{w.prize}</span>
                </span>
                <span className="text-[12px] tabular-nums text-dim">{w.tickets}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── История билетов ── */}
      <Section title={t('hw.history')}>
        <div className="glass overflow-hidden">
          {history.length ? (
            history.map((h, i) => (
              <div key={`${h.at}-${i}`} className={`flex items-center gap-3 px-4 py-3 ${i ? 'border-t border-white/[0.06]' : ''}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">
                    {h.title}
                    {h.friend ? ` · @${h.friend}` : ''}
                  </span>
                  <span className="block text-[12px] text-faint">
                    {formatDate(h.at, lang)}
                    {h.holdUntil ? ` · ${t('hw.onHold')}` : ''}
                    {h.revoked ? ` · ${t('hw.revoked')}` : ''}
                  </span>
                </span>
                <span className={`text-[14px] font-semibold tabular-nums ${h.amount ? 'text-ok' : 'text-faint'}`}>
                  {h.amount ? `+${h.amount}` : t('hw.empty')}
                </span>
              </div>
            ))
          ) : (
            <div className="px-4 py-6 text-center text-[13px] text-faint">{t('hw.historyEmpty')}</div>
          )}
        </div>
      </Section>

      {/* ── Инструкция: как всё устроено от первой конфеты до призов ── */}
      <Section title={t('hw.how')}>
        <div className="glass p-5">
          <p className="text-[13px] text-dim">{t('hw.howHint')}</p>
          <ol className="mt-4 space-y-3.5">
            {([1, 2, 3, 4, 5, 6] as const).map((i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f97316]/15 text-[11px] font-semibold text-[#f97316] tabular-nums">
                  {i}
                </span>
                <span className="text-[13px] leading-relaxed text-dim">{t(`hw.how${i}` as 'hw.how1')}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-white/[0.06] pt-3 text-[12px] leading-relaxed text-faint">{t('hw.howQuestions')}</p>
        </div>
      </Section>

      <p className="mt-4 px-1 pb-2 text-[12px] leading-relaxed text-faint">{t('hw.rules')}</p>
    </>
  )
}
