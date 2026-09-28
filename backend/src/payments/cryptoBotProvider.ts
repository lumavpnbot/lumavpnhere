import crypto from 'node:crypto'
import type { PaymentProvider, CreateInvoiceParams, WebhookEvent } from './types'

/**
 * @CryptoBot (Crypto Pay API) — USDT TRC-20 и TON. Один провайдер обслуживает
 * оба актива, поэтому и 'crypto_usdt', и 'crypto_ton' в БД мапятся на него;
 * конкретный актив передаётся в asset при создании инвойса.
 */
export function createCryptoBotProvider(apiToken: string): PaymentProvider {
  return {
    id: 'crypto_usdt',
    enabled: Boolean(apiToken),

    async createInvoice({ orderId, amountRub, description }: CreateInvoiceParams) {
      const res = await fetch('https://pay.crypt.bot/api/createInvoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Crypto-Pay-API-Token': apiToken },
        body: JSON.stringify({
          asset: 'USDT',
          amount: rubToUsdtApprox(amountRub),
          description,
          payload: orderId,
          expires_in: 900, // 15 минут — таймаут инвойса из ТЗ
        }),
      })
      const data = (await res.json()) as { ok: boolean; result?: { pay_url: string } }
      if (!data.ok || !data.result) throw new Error('Не удалось создать CryptoBot-инвойс')
      return { payload: data.result.pay_url }
    },

    verifyWebhook(headers: Record<string, string>, rawBody: string): WebhookEvent | null {
      const signature = headers['crypto-pay-api-signature']
      if (!signature) return null

      const secret = crypto.createHash('sha256').update(apiToken).digest()
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
      if (expected !== signature) return null

      const body = JSON.parse(rawBody) as {
        payload: { payload: string; status: string; amount: string }
      }
      const invoice = body.payload
      return {
        orderId: invoice.payload,
        status: invoice.status === 'paid' ? 'paid' : 'failed',
        amountRub: Number(invoice.amount),
        raw: body,
      }
    },
  }
}

// Курс — временная заглушка. В боевом виде брать из курса CryptoBot API
// (getExchangeRates) с кэшем в Redis на несколько минут.
function rubToUsdtApprox(amountRub: number): number {
  const approxRateRubPerUsdt = 95
  return Number((amountRub / approxRateRubPerUsdt).toFixed(2))
}
