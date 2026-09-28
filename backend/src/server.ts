import Fastify from 'fastify'
import cors from '@fastify/cors'
import { PrismaClient } from '@prisma/client'
import { registerAuth } from '@/plugins/authenticate'
import { registerMeRoutes } from '@/routes/me'
import { registerPaymentRoutes } from '@/routes/payments'
import { createPaymentRegistry } from '@/payments/registry'
import { createPanelProvider } from '@/panel'

const app = Fastify({ logger: true })
const prisma = new PrismaClient()

const env = process.env

await app.register(cors, { origin: true })

registerAuth(app, env.TELEGRAM_BOT_TOKEN ?? '')

const payments = createPaymentRegistry({
  TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
  CRYPTOBOT_API_TOKEN: env.CRYPTOBOT_API_TOKEN,
  YOOKASSA_SHOP_ID: env.YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY: env.YOOKASSA_SECRET_KEY,
})

// Панель серверов сейчас в mock-режиме, пока не подняты боевые VPS —
// см. PANEL_MODE в .env.example.
const panel = createPanelProvider({
  PANEL_MODE: env.PANEL_MODE,
  PANEL_BASE_URL: env.PANEL_BASE_URL,
  PANEL_USERNAME: env.PANEL_USERNAME,
  PANEL_PASSWORD: env.PANEL_PASSWORD,
})
void panel // подключится к роутам конфигов на следующем этапе (4.6 из ТЗ)

registerMeRoutes(app, prisma)
registerPaymentRoutes(app, prisma, payments)

app.get('/health', async () => ({ ok: true }))

const port = Number(env.PORT ?? 3000)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
