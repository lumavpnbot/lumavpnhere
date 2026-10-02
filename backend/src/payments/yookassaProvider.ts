import type { PaymentProvider, CreateInvoiceParams, ProviderTxDetails, WebhookEvent } from './types'

const API = 'https://api.yookassa.ru/v3'

interface YooPayment {
  id?: string
  status?: string
  amount?: { value?: string; currency?: string }
  confirmation?: { type?: string; confirmation_data?: string; confirmation_url?: string }
  metadata?: Record<string, string> | null
}

/** Статус ЮKassa → наш: succeeded оплачен, canceled нет, pending и waiting_for_capture ещё в процессе. */
const mapStatus = (raw: unknown): ProviderTxDetails['status'] =>
  raw === 'succeeded' ? 'paid' : raw === 'canceled' ? 'failed' : 'pending'

export interface YooKassaOptions {
  shopId: string
  secretKey: string
  /** Чеки 54-ФЗ через ЮKassa: передаём receipt в каждом платеже (нужно, если в кабинете включены «Чеки от ЮKassa»). */
  receipt: boolean
  /** Почта для чека, если у пользователя нет подтверждённой. */
  receiptEmail: string
  /** Ставка НДС в чеке (vat_code ЮKassa): 1 = без НДС. */
  vatCode: number
}

/**
 * ЮKassa: оплата по СБП по H2H, без страницы ЮKassa. Платёж создаётся через POST /v3/payments
 * с payment_method_data.type = sbp и confirmation.type = qr: в ответе confirmation_data, платёжная
 * ссылка НСПК https://qr.nspk.ru/…. Из неё Mini App рисует QR и открывает приложение выбранного
 * банка (components/SbpPay.tsx). Авторизация: Basic shopId:secretKey.
 *
 * Уведомления: <PUBLIC_URL>/payments/webhook/yookassa_sbp (кабинет ЮKassa → Интеграция →
 * HTTP-уведомления, события payment.succeeded и payment.canceled). Подписи у них нет, поэтому
 * уведомлению не верим на слово: статус, сумму и наш orderId берём из GET /v3/payments/{id}.
 */
export function createYooKassaProvider({ shopId, secretKey, receipt, receiptEmail, vatCode }: YooKassaOptions): PaymentProvider {
  const enabled = Boolean(shopId && secretKey)
  const auth = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`

  async function getPayment(id: string): Promise<YooPayment | null> {
    const res = await fetch(`${API}/payments/${encodeURIComponent(id)}`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return (await res.json().catch(() => null)) as YooPayment | null
  }

  return {
    id: 'yookassa_sbp',
    enabled,

    async createInvoice({ orderId, amountRub, description, tgUserId, email }: CreateInvoiceParams) {
      const value = amountRub.toFixed(2)
      const customerEmail = email || receiptEmail
      if (receipt && !customerEmail) throw new Error('ЮKassa: для чека нужна почта (YOOKASSA_RECEIPT_EMAIL)')
      const body = {
        amount: { value, currency: 'RUB' },
        capture: true,
        payment_method_data: { type: 'sbp' },
        confirmation: { type: 'qr' },
        description: description.slice(0, 128),
        metadata: { orderId, tgUserId: String(tgUserId) },
        ...(receipt
          ? {
              receipt: {
                customer: { email: customerEmail },
                items: [
                  {
                    description: description.slice(0, 128),
                    quantity: '1.00',
                    amount: { value, currency: 'RUB' },
                    vat_code: vatCode,
                    payment_mode: 'full_payment',
                    payment_subject: 'service',
                  },
                ],
              },
            }
          : {}),
      }
      const res = await fetch(`${API}/payments`, {
        method: 'POST',
        // Ключ идемпотентности = наш заказ: повтор запроса не создаст второй платёж.
        headers: { 'Content-Type': 'application/json', Authorization: auth, 'Idempotence-Key': orderId },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
      const data = (await res.json().catch(() => ({}))) as YooPayment & { description?: string; parameter?: string }
      const link = data.confirmation?.confirmation_data || data.confirmation?.confirmation_url
      if (!res.ok || !data.id || !link) {
        const why = [data.description, data.parameter && `(${data.parameter})`].filter(Boolean).join(' ')
        throw new Error(`Не удалось создать платёж ЮKassa${why ? `: ${why}` : ''}`)
      }
      return { payload: link, externalId: data.id }
    },

    async verifyWebhook(_headers: Record<string, string>, rawBody: string): Promise<WebhookEvent | null> {
      if (!enabled) return null
      const body = JSON.parse(rawBody) as { type?: string; event?: string; object?: { id?: string } }
      if (body.type !== 'notification' || !body.event || !body.object?.id) return null
      // Возвраты и прочие события (refund.*, payout.*) заказ не меняют.
      if (!body.event.startsWith('payment.')) return { orderId: '', status: 'ignored', amountRub: 0, raw: body }
      const payment = await getPayment(body.object.id)
      // Платёж не нашёлся в нашем магазине: уведомление поддельное (или ЮKassa недоступна и повторит позже).
      if (!payment?.id) return null
      const status = mapStatus(payment.status)
      return {
        orderId: payment.metadata?.orderId ?? '',
        status: status === 'pending' ? 'ignored' : status,
        amountRub: Number(payment.amount?.value ?? 0),
        externalId: payment.id,
        raw: body,
      }
    },

    /** GET /v3/payments/{id}: статус и ссылка СБП (qr.nspk.ru) для оплаты внутри Mini App и сверки без вебхука. */
    async details(externalId: string): Promise<ProviderTxDetails | null> {
      if (!enabled) return null
      const payment = await getPayment(externalId)
      if (!payment) return null
      const qr = payment.confirmation?.confirmation_data?.trim() || null
      return { status: mapStatus(payment.status), qr }
    },
  }
}
