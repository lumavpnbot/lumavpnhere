import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { ArrowDownLeft, ArrowUpRight, GiftIcon, PlansIcon, ReferralsIcon, SparkIcon, WalletIcon } from '@/components/icons'
import { PLANS } from '@/config'
import { useLang, useT } from '@/i18n'
import { formatDate, formatRub } from '@/lib/format'
import { haptic } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'
import { useAppStore, type Transaction } from '@/store/useAppStore'

interface PaymentRow {
  id: string
  plan: 'start' | 'pro' | null
  periodDays: number
  method: string
  amount: number
  status: 'paid' | 'refunded'
  at: string
  /** plan | upgrade | traffic | device; title — название покупки с бэкенда. */
  product?: string
  title?: string
}

const METHOD_LABEL: Record<string, string> = { stars: 'Telegram Stars', crypto_usdt: 'USDT', crypto_ton: 'TON', balance: 'LYNK', yookassa_card: 'Карта', yookassa_sbp: 'СБП', platega: 'Platega', platega_sbp: 'Platega' }

/**
 * Баланс по ТЗ: пополняется реферальными начислениями, тратится только на подписку.
 * Вывода на карту или крипту нет.
 */
export default function BalancePage() {
  const t = useT()
  const lang = useLang()
  const navigate = useNavigate()
  const balance = useAppStore((s) => s.profile.balance)
  const transactions = useAppStore((s) => s.transactions)
  const [tab, setTab] = useState<'balance' | 'payments'>('balance')
  const [payments, setPayments] = useState<PaymentRow[]>([])

  useEffect(() => {
    if (!apiEnabled) return
    api.get<{ payments: PaymentRow[] }>('/payments').then((r) => setPayments(r.payments)).catch(() => undefined)
  }, [])

  const go = (path: string) => {
    haptic('light')
    navigate(path)
  }

  const planName = (id?: string | null) => {
    const plan = PLANS.find((p) => p.id === id)
    return plan ? t(plan.nameKey) : ''
  }

  const txTitle = (tx: Transaction) => {
    switch (tx.kind) {
      case 'purchase':
        return t('tx.purchase', { plan: planName(tx.plan) })
      case 'referral':
        return t('tx.referral')
      case 'refund':
        return t('tx.refund')
      case 'bonus':
        return t('tx.bonus')
      default:
        return t('tx.topup')
    }
  }

  return (
    <>
      <TopBar />
      <PageTitle title={t('balance.title')} subtitle={t('balance.subtitle')} />

      <div className="glass glass-hero relative overflow-hidden p-5">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-white/[0.07] blur-2xl" />
        <div className="relative flex items-center gap-4">
          <span className="tile !h-14 !w-14 !rounded-[18px]">
            <WalletIcon className="h-7 w-7" />
          </span>
          <div>
            <div className="text-[13px] text-dim">{t('balance.available')}</div>
            <div className="text-[36px] font-bold leading-none tabular-nums tracking-[-0.03em]">{formatRub(balance)}</div>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-2">
          <button onClick={() => go('/plans')} className="btn-glass-strong !h-12 !px-3 !text-[14px]">
            <PlansIcon className="h-[18px] w-[18px]" />
            {t('balance.pay')}
          </button>
          <button onClick={() => go('/referrals')} className="btn-glass !h-12 !px-3 !text-[14px]">
            <ReferralsIcon className="h-[18px] w-[18px]" />
            {t('balance.invite')}
          </button>
        </div>
      </div>

      <div className="glass mt-3 flex items-start gap-3 px-4 py-3.5">
        <SparkIcon className="mt-0.5 h-4 w-4 shrink-0 text-dim" />
        <p className="text-[13px] leading-relaxed text-dim">{t('balance.note')}</p>
      </div>

      <Section
        title={t('balance.history')}
        action={
          <div className="flex gap-1.5">
            {(['balance', 'payments'] as const).map((k) => (
              <button
                key={k}
                data-active={tab === k}
                onClick={() => {
                  haptic('select')
                  setTab(k)
                }}
                className="chip !h-8 !px-3 !text-[13px]"
              >
                {k === 'balance' ? t('balance.tabBalance') : t('balance.tabPayments')}
              </button>
            ))}
          </div>
        }
      >
        <div className="glass divide-y divide-white/[0.06] overflow-hidden">
          {tab === 'balance' ? (
            transactions.length === 0 ? (
              <div className="px-5 py-6 text-center text-[14px] text-faint">{t('balance.empty')}</div>
            ) : (
              transactions.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3.5 px-4 py-3.5">
                  <span className="tile !h-10 !w-10 !rounded-[13px]">
                    {tx.kind === 'purchase' ? (
                      <ArrowUpRight className="h-[18px] w-[18px]" />
                    ) : tx.kind === 'referral' || tx.kind === 'bonus' ? (
                      <GiftIcon className="h-[18px] w-[18px]" />
                    ) : (
                      <ArrowDownLeft className="h-[18px] w-[18px]" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{txTitle(tx)}</div>
                    <div className="text-[13px] text-faint">{formatDate(tx.at, lang)}</div>
                  </div>
                  <span className={`text-[15px] font-semibold tabular-nums ${tx.amount > 0 ? 'text-ok' : 'text-fg'}`}>{formatRub(tx.amount, true)}</span>
                </div>
              ))
            )
          ) : payments.length === 0 ? (
            <div className="px-5 py-6 text-center text-[14px] text-faint">{t('balance.noPayments')}</div>
          ) : (
            payments.map((p) => (
              <div key={p.id} className="flex items-center gap-3.5 px-4 py-3.5">
                <span className="tile !h-10 !w-10 !rounded-[13px]">
                  <PlansIcon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">
                    {p.product && p.product !== 'plan' && p.title ? p.title : `${planName(p.plan)}, ${p.periodDays >= 365 ? t('plans.twelveMonths') : t('plans.oneMonth')}`}
                  </div>
                  <div className="text-[13px] text-faint">
                    {formatDate(p.at, lang)} · {METHOD_LABEL[p.method] ?? p.method}
                    {p.status === 'refunded' ? ` · ${t('balance.refunded')}` : ''}
                  </div>
                </div>
                <span className={`text-[15px] font-semibold tabular-nums ${p.status === 'refunded' ? 'text-faint line-through' : ''}`}>{formatRub(p.amount)}</span>
              </div>
            ))
          )}
        </div>
      </Section>
    </>
  )
}
