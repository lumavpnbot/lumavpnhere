import crypto from 'node:crypto'
import type { PaymentProvider, CreateInvoiceParams, WebhookEvent } from './types'

const API = 'https://app.platega.io'
/** paymentMethod в API Platega: 2 = СБП (QR / приложение банка). */
const SBP = 2

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
      const status = String(body.status ?? '').toUpperCase()
      return {
        orderId: body.payload ?? '',
        // Возвраты и чарджбэки (REFUNDED, CHARGEBACKED) и промежуточные статусы заказ не меняют.
        status: status === 'CONFIRMED' ? 'paid' : ['CANCELED', 'FAILED', 'EXPIRED'].includes(status) ? 'failed' : 'ignored',
        amountRub: Number(body.amount ?? 0),
        externalId: body.id,
        raw: body,
      }
    },
  }
}

/** Сравнение секрета за постоянное время. */
function same(got: string | undefined, expected: string): boolean {
  const a = Buffer.from(got ?? '')
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
