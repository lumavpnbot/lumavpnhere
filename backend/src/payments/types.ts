export type PaymentMethodId = 'stars' | 'crypto_usdt' | 'crypto_ton' | 'yookassa_card' | 'yookassa_sbp'

export interface CreateInvoiceParams {
  orderId: string
  amountRub: number
  description: string
  tgUserId: number
}

export interface CreateInvoiceResult {
  /** Ссылка или payload, который фронт использует, чтобы открыть оплату (invoice link, deeplink и т.д.) */
  payload: string
}

/** Событие, пришедшее в вебхуке от платёжного провайдера, уже нормализованное. */
export interface WebhookEvent {
  orderId: string
  status: 'paid' | 'failed'
  amountRub: number
  raw: unknown
}

/**
 * Единый интерфейс платёжного провайдера. Каждый способ оплаты (Stars,
 * CryptoBot, позже ЮKassa) реализует его одинаково — роуты и бизнес-логика
 * в src/routes/payments.ts работают с провайдером через этот контракт
 * и не знают, что внутри конкретная реализация.
 */
export interface PaymentProvider {
  readonly id: PaymentMethodId
  readonly enabled: boolean
  createInvoice(params: CreateInvoiceParams): Promise<CreateInvoiceResult>
  /** Проверяет подпись/HMAC вебхука и превращает тело запроса в нормализованное событие. */
  verifyWebhook(headers: Record<string, string>, rawBody: string): WebhookEvent | null
}
