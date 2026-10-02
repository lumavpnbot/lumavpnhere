import type { PaymentProvider, PaymentMethodId } from './types'
import { createStarsProvider } from './starsProvider'
import { createCryptoBotProvider } from './cryptoBotProvider'
import { createYooKassaProvider } from './yookassaProvider'
import { createPlategaProvider } from './plategaProvider'

/**
 * Реестр включённых способов оплаты. PlansPage на фронте запрашивает этот
 * список через GET /payments/methods: способ без ключей в .env (например, СБП
 * через ЮKassa без YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY) в интерфейсе не показывается.
 */
export function createPaymentRegistry(env: {
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_API_URL?: string
  CRYPTOBOT_API_TOKEN?: string
  YOOKASSA_SHOP_ID?: string
  YOOKASSA_SECRET_KEY?: string
  YOOKASSA_RECEIPT?: string
  YOOKASSA_RECEIPT_EMAIL?: string
  YOOKASSA_VAT_CODE?: string
  PLATEGA_MERCHANT_ID?: string
  PLATEGA_SECRET?: string
  /** Куда Platega вернёт покупателя после оплаты. */
  PLATEGA_RETURN_URL: string
}) {
  const providers: PaymentProvider[] = [
    createStarsProvider(env.TELEGRAM_BOT_TOKEN ?? '', env.TELEGRAM_API_URL),
    createCryptoBotProvider(env.CRYPTOBOT_API_TOKEN ?? ''),
    createPlategaProvider(env.PLATEGA_MERCHANT_ID ?? '', env.PLATEGA_SECRET ?? '', env.PLATEGA_RETURN_URL),
    createYooKassaProvider({
      shopId: env.YOOKASSA_SHOP_ID ?? '',
      secretKey: env.YOOKASSA_SECRET_KEY ?? '',
      receipt: env.YOOKASSA_RECEIPT === '1',
      receiptEmail: env.YOOKASSA_RECEIPT_EMAIL ?? '',
      vatCode: Number(env.YOOKASSA_VAT_CODE) || 1,
    }),
  ]

  const byId = new Map<PaymentMethodId, PaymentProvider>(providers.map((p) => [p.id, p]))

  return {
    /** Только реально включённые методы — то, что показываем пользователю. */
    listEnabled: () => providers.filter((p) => p.enabled),
    // platega_sbp: прежнее имя Platega (старые платежи и адрес вебхука в кабинете Platega).
    get: (id: PaymentMethodId | 'platega_sbp') => byId.get(id === 'platega_sbp' ? 'platega' : id),
  }
}
