import type { PaymentProvider, CreateInvoiceParams, WebhookEvent } from './types'

/**
 * Telegram Stars — оплата через Bot API (createInvoiceLink с currency=XTR).
 * Подтверждение платежа приходит не вебхуком, а Telegram-апдейтом
 * successful_payment в самом боте, поэтому verifyWebhook здесь не используется
 * напрямую — событие в этот провайдер прокидывается из обработчика апдейтов бота.
 */
export function createStarsProvider(botToken: string, apiBase = 'https://api.telegram.org'): PaymentProvider {
  return {
    id: 'stars',
    enabled: Boolean(botToken),

    async createInvoice({ orderId, amountRub, description }: CreateInvoiceParams) {
      // 1 XTR ≈ фиксированный курс, который устанавливает Telegram — конвертацию
      // делаем на этапе показа цены пользователю (см. PlansPage), здесь просто
      // создаём инвойс через Bot API createInvoiceLink.
      const res = await fetch(`${apiBase}/bot${botToken}/createInvoiceLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'LYNK',
          description,
          payload: orderId,
          currency: 'XTR',
          prices: [{ label: description, amount: Math.round(amountRub) }],
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const data = (await res.json().catch(() => ({ ok: false }))) as { result?: string; ok: boolean; description?: string }
      if (!data.ok || !data.result) throw new Error(`Не удалось создать Stars-инвойс${data.description ? `: ${data.description}` : ''}`)
      return { payload: data.result }
    },

    verifyWebhook(): WebhookEvent | null {
      // Не применимо — см. комментарий выше. Обработка идёт в telegramBot.ts
      // через успешный платёж (pre_checkout_query + successful_payment).
      return null
    },
  }
}
