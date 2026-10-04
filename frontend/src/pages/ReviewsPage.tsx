import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { EarlyCard, FEW_REVIEWS, ReviewCard, ReviewSheet, SummaryCard, useReviews, type PublicReview } from '@/components/Reviews'
import { useT } from '@/i18n'
import { haptic } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'

type Filter = 'all' | 'text' | '5' | '4' | '3' | '2' | '1'
const FILTERS: Filter[] = ['all', 'text', '5', '4', '3', '2', '1']

/** Все отзывы: сводка, фильтры по звёздам, подгрузка порциями. */
export default function ReviewsPage() {
  const t = useT()
  const { data, reload } = useReviews()
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<PublicReview[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [params, setParams] = useSearchParams()

  // Кнопка «Оценить» из бота (?screen=review → /reviews?rate=1): сразу открываем выбор звёзд.
  useEffect(() => {
    if (!data || params.get('rate') !== '1') return
    setSheet(true)
    setParams({}, { replace: true })
  }, [data, params, setParams])

  const load = useCallback(
    async (f: Filter, after: string | null) => {
      if (!apiEnabled) {
        setItems(data?.latest ?? [])
        setCursor(null)
        return
      }
      setLoading(true)
      try {
        const q = new URLSearchParams()
        if (f === 'text') q.set('text', '1')
        else if (f !== 'all') q.set('stars', f)
        if (after) q.set('cursor', after)
        const r = await api.get<{ items: PublicReview[]; nextCursor: string | null }>(`/reviews?${q}`)
        setItems((prev) => (after ? [...prev, ...r.items] : r.items))
        setCursor(r.nextCursor)
      } finally {
        setLoading(false)
      }
    },
    [data],
  )

  useEffect(() => {
    void load(filter, null)
  }, [filter, load])

  return (
    <>
      <TopBar />
      <PageTitle title={t('reviews.title')} subtitle={t('reviews.subtitle')} />

      {data && (data.summary.count < FEW_REVIEWS ? <EarlyCard count={data.summary.count} rated={!!data.mine} /> : <SummaryCard s={data.summary} />)}

      {data && (
        <button
          onClick={() => {
            haptic('light')
            setSheet(true)
          }}
          className="btn-glass-strong mt-3 w-full"
        >
          {data.mine ? t('reviews.editTitle') : t('reviews.leave')}
        </button>
      )}

      <Section>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {FILTERS.map((f) => (
            <button
              key={f}
              data-active={filter === f}
              onClick={() => {
                haptic('select')
                setFilter(f)
              }}
              className="chip !h-9 shrink-0 !px-3.5 !text-[13px]"
            >
              {f === 'all' ? t('reviews.fAll') : f === 'text' ? t('reviews.fText') : `${f} ★`}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2.5">
          {items.map((r) => (
            <ReviewCard key={r.id} r={r} />
          ))}
          {!loading && items.length === 0 && <div className="glass px-5 py-8 text-center text-[14px] text-faint">{t('reviews.empty')}</div>}
          {loading && (
            <div className="flex justify-center py-6">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
            </div>
          )}
        </div>
        {cursor && !loading && (
          <button onClick={() => void load(filter, cursor)} className="btn-glass mt-3 w-full !h-11 !text-[14px]">
            {t('reviews.loadMore')}
          </button>
        )}
      </Section>

      {data && (
        <ReviewSheet
          open={sheet}
          onClose={() => setSheet(false)}
          mine={data.mine}
          eligible={data.eligible}
          onSaved={() => {
            void reload()
            void load(filter, null)
          }}
        />
      )}
    </>
  )
}
