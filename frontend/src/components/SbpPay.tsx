import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useT } from '@/i18n'
import { api, API_BASE } from '@/lib/api'
import { formatRub } from '@/lib/format'
import { loadString, save } from '@/lib/storage'
import { haptic, openExternal } from '@/lib/telegram'

interface SbpData {
  status: 'pending' | 'paid' | 'failed'
  qrLink: string | null
  qrImage: string | null
}

interface Bank {
  schema: string
  name: string
  logo: string
  package: string
  /** Банк открывает своё приложение напрямую; иначе ведём на страницу СБП (qr.nspk.ru). */
  direct: boolean
}

/** Сколько ждём платёжную ссылку от Platega, прежде чем предложить их страницу (попытки × 1.5 с). */
const QR_ATTEMPTS = 8

// Список банков один на сессию.
let banksRequest: Promise<Bank[]> | null = null
const loadBanks = () =>
  (banksRequest ??= api.get<{ banks: Bank[] }>('/payments/sbp/banks').then(
    (r) => r.banks,
    (err: unknown) => {
      banksRequest = null
      throw err
    },
  ))

// Как ещё ищут популярные банки.
const ALIASES: Record<string, string> = {
  bank100000000111: 'сбер sber',
  bank100000000004: 'тинькофф tinkoff тбанк tbank',
  bank110000000005: 'vtb',
  bank100000000008: 'альфа alfa',
  bank100000000273: 'ozon',
  bank100000000150: 'yandex',
  bank100000000001: 'гпб gpb gazprom',
  bank100000000007: 'райф raif raiffeisen',
  bank100000000013: 'халва sovcom',
  bank100000000017: 'mts',
  bank100000000010: 'промсвязьбанк psb',
}
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '')

/**
 * Оплата по СБП внутри Mini App, без страницы Platega: человек находит свой банк
 * в поиске, и сразу открывается приложение банка с готовым платежом. Банки без
 * прямого перехода открываются через страницу СБП (НСПК). QR-код для оплаты
 * с другого устройства. Подтверждение ловит PlansPage, опрашивая статус заказа.
 */
export default function SbpPay({ orderId, amount, payUrl, onClose }: { orderId: string; amount: number; payUrl: string; onClose: () => void }) {
  const t = useT()
  const [data, setData] = useState<SbpData | null>(null)
  const [gaveUp, setGaveUp] = useState(false)
  const [banks, setBanks] = useState<Bank[] | null>(null)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const recent = useMemo(() => loadString('lynk.sbpBank'), [])

  // Платёжная ссылка СБП от провайдера (появляется через пару секунд после создания заказа).
  useEffect(() => {
    let alive = true
    let timer = 0
    const load = async (attempt: number) => {
      const d = await api.get<SbpData>(`/payments/order/${orderId}/sbp`).catch(() => null)
      if (!alive) return
      if (d) setData(d)
      if (d && (d.qrLink || d.qrImage || d.status !== 'pending')) return
      if (attempt + 1 >= QR_ATTEMPTS) return setGaveUp(true)
      timer = window.setTimeout(() => void load(attempt + 1), 1500)
    }
    void load(0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [orderId])

  useEffect(() => {
    loadBanks().then(setBanks, () => setBanks([]))
  }, [])

  // Шторка тянется свайпом вниз: внутри списка палец должен скроллить список, а не шторку.
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const stop = (e: Event) => e.stopPropagation()
    el.addEventListener('pointerdown', stop)
    return () => el.removeEventListener('pointerdown', stop)
  })

  const shown = useMemo(() => {
    if (!banks) return []
    const q = norm(query)
    const list = q ? banks.filter((b) => norm(`${b.name} ${ALIASES[b.schema] ?? ''}`).includes(q)) : banks
    const last = list.find((b) => b.schema === recent)
    return last ? [last, ...list.filter((b) => b !== last)] : list
  }, [banks, query, recent])

  const openBank = (b: Bank) => {
    const link = data?.qrLink
    if (!link) return
    haptic('medium')
    setChosen(b.schema)
    save('lynk.sbpBank', b.schema)
    if (!b.direct) return openExternal(link)
    openExternal(`${API_BASE}/open/sbp?${new URLSearchParams({ link, schema: b.schema, package: b.package })}`)
  }

  const header = (
    <>
      <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-faint">{t('sbp.title')}</div>
      <div className="mt-1 text-[30px] font-bold tabular-nums tracking-[-0.03em]">{formatRub(amount)}</div>
    </>
  )
  const closeButton = (
    <button onClick={onClose} className="btn-glass mt-4 w-full">
      {t('plans.close')}
    </button>
  )

  // Ссылки пока нет: ждём, а если провайдер её так и не дал, остаётся страница оплаты.
  if (!data?.qrLink) {
    return (
      <div className="flex flex-col items-center pb-2 pt-1 text-center">
        {header}
        {data?.qrImage ? (
          <div className="mt-4 flex h-[236px] w-[236px] items-center justify-center rounded-[28px] bg-white p-4">
            <img src={data.qrImage} alt="QR" className="h-full w-full object-contain" />
          </div>
        ) : !gaveUp ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-[14px] text-dim">
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/15 border-t-white" />
            {t('sbp.preparing')}
          </div>
        ) : (
          <p className="mt-5 max-w-[300px] text-[14px] text-dim">{t('sbp.noLink')}</p>
        )}
        {(gaveUp || data?.qrImage) && (
          <button onClick={() => openExternal(payUrl)} className="btn-glass-strong mt-5 w-full">
            {t('sbp.openPage')}
          </button>
        )}
        {closeButton}
      </div>
    )
  }

  if (showQr) {
    return (
      <div className="flex flex-col items-center pb-2 pt-1 text-center">
        {header}
        <div className="mt-4 rounded-[28px] bg-white p-4 shadow-[0_20px_60px_-20px_rgba(255,255,255,0.35)]">
          <QRCodeSVG value={data.qrLink} size={204} bgColor="#ffffff" fgColor="#0b0b0d" level="M" />
        </div>
        <p className="mt-3 max-w-[300px] text-[13px] leading-snug text-dim">{t('sbp.qrHint')}</p>
        <button onClick={() => setShowQr(false)} className="btn-glass-strong mt-5 w-full">
          {t('sbp.backToBanks')}
        </button>
        {closeButton}
      </div>
    )
  }

  return (
    <div className="pb-2 pt-1">
      <div className="text-center">{header}</div>

      {chosen ? (
        <div className="glass mt-4 flex items-center gap-3 px-4 py-3 text-left">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-white/80" />
          <span className="min-w-0">
            <span className="block text-[14px] font-medium">{t('sbp.waiting')}</span>
            <span className="block text-[12.5px] leading-snug text-faint">{t('sbp.waitingHint')}</span>
          </span>
        </div>
      ) : (
        <p className="mt-2 text-center text-[13px] text-dim">{t('sbp.chooseBank')}</p>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('sbp.search')}
        className="field mt-4 !h-12 !text-[15px]"
        enterKeyHint="search"
      />

      <div ref={listRef} className="mt-2 max-h-[38vh] overflow-y-auto overscroll-contain" style={{ touchAction: 'pan-y' }}>
        {!banks ? (
          <div className="flex h-24 items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
          </div>
        ) : shown.length ? (
          shown.map((b) => (
            <button
              key={b.schema}
              onClick={() => openBank(b)}
              className="flex w-full items-center gap-3 rounded-[14px] px-2 py-2.5 text-left transition-colors active:bg-white/5"
            >
              <BankLogo bank={b} />
              <span className="min-w-0 flex-1 truncate text-[15px]">{b.name}</span>
              {b.schema === recent && <span className="shrink-0 rounded-pill bg-white/[0.09] px-2 py-0.5 text-[11px] text-dim">{t('sbp.recent')}</span>}
              {b.schema === chosen && <span className="h-2 w-2 shrink-0 rounded-full bg-ok" />}
            </button>
          ))
        ) : (
          <p className="px-2 py-6 text-center text-[13px] text-faint">{t('sbp.notFound')}</p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => {
            haptic('light')
            setShowQr(true)
          }}
          className="btn-glass !h-11 !px-3 !text-[13px]"
        >
          {t('sbp.qrOther')}
        </button>
        <button onClick={() => openExternal(data.qrLink!)} className="btn-glass !h-11 !px-3 !text-[13px]">
          {t('sbp.otherBank')}
        </button>
      </div>
      {closeButton}
    </div>
  )
}

/** Логотип банка с НСПК; если не загрузился, первая буква названия. */
function BankLogo({ bank }: { bank: Bank }) {
  const [broken, setBroken] = useState(!bank.logo)
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white">
      {broken ? (
        <span className="text-[14px] font-semibold text-[#0b0b0d]">{bank.name.replace(/[^A-Za-zА-Яа-яЁё]/g, '').slice(0, 1).toUpperCase()}</span>
      ) : (
        <img src={bank.logo} alt="" loading="lazy" className="h-full w-full object-contain" onError={() => setBroken(true)} />
      )}
    </span>
  )
}
