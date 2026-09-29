import Fastify from 'fastify'
import cors from '@fastify/cors'
import { PrismaClient } from '@prisma/client'
import { registerAuth } from '@/plugins/authenticate'
import { registerMeRoutes } from '@/routes/me'
import { registerPaymentRoutes } from '@/routes/payments'
import { registerSubscriptionRoutes } from '@/routes/subscription'
import { createPaymentRegistry } from '@/payments/registry'
import { createPanelProvider } from '@/panel'
import { createVpnService } from '@/services/vpn'
import { botIdOf, parseBotTokens } from '@/lib/telegramAuth'

const env = process.env
const app = Fastify({ logger: true })
const prisma = new PrismaClient()

await app.register(cors, { origin: true })
const botTokens = parseBotTokens(env.TELEGRAM_BOT_TOKEN)
registerAuth(app, botTokens)

const payments = createPaymentRegistry({
  TELEGRAM_BOT_TOKEN: botTokens[0],
  CRYPTOBOT_API_TOKEN: env.CRYPTOBOT_API_TOKEN,
  YOOKASSA_SHOP_ID: env.YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY: env.YOOKASSA_SECRET_KEY,
})
const panel = createPanelProvider(env)
const vpn = createVpnService(prisma, panel)
app.log.info(`panel mode: ${panel.kind}`)

registerMeRoutes(app, prisma, panel, vpn, env)
registerPaymentRoutes(app, prisma, payments, vpn)
registerSubscriptionRoutes(app, prisma, panel, env)

app.get('/health', async () => {
  const panelInfo = panel.describe ? await panel.describe().catch((e: Error) => ({ error: e.message })) : null
  // botIds: только публичная часть токенов (id бота), чтобы проверить, какой бот подключён.
  return { ok: true, botIds: botTokens.map(botIdOf), panel: panel.kind, panelInfo }
})

// Раз в 10 минут отключаем на панели истёкшие подписки.
setInterval(() => {
  vpn.expireOverdue().catch((err) => app.log.error({ err }, 'expireOverdue failed'))
}, 10 * 60 * 1000)

const port = Number(env.PORT ?? 3000)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
