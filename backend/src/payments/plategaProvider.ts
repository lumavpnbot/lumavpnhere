import crypto from 'node:crypto'
import type { PaymentProvider, CreateInvoiceParams, ProviderTxDetails, WebhookEvent } from './types'

const API = 'https://app.platega.io'
/** paymentMethod в API Platega: 2 = СБП (QR / приложение банка). */
const SBP = 2

/** Статус Platega → наш: CONFIRMED оплачен, CANCELED/FAILED/EXPIRED нет, остальное ещё в процессе. */
const mapStatus = (raw: unknown): ProviderTxDetails['status'] => {
  const s = String(raw ?? '').toUpperCase()
  return s === 'CONFIRMED' ? 'paid' : ['CANCELED', 'FAILED', 'EXPIRED'].includes(s) ? 'failed' : 'pending'
}

/**
 * Platega (СБП). Авторизация: заголовки X-MerchantId и X-Secret (ID мерчанта и API-ключ
 * из личного кабинета Platega). Ссылка на оплату: POST /transaction/process, подтверждение
 * приходит callback'ом на <PUBLIC_URL>/payments/webhook/platega_sbp — адрес указывается
 * в кабинете Platega. В callback Platega присылает те же X-MerchantId и X-Secret,
 * по ним и проверяем, что запрос настоящий.
 */
export function createPlategaProvider(merchantId: string, secret: string, returnUrl: string): PaymentProvider {
  const enabled = Boolean(merchantId && secret)

  return {
    id: 'platega_sbp',
    enabled,

    async createInvoice({ orderId, amountRub, description, tgUserId }: CreateInvoiceParams) {
      const res = await fetch(`${API}/transaction/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MerchantId': merchantId, 'X-Secret': secret },
        body: JSON.stringify({
          paymentMethod: SBP,
          paymentDetails: { amount: amountRub, currency: 'RUB' },
          description,
          return: returnUrl,
          failedUrl: returnUrl,
          payload: orderId,
          // Platega просит передавать id покупателя для антифрода.
          metadata: { userId: String(tgUserId) },
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const data = (await res.json().catch(() => ({}))) as { transactionId?: string; redirect?: string; url?: string; message?: string }
      // В v1 ссылка в redirect, в v2 переименована в url: читаем оба поля.
      const link = data.redirect || data.url
      if (!res.ok || !link) throw new Error(`Не удалось создать платёж СБП${data.message ? `: ${data.message}` : ''}`)
      return { payload: link, externalId: data.transactionId }
    },

    verifyWebhook(headers: Record<string, string>, rawBody: string): WebhookEvent | null {
      if (!enabled) return null
      if (!same(headers['x-merchantid'], merchantId) || !same(headers['x-secret'], secret)) return null

      const body = JSON.parse(rawBody) as { id?: string; amount?: number | string; status?: string; payload?: string | null }
      const status = mapStatus(body.status)
      return {
        orderId: body.payload ?? '',
        // Возвраты и чарджбэки (REFUNDED, CHARGEBACKED) и промежуточные статусы заказ не меняют.
        status: status === 'pending' ? 'ignored' : status,
        amountRub: Number(body.amount ?? 0),
        externalId: body.id,
        raw: body,
      }
    },

    /**
     * GET /transaction/{id}: статус и поле qr (ссылка СБП qr.nspk.ru или картинка QR).
     * Нужен для оплаты внутри Mini App (без страницы Platega) и сверки, если вебхук не дошёл.
     */
    async details(externalId: string): Promise<ProviderTxDetails | null> {
      if (!enabled) return null
      const res = await fetch(`${API}/transaction/${encodeURIComponent(externalId)}`, {
        headers: { 'X-MerchantId': merchantId, 'X-Secret': secret },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return null
      const data = (await res.json().catch(() => null)) as { status?: string; qr?: string | null } | null
      if (!data) return null
      return { status: mapStatus(data.status), qr: typeof data.qr === 'string' && data.qr.trim() ? data.qr.trim() : null }
    },
  }
}

/** Сравнение секрета за постоянное время. */
function same(got: string | undefined, expected: string): boolean {
  const a = Buffer.from(got ?? '')
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
