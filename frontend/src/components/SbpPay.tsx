import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useT } from '@/i18n'
import { api } from '@/lib/api'
import { formatRub } from '@/lib/format'
import { haptic, openExternal } from '@/lib/telegram'

interface SbpData {
  status: 'pending' | 'paid' | 'failed'
  qrLink: string | null
  qrImage: string | null
}

/** Сколько ждём QR от Platega, прежде чем предложить страницу оплаты (попытки × 1.5 с). */
const QR_ATTEMPTS = 8

/**
 * Оплата по СБП внутри Mini App: QR-код и кнопка «Оплатить в приложении банка»
 * (ссылка qr.nspk.ru открывает банк сразу, без страницы Platega). Подтверждение
 * ловит PlansPage, опрашивая статус заказа. Страница Platega остаётся запасным
 * вариантом, если провайдер не выдал QR.
 */
export default function SbpPay({ orderId, amount, payUrl, onClose }: { orderId: string; amount: number; payUrl: string; onClose: () => void }) {
  const t = useT()
  const [data, setData] = useState<SbpData | null>(null)
  const [gaveUp, setGaveUp] = useState(false)

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

  const openBank = () => {
    haptic('medium')
    if (data?.qrLink) openExternal(data.qrLink)
  }

  const qrReady = Boolean(data?.qrLink || data?.qrImage)

  return (
    <div className="flex flex-col items-center pb-2 pt-1 text-center">
      <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-faint">{t('sbp.title')}</div>
      <div className="mt-1 text-[30px] font-bold tabular-nums tracking-[-0.03em]">{formatRub(amount)}</div>

      <div className="mt-4 flex h-[236px] w-[236px] items-center justify-center rounded-[28px] bg-white p-4 shadow-[0_20px_60px_-20px_rgba(255,255,255,0.35)]">
        {data?.qrLink ? (
          <QRCodeSVG value={data.qrLink} size={204} bgColor="#ffffff" fgColor="#0b0b0d" level="M" />
        ) : data?.qrImage ? (
          <img src={data.qrImage} alt="QR" className="h-full w-full object-contain" />
        ) : gaveUp ? (
          <span className="px-4 text-[14px] leading-snug text-[#0b0b0d]/60">{t('sbp.noQr')}</span>
        ) : (
          <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-black/10 border-t-black/70" />
        )}
      </div>

      {data?.qrLink && (
        <button onClick={openBank} className="btn-glass-strong mt-5 w-full">
          {t('sbp.openBank')}
        </button>
      )}
      {(gaveUp || (data?.qrImage && !data.qrLink)) && (
        <button onClick={() => openExternal(payUrl)} className={`${data?.qrImage ? 'btn-glass' : 'btn-glass-strong'} mt-5 w-full`}>
          {t('sbp.openPage')}
        </button>
      )}

      {(qrReady || !gaveUp) && <p className="mt-3 max-w-[300px] text-[13px] leading-snug text-dim">{qrReady ? t('sbp.hint') : t('sbp.preparing')}</p>}

      {qrReady && (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-faint">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
          {t('sbp.waiting')}
        </div>
      )}

      <button onClick={onClose} className="btn-glass mt-5 w-full">
        {t('plans.close')}
      </button>
    </div>
  )
}
