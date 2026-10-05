import { useEffect, useState } from 'react'
import { Stepper } from '@/components/controls'
import { BoltIcon, CheckIcon, DevicesIcon, SparkIcon } from '@/components/icons'
import { useT } from '@/i18n'
import { formatRub } from '@/lib/format'
import { haptic } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'

/** Что можно докупить сейчас (GET /payments/offers). */
export interface Offers {
  plan: 'start' | 'pro' | null
  status: 'trial' | 'active' | null
  startBlocked: boolean
  upgrade: { available: boolean; days?: number; price?: number; per30d: number; reason?: string }
  traffic: { available: boolean; packs: { gb: number; price: number }[]; extraGb: number }
  devices: { available: boolean; price: number; left: number; extra: number }
  addons: { kind: 'traffic' | 'device'; amount: number; expiresAt: string }[]
}

export type Product = 'plan' | 'upgrade' | 'traffic' | 'device'

/** Без бэкенда (демо): предложения по подписке из стора. */
function demoOffers(plan: 'start' | 'pro' | null, status: string): Offers {
  return {
    plan,
    status: status === 'trial' ? 'trial' : plan ? 'active' : null,
    startBlocked: plan === 'pro',
    upgrade: plan === 'start' && status === 'active' ? { available: true, days: 18, price: 30, per30d: 50 } : { available: false, per30d: 50 },
    traffic: { available: plan === 'start', packs: [{ gb: 50, price: 25 }, { gb: 150, price: 60 }], extraGb: 0 },
    devices: { available: !!plan, price: 20, left: 5, extra: 0 },
    addons: [],
  }
}

export function useOffers() {
  const sub = useAppStore((s) => s.subscription)
  const [offers, setOffers] = useState<Offers | null>(null)
  const load = () => {
    if (!apiEnabled) {
      const active = sub.status === 'active' || sub.status === 'trial'
      setOffers(demoOffers(active ? sub.plan : null, sub.status))
      return
    }
    api.get<Offers>('/payments/offers').then(setOffers, () => undefined)
  }
  useEffect(load, [sub.plan, sub.status, sub.expiresAt])
  return { offers, reload: load }
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

/**
 * «Улучшить подписку»: переход на Премиум с доплатой, +ГБ и +устройства на месяц.
 * Выбранная карточка становится покупкой, оплата — общим блоком экрана тарифов.
 */
export function ExtrasSection({
  offers,
  product,
  gb,
  count,
  onPick,
}: {
  offers: Offers
  product: Product
  gb: number | null
  count: number
  onPick: (p: Product, opts?: { gb?: number; count?: number }) => void
}) {
  const t = useT()
  const { upgrade, traffic, devices } = offers
  const any = upgrade.available || traffic.available || devices.available
  if (!offers.plan || !any) return null

  return (
    <div className="space-y-3">
      {upgrade.available && (
        <button
          onClick={() => {
            haptic('select')
            onPick('upgrade')
          }}
          className={`glass press relative w-full overflow-hidden p-5 text-left transition-opacity ${product === 'upgrade' ? 'glass-hero' : 'opacity-85'}`}
        >
          <span aria-hidden className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.35),transparent_65%)]" />
          <div className="relative flex items-start gap-3.5">
            <span className="tile !h-11 !w-11">
              <SparkIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold">{t('extras.upgradeTitle')}</div>
              <div className="mt-0.5 text-[13px] leading-snug text-dim">{t('extras.upgradeText', { days: upgrade.days ?? 0 })}</div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[22px] font-bold tabular-nums tracking-[-0.02em]">{formatRub(upgrade.price ?? 0)}</span>
                <span className="text-[12px] text-faint">{t('extras.upgradeHint', { amount: formatRub(upgrade.per30d) })}</span>
              </div>
            </div>
            <Radio on={product === 'upgrade'} />
          </div>
        </button>
      )}

      {traffic.available && traffic.packs.length > 0 && (
        <div className={`glass p-4 transition-opacity ${product === 'traffic' ? 'glass-hero' : ''}`}>
          <div className="flex items-center gap-3.5">
            <span className="tile !h-10 !w-10 !rounded-[13px]">
              <BoltIcon className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">{t('extras.trafficTitle')}</div>
              <div className="text-[13px] text-faint">{traffic.extraGb > 0 ? t('extras.trafficHas', { gb: traffic.extraGb }) : t('extras.trafficText')}</div>
            </div>
          </div>
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            {traffic.packs.map((p) => {
              const on = product === 'traffic' && gb === p.gb
              return (
                <button
                  key={p.gb}
                  onClick={() => {
                    haptic('select')
                    onPick('traffic', { gb: p.gb })
                  }}
                  className={`press rounded-[16px] px-3.5 py-3 text-left transition-colors ${on ? 'bg-white text-[#0b0b0d]' : 'bg-white/[0.06]'}`}
                >
                  <div className="text-[17px] font-semibold tabular-nums">+{p.gb} ГБ</div>
                  <div className={`text-[13px] tabular-nums ${on ? 'text-[#0b0b0d]/70' : 'text-faint'}`}>{formatRub(p.price)}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {devices.available && (
        <div
          role="button"
          onClick={() => product !== 'device' && onPick('device', { count })}
          className={`glass p-4 transition-opacity ${product === 'device' ? 'glass-hero' : ''}`}
        >
          <div className="flex items-center gap-3.5">
            <span className="tile !h-10 !w-10 !rounded-[13px]">
              <DevicesIcon className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">{t('extras.deviceTitle')}</div>
              <div className="text-[13px] text-faint">{t('extras.deviceText', { amount: formatRub(devices.price) })}</div>
            </div>
            <Radio on={product === 'device'} />
          </div>
          <div className="mt-3.5 flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
            <Stepper value={Math.min(count, devices.left)} min={1} max={devices.left} onChange={(v) => onPick('device', { count: v })} />
            <span className="text-[17px] font-semibold tabular-nums">{formatRub(devices.price * Math.min(count, devices.left))}</span>
          </div>
        </div>
      )}

      {offers.addons.length > 0 && (
        <div className="px-1 text-[12px] leading-relaxed text-faint">
          {offers.addons.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <CheckIcon className="h-3 w-3 text-ok" strokeWidth={2.6} />
              {a.kind === 'traffic' ? t('extras.activeTraffic', { n: a.amount, date: fmtDate(a.expiresAt) }) : t('extras.activeDevice', { n: a.amount, date: fmtDate(a.expiresAt) })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Radio({ on }: { on: boolean }) {
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${on ? 'bg-white text-[#0b0b0d]' : 'bg-white/[0.08]'}`}>
      {on && <CheckIcon className="h-4 w-4" strokeWidth={2.4} />}
    </span>
  )
}
