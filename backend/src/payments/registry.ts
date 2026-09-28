import type { PaymentProvider, PaymentMethodId } from './types'
import { createStarsProvider } from './starsProvider'
import { createCryptoBotProvider } from './cryptoBotProvider'
import { createYooKassaProvider } from './yookassaProvider'

/**
 * Реестр включённых способов оплаты. PlansPage на фронте запрашивает этот
 * список через GET /payments/methods, поэтому когда сокомандник допишет
 * ЮKassa и пропишет её ключи в .env, она появится в интерфейсе автоматически —
 * без деплоя фронтенда.
 */
export function createPaymentRegistry(env: {
  TELEGRAM_BOT_TOKEN?: string
  CRYPTOBOT_API_TOKEN?: string
  YOOKASSA_SHOP_ID?: string
  YOOKASSA_SECRET_KEY?: string
}) {
  const providers: PaymentProvider[] = [
    createStarsProvider(env.TELEGRAM_BOT_TOKEN ?? ''),
    createCryptoBotProvider(env.CRYPTOBOT_API_TOKEN ?? ''),
    createYooKassaProvider(env.YOOKASSA_SHOP_ID ?? '', env.YOOKASSA_SECRET_KEY ?? ''),
  ]

  const byId = new Map<PaymentMethodId, PaymentProvider>(providers.map((p) => [p.id, p]))

  return {
    /** Только реально включённые методы — то, что показываем пользователю. */
    listEnabled: () => providers.filter((p) => p.enabled),
    get: (id: PaymentMethodId) => byId.get(id),
  }
}
