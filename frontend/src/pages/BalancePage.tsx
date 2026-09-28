import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Sheet from '@/components/Sheet'
import { PageTitle, Section, TopBar } from '@/components/ui'
import { ArrowDownLeft, ArrowUpRight, ChevronDown, GiftIcon, PlusIcon, WalletIcon } from '@/components/icons'
import { PLANS } from '@/config'
import { useLang, useT, type TKey } from '@/i18n'
import { formatDate, formatRub } from '@/lib/format'
import { haptic, notify } from '@/lib/telegram'
import { apiEnabled } from '@/lib/api'
import { useAppStore, type Transaction } from '@/store/useAppStore'

const AMOUNTS = [150, 300, 500, 1000]
const METHODS: TKey[] = ['plans.stars', 'plans.crypto']

export default function BalancePage() {
  const t = useT()
  const lang = useLang()
  const balance = useAppStore((s) => s.profile.balance)
  const transactions = useAppStore((s) => s.transactions)
  const [topup, setTopup] = useState(false)
  const [amount, setAmount] = useState(300)
  const [method, setMethod] = useState<TKey>('plans.stars')
  const [historyOpen, setHistoryOpen] = useState(true)

  const pay = () => {
    haptic('medium')
    if (!apiEnabled) {
      notify(t('common.demoPay'))
      return
    }
    // TODO: POST /balance/topup { amount, method }
  }

  const txTitle = (tx: Transaction) => {
    if (tx.kind === 'purchase') {
      const plan = PLANS.find((p) => p.id === tx.plan)
      return t('tx.purchase', { plan: plan ? t(plan.nameKey) : '' })
    }
    return tx.kind === 'referral' ? t('tx.referral') : t('tx.topup')
  }

  return (
    <>
      <TopBar />
      <PageTitle title={t('balance.title')} subtitle={t('balance.subtitle')} />

      <div className="glass glass-hero p-5">
        <div className="flex items-center gap-4">
          <span className="tile !h-14 !w-14 !rounded-[18px]">
            <WalletIcon className="h-7 w-7" />
          </span>
          <div className="text-[36px] font-bold leading-none tabular-nums tracking-[-0.03em]">{formatRub(balance)}</div>
        </div>
        <button
          onClick={() => {
            haptic('light')
            setTopup(true)
          }}
          className="btn-glass-strong mt-5 w-full"
        >
          <PlusIcon className="h-5 w-5" />
          {t('balance.topup')}
        </button>
      </div>

      <Section>
        <div className="glass overflow-hidden">
          <button
            onClick={() => {
              haptic('select')
              setHistoryOpen((v) => !v)
            }}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <span className="text-[16px] font-semibold">{t('balance.history')}</span>
            <ChevronDown
              className="h-5 w-5 text-dim transition-transform duration-300"
              style={{ transform: historyOpen ? 'rotate(180deg)' : 'none' }}
            />
          </button>
          <AnimatePresence initial={false}>
            {historyOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                {transactions.length === 0 ? (
                  <div className="px-5 pb-5 text-[14px] text-faint">{t('balance.empty')}</div>
                ) : (
                  <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center gap-3.5 px-4 py-3.5">
                        <span className="tile !h-10 !w-10 !rounded-[13px]">
                          {tx.kind === 'purchase' ? (
                            <ArrowUpRight className="h-[18px] w-[18px]" />
                          ) : tx.kind === 'referral' ? (
                            <GiftIcon className="h-[18px] w-[18px]" />
                          ) : (
                            <ArrowDownLeft className="h-[18px] w-[18px]" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium">{txTitle(tx)}</div>
                          <div className="text-[13px] text-faint">{formatDate(tx.at, lang)}</div>
                        </div>
                        <span className={`text-[15px] font-semibold tabular-nums ${tx.amount > 0 ? 'text-ok' : 'text-fg'}`}>
                          {formatRub(tx.amount, true)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Section>

      <Sheet open={topup} onClose={() => setTopup(false)} title={t('balance.topup')}>
        <div className="label mb-2.5">{t('balance.amount')}</div>
        <div className="grid grid-cols-4 gap-2">
          {AMOUNTS.map((a) => (
            <button
              key={a}
              data-active={amount === a}
              onClick={() => {
                haptic('select')
                setAmount(a)
              }}
              className="chip justify-center !px-0 tabular-nums"
            >
              {a} ₽
            </button>
          ))}
        </div>
        <div className="label mb-2.5 mt-5">{t('plans.method')}</div>
        <div className="flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <button
              key={m}
              data-active={method === m}
              onClick={() => {
                haptic('select')
                setMethod(m)
              }}
              className="chip"
            >
              {t(m)}
            </button>
          ))}
        </div>
        <button onClick={pay} className="btn-glass-strong mt-6 w-full">
          {t('plans.pay', { amount: formatRub(amount) })}
        </button>
      </Sheet>
    </>
  )
}
