import type { PaymentProvider, CreateInvoiceParams, WebhookEvent } from './types'

/**
 * ЮKassa (карта РФ + СБП) — сокомандник подключает эту часть отдельно,
 * когда получит доступ к эквайрингу. Провайдер уже реализует общий контракт
 * PaymentProvider, поэтому включение — это просто:
 *   1) прописать YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY в .env
 *   2) добавить его в registry.ts (сейчас закомментировано)
 * Никаких изменений в роутах или бизнес-логике не требуется.
 *
 * TODO(сокомандник): реализовать createInvoice через ЮKassa Payments API
 * (POST /payments) и verifyWebhook по их формату уведомлений.
 */
export function createYooKassaProvider(shopId: string, secretKey: string): PaymentProvider {
  const enabled = Boolean(shopId && secretKey)

  return {
    id: 'yookassa_sbp',
    enabled,

    async createInvoice(_params: CreateInvoiceParams) {
      throw new Error('ЮKassa ещё не подключена (см. TODO в yookassaProvider.ts)')
    },

    verifyWebhook(_headers: Record<string, string>, _rawBody: string): WebhookEvent | null {
      return null
    },
  }
}
