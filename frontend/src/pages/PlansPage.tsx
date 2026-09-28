import { useState } from 'react'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { CheckIcon } from '@/components/icons'
import { PLANS, PRICES_RUB, type PlanId } from '@/config'
import { formatRub } from '@/lib/format'
import { haptic, notify } from '@/lib/telegram'
import { apiEnabled } from '@/lib/api'

type Period = 'month' | 'year'
// ЮKassa (карта/СБП) появится, когда её подключит сокомандник — бэкенд
// уже отдаёт список методов через GET /payments/methods.
type Method = 'stars' | 'crypto_usdt'

const METHODS: { id: Method; label: string }[] = [
  { id: 'stars', label: '⭐ Telegram Stars' },
  { id: 'crypto_usdt', label: 'Крипто · USDT / TON' },
]

export default function PlansPage() {
  const [period, setPeriod] = useState<Period>('month')
  const [planId, setPlanId] = useState<PlanId>('pro')
  const [method, setMethod] = useState<Method>('stars')

  const price = PRICES_RUB[planId][period]

  const pay = () => {
    haptic('medium')
    if (!apiEnabled) {
      notify('Оплата заработает, когда подключим бэкенд. Сейчас это демо.')
      return
    }
    // TODO: POST /payments/invoice → открыть invoice (Stars: tg.openInvoice, крипто: ссылка CryptoBot)
  }

  return (
    <>
      <TopBar />
      <PageTitle title="Тарифы" subtitle="Один тариф — все ваши устройства. Отменить можно в любой момент." />

      <div className="glass flex !rounded-pill p-1">
        {(['month', 'year'] as const).map((p) => (
          <button
            key={p}
            onClick={() => {
              haptic('select')
              setPeriod(p)
            }}
            className={`relative flex-1 rounded-pill py-2.5 text-[14px] font-medium transition-colors ${
              period === p ? 'bg-white/[0.14] text-fg' : 'text-dim'
            }`}
          >
            {p === 'month' ? 'Месяц' : 'Год'}
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
              className={`glass w-full p-5 text-left transition-[background] ${selected ? 'glass-hero' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[20px] font-semibold">{plan.name}</div>
                  <div className="mt-1 text-[13px] text-dim">
                    {plan.devices} устройств · {plan.traffic}
                  </div>
                </div>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
                    selected ? 'bg-white text-ink' : 'bg-white/[0.08]'
                  }`}
                >
                  {selected && <CheckIcon className="h-4 w-4" strokeWidth={2.4} />}
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[26px] font-bold tabular-nums tracking-[-0.02em]">{formatRub(p)}</span>
                <span className="text-[13px] text-faint">/ {period === 'month' ? 'месяц' : 'год'}</span>
              </div>
              {period === 'year' && (
                <div className="mt-1 text-[12px] text-faint">≈ {formatRub(Math.round(p / 12))} в месяц</div>
              )}
            </button>
          )
        })}
      </div>

      <Section title="Способ оплаты">
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
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-3 px-1 text-[12px] text-faint">Карта и СБП появятся позже.</p>
      </Section>

      <button onClick={pay} className="btn-glass-strong mt-7 w-full">
        Оплатить {formatRub(price)}
      </button>
      <p className="mt-3 text-center text-[12px] text-faint">Новым пользователям — 7 дней бесплатно</p>
    </>
  )
}
