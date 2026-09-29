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
          amount: await rubToUsdt(apiToken, amountRub),
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

// Курс USDT/RUB берём у CryptoBot (getExchangeRates), кэш 10 минут.
// Если API недоступно, используем последний известный курс или 95 ₽.
let rateCache: { at: number; rubPerUsdt: number } | null = null

async function rubToUsdt(apiToken: string, amountRub: number): Promise<string> {
  if (!rateCache || Date.now() - rateCache.at > 10 * 60 * 1000) {
    try {
      const res = await fetch('https://pay.crypt.bot/api/getExchangeRates', {
        headers: { 'Crypto-Pay-API-Token': apiToken },
        signal: AbortSignal.timeout(8000),
      })
      const data = (await res.json()) as { ok: boolean; result?: { source: string; target: string; rate: string; is_valid: boolean }[] }
      const row = data.result?.find((r) => r.source === 'USDT' && r.target === 'RUB' && r.is_valid)
      if (row) rateCache = { at: Date.now(), rubPerUsdt: Number(row.rate) }
    } catch {
      /* оставляем прошлый курс */
    }
  }
  const rate = rateCache?.rubPerUsdt ?? 95
  return (Math.ceil((amountRub / rate) * 100) / 100).toFixed(2)
}
