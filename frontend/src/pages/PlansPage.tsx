import { useState } from 'react'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { CheckIcon } from '@/components/icons'
import { PLANS, PRICES_RUB, type PlanId } from '@/config'
import { useT, type TKey } from '@/i18n'
import { formatRub } from '@/lib/format'
import { haptic, notify } from '@/lib/telegram'
import { apiEnabled } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'

type Period = 'month' | 'year'
// ЮKassa (карта/СБП) появится, когда её подключит сокомандник: бэкенд
// уже отдаёт список методов через GET /payments/methods.
type Method = 'stars' | 'crypto_usdt' | 'balance'

const METHODS: { id: Method; label: TKey }[] = [
  { id: 'stars', label: 'plans.stars' },
  { id: 'crypto_usdt', label: 'plans.crypto' },
  { id: 'balance', label: 'plans.balance' },
]

export default function PlansPage() {
  const t = useT()
  const balance = useAppStore((s) => s.profile.balance)
  const [period, setPeriod] = useState<Period>('month')
  const [planId, setPlanId] = useState<PlanId>('pro')
  const [method, setMethod] = useState<Method>('stars')

  const price = PRICES_RUB[planId][period]

  const pay = () => {
    haptic('medium')
    if (!apiEnabled) {
      notify(t('common.demoPay'))
      return
    }
    // TODO: POST /payments/invoice, затем Stars через tg.openInvoice, крипто через ссылку CryptoBot
  }

  return (
    <>
      <TopBar />
      <PageTitle title={t('plans.title')} subtitle={t('plans.subtitle')} />

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
            {p === 'year' && <span className="ml-1.5 text-[12px] text-ok">−30%</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {PLANS.map((plan) => {
          const selected = plan.id === planId
          const p = PRICES_RUB[plan.id][period]
          return (
            <button
              key={plan.id}
              onClick={() => {
                haptic('select')
                setPlanId(plan.id)
              }}
              className={`glass press w-full p-5 text-left ${selected ? 'glass-hero' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[20px] font-semibold">{t(plan.nameKey)}</div>
                  <div className="mt-1 text-[13px] text-dim">
                    {t('plans.devices', { n: plan.devices })}, {t(plan.trafficKey).toLowerCase()}
                  </div>
                </div>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
                    selected ? 'bg-white text-[#0b0b0d]' : 'bg-white/[0.08]'
                  }`}
                >
                  {selected && <CheckIcon className="h-4 w-4" strokeWidth={2.4} />}
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[26px] font-bold tabular-nums tracking-[-0.02em]">{formatRub(p)}</span>
                <span className="text-[13px] text-faint">/ {period === 'month' ? t('plans.perMonth') : t('plans.perYear')}</span>
              </div>
              {period === 'year' && (
                <div className="mt-1 text-[12px] text-faint">{t('plans.approx', { amount: formatRub(Math.round(p / 12)) })}</div>
              )}
            </button>
          )
        })}
      </div>

      <Section title={t('plans.method')}>
        <div className="flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <button
              key={m.id}
              data-active={method === m.id}
              onClick={() => {
                haptic('select')
                setMethod(m.id)
              }}
              className="chip"
            >
              {t(m.label)}
              {m.id === 'balance' && <span className="text-faint">{formatRub(balance)}</span>}
            </button>
          ))}
        </div>
        <p className="mt-3 px-1 text-[12px] text-faint">{t('plans.later')}</p>
      </Section>

      <button
        onClick={pay}
        disabled={method === 'balance' && balance < price}
        className="btn-glass-strong mt-7 w-full"
      >
        {t('plans.pay', { amount: formatRub(price) })}
      </button>
      <p className="mt-3 text-center text-[12px] text-faint">{t('plans.trialNote')}</p>
    </>
  )
}
