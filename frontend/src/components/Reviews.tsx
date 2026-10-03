import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Sheet from '@/components/Sheet'
import { useLang, useT, type TKey } from '@/i18n'
import { timeAgo } from '@/lib/format'
import { confirmDialog, haptic, notify } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'

// ── Типы и данные ───────────────────────────────────────────────────────────

export interface ReviewSummary {
  count: number
  withText: number
  average: number
  weighted: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
}

export interface PublicReview {
  id: string
  name: string
  initial: string
  rating: number
  text: string | null
  paid: boolean
  edited: boolean
  at: string
}

export interface MyReview {
  rating: number
  text: string | null
  hidden: boolean
  at: string
}

interface SummaryResponse {
  summary: ReviewSummary
  latest: PublicReview[]
  mine: MyReview | null
  eligible: { ok: true } | { ok: false; reason: string }
}

const DAY = 86_400_000
const DEMO: SummaryResponse = {
  summary: { count: 128, withText: 54, average: 4.72, weighted: 4.79, distribution: { '5': 104, '4': 15, '3': 5, '2': 2, '1': 2 } },
  latest: [
    { id: '3', name: '@ale•••', initial: 'A', rating: 5, text: 'Подключился за минуту, всё работает стабильно и быстро. Поддержка ответила за пять минут.', paid: true, edited: false, at: new Date(Date.now() - 3 * 3600e3).toISOString() },
    { id: '2', name: '@mar•••', initial: 'M', rating: 4, text: 'Хорошая скорость, удобно, что всё прямо в Telegram.', paid: false, edited: true, at: new Date(Date.now() - DAY).toISOString() },
    { id: '1', name: 'Пользователь LYNK', initial: 'L', rating: 5, text: 'Лучший сервис из тех, что пробовал.', paid: true, edited: false, at: new Date(Date.now() - 3 * DAY).toISOString() },
  ],
  mine: null,
  eligible: { ok: true },
}

/** Сводка, последние отзывы, свой отзыв. reload() после сохранения. */
export function useReviews() {
  const [data, setData] = useState<SummaryResponse | null>(apiEnabled ? null : DEMO)
  const [error, setError] = useState(false)
  const reload = useCallback(async () => {
    if (!apiEnabled) return
    try {
      setData(await api.get<SummaryResponse>('/reviews/summary'))
      setError(false)
    } catch {
      setError(true)
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { data, error, reload, setData }
}

// ── Звёзды ──────────────────────────────────────────────────────────────────

const STAR_PATH = 'M12 2.6l2.83 6.08 6.67.78-4.95 4.55 1.33 6.59L12 17.27l-5.88 3.33 1.33-6.59L2.5 9.46l6.67-.78z'

function StarShape({ size, className = '' }: { size: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <path d={STAR_PATH} fill="currentColor" stroke="currentColor" strokeWidth={0.6} strokeLinejoin="round" />
    </svg>
  )
}

/** Звёзды для показа, с дробным заполнением (4.7 → почти пять). */
export function Stars({ value, size = 14, gap = 2 }: { value: number; size?: number; gap?: number }) {
  const pct = Math.max(0, Math.min(1, value / 5)) * 100
  const row = (cls: string) => (
    <span className="flex shrink-0" style={{ gap }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <StarShape key={i} size={size} className={cls} />
      ))}
    </span>
  )
  return (
    <span className="relative inline-flex" aria-label={`${value.toFixed(1)} / 5`}>
      {row('text-white/[0.14]')}
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>
        {row('text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.35)]')}
      </span>
    </span>
  )
}

const LABELS: TKey[] = ['reviews.l1', 'reviews.l2', 'reviews.l3', 'reviews.l4', 'reviews.l5']

/** Выбор оценки: крупные звёзды, нажатие с отскоком. */
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center">
      <div className="flex gap-2.5" role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= value
          return (
            <motion.button
              key={n}
              role="radio"
              aria-checked={n === value}
              aria-label={`${n}`}
              whileTap={{ scale: 0.82 }}
              animate={{ scale: n === value ? [1, 1.22, 1] : 1 }}
              transition={{ duration: 0.32, ease: 'easeOut' }}
              onClick={() => {
                haptic(n === value ? 'select' : 'light')
                onChange(n)
              }}
              className="p-1"
            >
              <StarShape
                size={42}
                className={`transition-colors duration-200 ${on ? 'text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.45)]' : 'text-white/[0.14]'}`}
              />
            </motion.button>
          )
        })}
      </div>
      <div className="mt-2 h-5 text-[14px] font-medium text-dim">{value ? t(LABELS[value - 1]) : t('reviews.tap')}</div>
    </div>
  )
}

// ── Карточка отзыва ─────────────────────────────────────────────────────────

export function ReviewCard({ r }: { r: PublicReview }) {
  const t = useT()
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const long = (r.text?.length ?? 0) > 220
  return (
    <div className="glass p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white/25 to-white/[0.06] text-[15px] font-semibold ring-1 ring-white/15">
          {r.initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium">{r.name}</span>
            {r.paid && <span className="shrink-0 rounded-pill bg-white/[0.09] px-2 py-0.5 text-[11px] font-medium text-dim">{t('reviews.paid')}</span>}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-faint">
            <Stars value={r.rating} size={12} gap={1.5} />
            <span>
              {timeAgo(r.at, lang)}
              {r.edited ? ` · ${t('reviews.edited')}` : ''}
            </span>
          </div>
        </div>
      </div>
      {r.text && (
        <p
          onClick={() => long && setOpen((v) => !v)}
          className={`mt-3 whitespace-pre-line break-words text-[14px] leading-relaxed text-dim ${!open && long ? 'line-clamp-4' : ''}`}
        >
          {r.text}
        </p>
      )}
      {long && !open && (
        <button onClick={() => setOpen(true)} className="mt-1 text-[13px] font-medium text-fg/80">
          {t('reviews.more')}
        </button>
      )}
    </div>
  )
}

// ── Сводка ──────────────────────────────────────────────────────────────────

export function SummaryCard({ s }: { s: ReviewSummary }) {
  const t = useT()
  return (
    <div className="glass glass-hero relative overflow-hidden p-5">
      <div aria-hidden="true" className="pointer-events-none absolute -left-16 -top-20 h-48 w-48 rounded-full bg-white/[0.08] blur-2xl" />
      <div className="relative flex items-center gap-5">
        <div className="shrink-0 text-center">
          <div className="text-[46px] font-bold leading-none tabular-nums tracking-[-0.04em]">{s.count ? s.average.toFixed(1) : '–'}</div>
          <div className="mt-2">
            <Stars value={s.average} size={14} />
          </div>
          <div className="mt-1.5 text-[12px] text-faint">{t('reviews.count', { n: s.count })}</div>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          {(['5', '4', '3', '2', '1'] as const).map((k) => {
            const c = s.distribution[k] ?? 0
            const pct = s.count ? (c / s.count) * 100 : 0
            return (
              <div key={k} className="flex items-center gap-2 text-[11px] tabular-nums text-faint">
                <span className="w-2.5 text-right">{k}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-white/[0.08]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full rounded-pill bg-gradient-to-r from-white/50 to-white"
                  />
                </div>
                <span className="w-7 text-right">{c}</span>
              </div>
            )
          })}
        </div>
      </div>
      {s.count > 0 && (
        <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3.5 text-[13px]">
          <span className="text-dim">{t('reviews.weighted')}</span>
          <span className="flex items-center gap-2">
            <span className="font-semibold tabular-nums">{s.weighted.toFixed(2)}</span>
            <span className="text-faint">{t('reviews.weightedHint')}</span>
          </span>
        </div>
      )}
    </div>
  )
}

// ── Шторка: оставить / изменить ─────────────────────────────────────────────

export function ReviewSheet({
  open,
  onClose,
  mine,
  eligible,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  mine: MyReview | null
  eligible: SummaryResponse['eligible']
  onSaved: () => void
}) {
  const t = useT()
  const [rating, setRating] = useState(mine?.rating ?? 0)
  const [text, setText] = useState(mine?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRating(mine?.rating ?? 0)
    setText(mine?.text ?? '')
    setError(null)
  }, [open, mine])

  const save = async () => {
    if (!rating) return
    haptic('medium')
    setBusy(true)
    setError(null)
    try {
      if (apiEnabled) await api.put('/reviews/me', { rating, text: text.trim() || null })
      haptic('success')
      onSaved()
      onClose()
    } catch (err) {
      haptic('error')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!(await confirmDialog(t('reviews.deleteConfirm')))) return
    setBusy(true)
    try {
      if (apiEnabled) await api.del('/reviews/me')
      haptic('success')
      onSaved()
      onClose()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const blocked = !eligible.ok && !mine
  return (
    <Sheet open={open} onClose={onClose} title={mine ? t('reviews.editTitle') : t('reviews.newTitle')}>
      {blocked ? (
        <div className="pb-2 text-center">
          <p className="text-[15px] leading-snug text-dim">{!eligible.ok ? eligible.reason : ''}</p>
          <button onClick={onClose} className="btn-glass mt-5 w-full">
            {t('plans.close')}
          </button>
        </div>
      ) : (
        <>
          <StarPicker value={rating} onChange={setRating} />
          <div className="relative mt-5">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 1000))}
              rows={4}
              placeholder={t('reviews.placeholder')}
              className="field !h-auto resize-none py-3.5 leading-snug"
            />
            <span className="pointer-events-none absolute bottom-2.5 right-3.5 text-[11px] tabular-nums text-faint">{text.length}/1000</span>
          </div>
          <p className="mt-2 px-1 text-[12px] leading-snug text-faint">{t('reviews.rules')}</p>
          {mine?.hidden && <p className="mt-2 px-1 text-[12px] text-warn">{t('reviews.hiddenNote')}</p>}
          {error && <p className="mt-2 px-1 text-[13px] text-bad">{error}</p>}
          <button onClick={save} disabled={busy || !rating} className="btn-glass-strong mt-5 w-full">
            {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : mine ? t('reviews.saveEdit') : t('reviews.publish')}
          </button>
          {mine && (
            <button onClick={remove} disabled={busy} className="mt-3 w-full text-center text-[13px] text-faint active:text-bad">
              {t('reviews.delete')}
            </button>
          )}
        </>
      )}
    </Sheet>
  )
}

// ── Секция на главной ───────────────────────────────────────────────────────

export function ReviewsSection({ onAll }: { onAll: () => void }) {
  const t = useT()
  const { data, error, reload } = useReviews()
  const [sheet, setSheet] = useState(false)

  if (!data) {
    return (
      <div className="glass flex h-[132px] items-center justify-center">
        {error ? (
          <button onClick={() => void reload()} className="text-[13px] text-faint">
            {t('reviews.retry')}
          </button>
        ) : (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
        )}
      </div>
    )
  }

  return (
    <>
      <SummaryCard s={data.summary} />

      <button
        onClick={() => {
          haptic('light')
          setSheet(true)
        }}
        className="glass press mt-3 flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
      >
        <span className="tile !h-10 !w-10 !rounded-[13px]">
          <StarShape size={18} className="text-fg" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">{data.mine ? t('reviews.yours') : t('reviews.leave')}</span>
          <span className="block truncate text-[13px] text-faint">
            {data.mine ? (data.mine.text ? `«${data.mine.text}»` : t('reviews.noText')) : t('reviews.leaveHint')}
          </span>
        </span>
        {data.mine ? <Stars value={data.mine.rating} size={13} /> : <span className="text-[13px] font-medium text-fg/80">{t('reviews.rate')}</span>}
      </button>

      {data.latest.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {data.latest.map((r) => (
            <ReviewCard key={r.id} r={r} />
          ))}
        </div>
      )}

      {data.summary.count > 0 && (
        <button
          onClick={() => {
            haptic('light')
            onAll()
          }}
          className="btn-glass mt-3 w-full !h-11 !text-[14px]"
        >
          {t('reviews.all', { n: data.summary.count })}
        </button>
      )}

      <ReviewSheet open={sheet} onClose={() => setSheet(false)} mine={data.mine} eligible={data.eligible} onSaved={() => void reload()} />
    </>
  )
}
