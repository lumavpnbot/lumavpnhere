export type PaymentMethodId = 'stars' | 'crypto_usdt' | 'crypto_ton' | 'yookassa_card' | 'yookassa_sbp' | 'platega'

export interface CreateInvoiceParams {
  orderId: string
  amountRub: number
  description: string
  tgUserId: number
  /** Подтверждённая почта пользователя (для чека 54-ФЗ). */
  email?: string
}

export interface CreateInvoiceResult {
  /** Ссылка или payload, который фронт использует, чтобы открыть оплату (invoice link, deeplink и т.д.) */
  payload: string
  /** Id платежа у провайдера (если он известен сразу), для поиска в админке. */
  externalId?: string
}

/** Событие, пришедшее в вебхуке от платёжного провайдера, уже нормализованное. */
export interface WebhookEvent {
  orderId: string
  /** ignored: промежуточный или неизвестный статус — подтверждаем приём, заказ не трогаем. */
  status: 'paid' | 'failed' | 'ignored'
  amountRub: number
  /** Id транзакции у провайдера: сохраняется в платеже, по нему ищут в админке. */
  externalId?: string
  raw: unknown
}

/** Состояние транзакции у провайдера (для оплаты внутри приложения и сверки без вебхука). */
export interface ProviderTxDetails {
  status: 'pending' | 'paid' | 'failed'
  /** Данные для оплаты по СБП: ссылка https://qr.nspk.ru/… или картинка QR (base64). */
  qr: string | null
}

/**
 * Единый интерфейс платёжного провайдера. Каждый способ оплаты (Stars,
 * CryptoBot, Platega, ЮKassa) реализует его одинаково — роуты и бизнес-логика
 * в src/routes/payments.ts работают с провайдером через этот контракт
 * и не знают, что внутри конкретная реализация.
 */
export interface PaymentProvider {
  readonly id: PaymentMethodId
  readonly enabled: boolean
  createInvoice(params: CreateInvoiceParams): Promise<CreateInvoiceResult>
  /** Проверяет подпись/HMAC вебхука и превращает тело запроса в нормализованное событие. */
  verifyWebhook(headers: Record<string, string>, rawBody: string): WebhookEvent | null | Promise<WebhookEvent | null>
  /** Запрос транзакции у провайдера по её id (externalId). Есть не у всех провайдеров. */
  details?(externalId: string): Promise<ProviderTxDetails | null>
}
