import { useState } from 'react'

type Period = 'month' | 'year'
// Способы оплаты, доступные сейчас (Stars, CryptoBot). ЮKassa (карта/СБП)
// появится, когда её подключит сокомандник — тогда просто добавляем сюда
// пункт 'card' | 'sbp', бэкенд к этому уже готов (см. backend/src/payments).
type PaymentMethod = 'stars' | 'crypto'

const PLANS = [
  { id: 'free', name: 'Free', priceMonth: 0, priceYear: null, devices: 1, traffic: '5 ГБ/мес' },
  { id: 'start', name: 'Старт', priceMonth: 149, priceYear: 1250, devices: 3, traffic: '100 ГБ/мес' },
  { id: 'pro', name: 'Про', priceMonth: 249, priceYear: 1990, devices: 5, traffic: 'Безлимит' },
] as const

export default function PlansPage() {
  const [period, setPeriod] = useState<Period>('month')
  const [method, setMethod] = useState<PaymentMethod>('stars')

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-4 text-xl font-bold">Тарифы</h1>

      <div className="mb-5 flex gap-2 rounded-pill border border-border bg-surface p-1">
        {(['month', 'year'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 rounded-pill py-2 text-sm font-medium ${
              period === p ? 'bg-accent text-bg' : 'text-text-dim'
            }`}
          >
            {p === 'month' ? 'Месяц' : 'Год'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {PLANS.map((plan) => {
          const price = period === 'month' ? plan.priceMonth : plan.priceYear ?? plan.priceMonth * 12
          return (
            <div key={plan.id} className="rounded-card border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{plan.name}</div>
                <div className="font-semibold">{price === 0 ? 'Бесплатно' : `${price} ₽`}</div>
              </div>
              <div className="mt-1 text-xs text-text-dim">
                {plan.devices} устройств · {plan.traffic}
              </div>
              {plan.id !== 'free' && (
                <button className="mt-3 w-full rounded-pill bg-accent py-2.5 text-sm font-semibold text-bg">
                  Оформить
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6">
        <div className="mb-2 text-sm text-text-dim">Способ оплаты</div>
        <div className="flex gap-2">
          {(
            [
              { id: 'stars', label: '⭐ Telegram Stars' },
              { id: 'crypto', label: '₮ Крипто' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`flex-1 rounded-pill border py-2.5 text-sm ${
                method === m.id ? 'border-accent text-accent' : 'border-border text-text-dim'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
