import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, m } from 'framer-motion'
import Sheet from '@/components/Sheet'
import { Toggle } from '@/components/controls'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { CheckIcon, ChevronDown, GiftIcon, QrIcon, SparkIcon, WalletIcon } from '@/components/icons'
import { PLANS, type PlanId } from '@/config'
import { useT, type TKey } from '@/i18n'
import { formatRub } from '@/lib/format'
import { haptic, notify, openExternal, openInvoice } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'

type Period = 'month' | 'year'
// СБП принимаем через Platega. ЮKassa (карта) появится, когда её подключит сокомандник: бэкенд
// уже отдаёт список методов через GET /payments/methods.
type Method = 'stars' | 'platega_sbp' | 'crypto_usdt' | 'balance'

const METHODS: { id: Method; label: TKey; hint: TKey }[] = [
  { id: 'stars', label: 'plans.stars', hint: 'plans.starsHint' },
  { id: 'platega_sbp', label: 'plans.sbp', hint: 'plans.sbpHint' },
  { id: 'crypto_usdt', label: 'plans.crypto', hint: 'plans.cryptoHint' },
  { id: 'balance', label: 'plans.balance', hint: 'plans.balanceHint' },
]

interface OrderResponse {
  orderId: string
  status: 'paid' | 'pending'
  payload: string | null
  quote: { toPay: number; stars: number }
}

type Result = { kind: 'success' } | { kind: 'waiting'; orderId: string } | null

const round2 = (n: number) => Math.round(n * 100) / 100

export default function PlansPage() {
  const t = useT()
  const navigate = useNavigate()
  const balance = useAppStore((s) => s.profile.balance)
  const defaultPromo = useAppStore((s) => s.profile.defaultPromo)
  const prices = useAppStore((s) => s.prices)
  const maintenance = useAppStore((s) => s.maintenance)
  const refresh = useAppStore((s) => s.refresh)
  const rewardPercent = useAppStore((s) => s.profile.rewardDiscount ?? 0)

  const [period, setPeriod] = useState<Period>('month')
  const [planId, setPlanId] = useState<PlanId>('start')
  const [method, setMethod] = useState<Method>('stars')
  const [useBalance, setUseBalance] = useState(balance > 0)
  const [autoRenew, setAutoRenew] = useState(false)
  const [promoOpen, setPromoOpen] = useState(Boolean(defaultPromo))
  const [promoInput, setPromoInput] = useState(defaultPromo ?? '')
  const [promo, setPromo] = useState<{ code: string; percent: number } | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const poll = useRef<number | null>(null)
  const balanceTouched = useRef(false)

  // Баланс приходит с /me позже первого рендера: включаем «списать с баланса», пока пользователь сам не трогал переключатель.
  useEffect(() => {
    if (!balanceTouched.current) setUseBalance(balance > 0)
  }, [balance])

  const base = prices[planId][period]
  const discount = promo ? round2((base * promo.percent) / 100) : 0
  // Скидка за достижения применяется автоматически к цене после промокода (как на бэкенде).
  const achDiscount = round2((Math.max(0, base - discount) * rewardPercent) / 100)
  const total = round2(Math.max(0, base - discount - achDiscount))
  const fromBalance = method === 'balance' || useBalance ? round2(Math.min(balance, total)) : 0
  const toPay = round2(total - fromBalance)
  const notEnough = method === 'balance' && balance < total

  const yearSaving = useMemo(() => prices[planId].month * 12 - prices[planId].year, [prices, planId])

  useEffect(() => () => {
    if (poll.current) window.clearInterval(poll.current)
  }, [])

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase()
    if (!code) return
    haptic('light')
    setPromoError(null)
    if (!apiEnabled) {
      setPromo({ code, percent: 10 })
      return
    }
    try {
      const q = await api.post<{ promo: { code: string; percent: number } | null }>('/payments/quote', { plan: planId, period, promo: code })
      setPromo(q.promo)
      haptic('success')
    } catch (err) {
      setPromo(null)
      setPromoError(err instanceof Error ? err.message : String(err))
      haptic('error')
    }
  }

  const waitForPayment = (orderId: string) => {
    setResult({ kind: 'waiting', orderId })
    let tries = 0
    if (poll.current) window.clearInterval(poll.current)
    poll.current = window.setInterval(async () => {
      tries++
      try {
        // Бэкенд отдаёт paid только после выдачи доступа, так что /me уже вернёт новую подписку.
        const r = await api.get<{ status: string }>(`/payments/order/${orderId}`)
        if (r.status === 'paid') {
          window.clearInterval(poll.current!)
          await refresh()
          haptic('success')
          setResult({ kind: 'success' })
          return
        }
        if (r.status === 'failed') {
          window.clearInterval(poll.current!)
          setResult(null)
          haptic('error')
          notify(t('plans.payFailed'))
          return
        }
      } catch {
        /* повторим */
      }
      if (tries > 90) {
        window.clearInterval(poll.current!)
        void refresh()
      }
    }, 4000)
  }

  const pay = async () => {
    haptic('medium')
    if (!apiEnabled) {
      notify(t('common.demoPay'))
      return
    }
    setBusy(true)
    try {
      const order = await api.post<OrderResponse>('/payments/invoice', {
        plan: planId,
        period,
        method,
        promo: promo?.code,
        useBalance: method !== 'balance' && useBalance,
        autoRenew,
      })
      if (order.status === 'paid') {
        await refresh()
        haptic('success')
        setResult({ kind: 'success' })
      } else if (method === 'stars' && order.payload) {
        const status = await openInvoice(order.payload)
        if (status === 'paid') waitForPayment(order.orderId)
        else if (status === 'failed') notify(t('plans.payFailed'))
      } else if (order.payload) {
        openExternal(order.payload)
        waitForPayment(order.orderId)
      }
    } catch (err) {
      haptic('error')
      notify(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar />
      <PageTitle title={t('plans.title')} subtitle={t('plans.subtitle')} />

      {maintenance && (
        <div className="glass mb-4 border-l-2 border-warn/60 px-4 py-3 text-[14px] text-dim">{t('plans.maintenance')}</div>
      )}

      {/* Период */}
      <div className="glass relative grid grid-cols-2 !rounded-pill p-1">
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-pill bg-white/[0.14] transition-transform duration-300"
          style={{ transform: `translateX(${period === 'year' ? '100%' : '0'})`, transitionTimingFunction: 'var(--ease)' }}
        />
        {(['month', 'year'] as const).map((p) => (
          <button
            key={p}
            onClick={() => {
              haptic('select')
              setPeriod(p)
            }}
            className={`relative z-10 py-2.5 text-[14px] font-medium transition-colors ${period === p ? 'text-fg' : 'text-dim'}`}
          >
            {p === 'month' ? t('plans.month') : t('plans.year')}
            {p === 'year' && <span className="ml-1.5 rounded-pill bg-ok/15 px-1.5 py-0.5 text-[11px] font-semibold text-ok">{t('plans.twoFree')}</span>}
          </button>
        ))}
      </div>

      {/* Тарифы */}
      <div className="mt-4 space-y-3">
        {PLANS.map((plan) => {
          const selected = plan.id === planId
          const p = prices[plan.id][period]
          return (
            <button
              key={plan.id}
              onClick={() => {
                haptic('select')
                setPlanId(plan.id)
              }}
              className={`glass press w-full overflow-hidden p-5 text-left transition-opacity ${selected ? 'glass-hero' : 'opacity-80'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[20px] font-semibold">{t(plan.nameKey)}</span>
                    <span className="rounded-pill bg-white/[0.09] px-2 py-0.5 text-[11px] font-medium text-dim">
                      {plan.id === 'start' ? t('plans.badgeStart') : t('plans.badgePro')}
                    </span>
                  </div>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-[30px] font-bold leading-none tabular-nums tracking-[-0.03em]">{formatRub(p)}</span>
                    <span className="text-[13px] text-faint">/ {period === 'month' ? t('plans.perMonth') : t('plans.perYear')}</span>
                  </div>
                  {period === 'year' && (
                    <div className="mt-1.5 text-[12px] text-faint">{t('plans.approx', { amount: formatRub(Math.round(p / 12)) })}</div>
                  )}
                </div>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
                    selected ? 'bg-white text-[#0b0b0d]' : 'bg-white/[0.08]'
                  }`}
                >
                  {selected && <CheckIcon className="h-4 w-4" strokeWidth={2.4} />}
                </span>
              </div>
              <ul className="mt-4 grid gap-2 border-t border-white/[0.07] pt-4">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-[13.5px] text-dim">
                    <CheckIcon className="h-3.5 w-3.5 shrink-0 text-fg/70" strokeWidth={2.4} />
                    {t(f)}
                  </li>
                ))}
              </ul>
            </button>
          )
        })}
      </div>
      {period === 'year' && yearSaving > 0 && (
        <p className="mt-2.5 px-1 text-[12px] text-faint">{t('plans.yearSaving', { amount: formatRub(yearSaving) })}</p>
      )}

      {/* Промокод */}
      <Section>
        <div className="glass overflow-hidden">
          <button
            onClick={() => {
              haptic('select')
              setPromoOpen((v) => !v)
            }}
            className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
          >
            <span className="tile !h-10 !w-10 !rounded-[13px]">
              <GiftIcon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{promo ? t('plans.promoApplied', { code: promo.code }) : t('plans.promo')}</span>
              <span className="block text-[13px] text-faint">{promo ? t('plans.promoDiscount', { percent: promo.percent }) : t('plans.promoHint')}</span>
            </span>
            <ChevronDown className="h-5 w-5 text-dim transition-transform duration-300" style={{ transform: promoOpen ? 'rotate(180deg)' : 'none' }} />
          </button>
          <AnimatePresence initial={false}>
            {promoOpen && (
              <m.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="flex gap-2 px-4 pb-4">
                  <input
                    value={promoInput}
                    onChange={(e) => {
                      setPromoInput(e.target.value.toUpperCase())
                      setPromoError(null)
                    }}
                    placeholder="PROMO2026"
                    autoCapitalize="characters"
                    className="field !h-12 flex-1 font-mono !text-[15px] tracking-[0.06em]"
                  />
                  <button onClick={applyPromo} disabled={!promoInput.trim()} className="btn-glass-strong !h-12 !px-5 !text-[14px]">
                    {t('plans.apply')}
                  </button>
                </div>
                {promoError && <p className="px-5 pb-4 text-[13px] text-bad">{promoError}</p>}
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </Section>

      {/* Способ оплаты */}
      <Section title={t('plans.method')}>
        <div className="glass divide-y divide-white/[0.06] overflow-hidden">
          {METHODS.map((m) => {
            const active = method === m.id
            return (
              <button
                key={m.id}
                onClick={() => {
                  haptic('select')
                  setMethod(m.id)
                }}
                className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors active:bg-white/5"
              >
                <span className="tile !h-10 !w-10 !rounded-[13px]">
                  {m.id === 'balance' ? (
                    <WalletIcon className="h-[18px] w-[18px]" />
                  ) : m.id === 'stars' ? (
                    <SparkIcon className="h-[18px] w-[18px]" />
                  ) : m.id === 'platega_sbp' ? (
                    <QrIcon className="h-[18px] w-[18px]" />
                  ) : (
                    <span className="text-[13px] font-bold">₮</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{t(m.label)}</span>
                  <span className="block truncate text-[13px] text-faint">
                    {m.id === 'balance' ? t('plans.balanceHint', { amount: formatRub(balance) }) : t(m.hint)}
                  </span>
                </span>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${active ? 'border-white bg-white' : 'border-white/25'}`}>
                  {active && <span className="h-2 w-2 rounded-full bg-[#0b0b0d]" />}
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-2.5 px-1 text-[12px] text-faint">{t('plans.later')}</p>
      </Section>

      {/* Дополнительно */}
      <div className="glass mt-3 divide-y divide-white/[0.06]">
        {method !== 'balance' && balance > 0 && (
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{t('plans.useBalance')}</span>
              <span className="block text-[13px] text-faint">{t('plans.useBalanceHint', { amount: formatRub(Math.min(balance, total)) })}</span>
            </span>
            <Toggle
              checked={useBalance}
              onChange={(v) => {
                balanceTouched.current = true
                setUseBalance(v)
              }}
            />
          </div>
        )}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">{t('plans.autoRenew')}</span>
            <span className="block text-[13px] text-faint">{t('plans.autoRenewHint')}</span>
          </span>
          <Toggle checked={autoRenew} onChange={setAutoRenew} />
        </div>
      </div>

      {/* Итог */}
      <div className="glass mt-3 space-y-2 px-5 py-4 text-[14px]">
        <Line label={`${t(PLANS.find((p) => p.id === planId)!.nameKey)}, ${period === 'month' ? t('plans.oneMonth') : t('plans.twelveMonths')}`} value={formatRub(base)} />
        {discount > 0 && <Line label={t('plans.discount', { code: promo!.code })} value={formatRub(-discount)} accent />}
        {achDiscount > 0 && <Line label={t('plans.achDiscount', { percent: rewardPercent })} value={formatRub(-achDiscount)} accent />}
        {fromBalance > 0 && <Line label={t('plans.fromBalance')} value={formatRub(-fromBalance)} accent />}
        <div className="flex items-baseline justify-between border-t border-white/[0.07] pt-3">
          <span className="text-[15px] font-semibold">{t('plans.total')}</span>
          <span className="text-[22px] font-bold tabular-nums tracking-[-0.02em]">{formatRub(toPay)}</span>
        </div>
      </div>

      <button onClick={pay} disabled={busy || notEnough || maintenance} className="btn-glass-strong mt-5 w-full">
        {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : toPay === 0 ? t('plans.payBalance') : t('plans.pay', { amount: formatRub(toPay) })}
      </button>
      {notEnough && <p className="mt-2.5 text-center text-[12px] text-faint">{t('plans.notEnough')}</p>}
      <p className="mt-3 text-center text-[12px] text-faint">{t('plans.trialNote')}</p>

      <Sheet open={result !== null} onClose={() => setResult(null)}>
        {result?.kind === 'success' ? (
          <div className="flex flex-col items-center pb-2 pt-3 text-center">
            <m.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#0b0b0d] shadow-[0_0_40px_rgba(255,255,255,0.35)]"
            >
              <CheckIcon className="h-8 w-8" strokeWidth={2.6} />
            </m.span>
            <div className="mt-5 text-[22px] font-semibold">{t('plans.successTitle')}</div>
            <p className="mt-1.5 max-w-[280px] text-[14px] text-dim">{t('plans.successText')}</p>
            <button
              onClick={() => {
                setResult(null)
                navigate('/connect')
              }}
              className="btn-glass-strong mt-6 w-full"
            >
              {t('plans.connectNow')}
            </button>
          </div>
        ) : result?.kind === 'waiting' ? (
          <div className="flex flex-col items-center pb-2 pt-3 text-center">
            <span className="h-14 w-14 animate-spin rounded-full border-[3px] border-white/15 border-t-white" />
            <div className="mt-5 text-[20px] font-semibold">{t('plans.waitingTitle')}</div>
            <p className="mt-1.5 max-w-[290px] text-[14px] text-dim">{t('plans.waitingText')}</p>
            <button onClick={() => setResult(null)} className="btn-glass mt-6 w-full">
              {t('plans.close')}
            </button>
          </div>
        ) : null}
      </Sheet>
    </>
  )
}

function Line({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="truncate text-dim">{label}</span>
      <span className={`shrink-0 tabular-nums ${accent ? 'text-ok' : 'text-fg'}`}>{value}</span>
    </div>
  )
}
