import Fastify from 'fastify'
import cors from '@fastify/cors'
import { PrismaClient } from '@prisma/client'
import { registerAuth } from '@/plugins/authenticate'
import { registerMeRoutes } from '@/routes/me'
import { registerPaymentRoutes } from '@/routes/payments'
import { registerSubscriptionRoutes } from '@/routes/subscription'
import { registerApiRoutes } from '@/routes/api'
import { createPaymentRegistry } from '@/payments/registry'
import { createPanelProvider } from '@/panel'
import { createVpnService } from '@/services/vpn'
import { createSettingsService } from '@/services/settings'
import { createBillingService } from '@/services/billing'
import { createUserService } from '@/services/users'
import { createServerStatus } from '@/services/servers'
import { createJobs } from '@/services/jobs'
import { createTelegram } from '@/bot/tg'
import { createStaff } from '@/bot/staff'
import { createAdmin } from '@/bot/admin'
import { registerBot } from '@/bot/index'
import { botIdOf, parseBotTokens } from '@/lib/telegramAuth'
import { recordError } from '@/lib/errors'

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string
  }
}

const env = process.env
const app = Fastify({ logger: true })
const prisma = new PrismaClient()

// Сохраняем исходное тело запроса: по нему проверяется подпись вебхуков CryptoBot.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
  const text = typeof body === 'string' ? body : body.toString()
  request.rawBody = text
  try {
    done(null, text ? JSON.parse(text) : {})
  } catch (err) {
    done(err as Error, undefined)
  }
})
app.addHook('onError', async (request, _reply, error) => {
  recordError(`${request.method} ${request.url.split('?')[0]}`, error)
})

await app.register(cors, { origin: true })
// Первый токен в списке: активный бот (@lynkorobot). Остальные только для входа в Mini App.
const botTokens = parseBotTokens(env.TELEGRAM_BOT_TOKEN)
const botToken = botTokens[0] ?? ''
registerAuth(app, botTokens)

const tg = createTelegram(botToken)
const staff = createStaff(prisma, tg, env)
const settings = createSettingsService(prisma)
const payments = createPaymentRegistry({
  TELEGRAM_BOT_TOKEN: botToken,
  CRYPTOBOT_API_TOKEN: env.CRYPTOBOT_API_TOKEN,
  YOOKASSA_SHOP_ID: env.YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY: env.YOOKASSA_SECRET_KEY,
})
const panel = createPanelProvider(env)
const vpn = createVpnService(prisma, panel)
const billing = createBillingService(prisma, settings, vpn, payments, staff.notify, (t) => staff.notifyStaff(t, 'admin'))
const users = createUserService(prisma, (t) => staff.notifyStaff(t, 'owner'))
const servers = createServerStatus(env)
const webAppUrl = env.WEBAPP_URL || 'https://lumavpnbot.github.io/lumavpnhere/'
const jobs = createJobs({ prisma, tg, billing, vpn, log: app.log, webAppUrl })
const admin = createAdmin({ prisma, tg, staff, settings, billing, vpn, panel, servers, sendBroadcast: jobs.sendBroadcast })
app.log.info(`panel mode: ${panel.kind}`)

registerMeRoutes(app, { prisma, panel, vpn, users, settings, env })
registerPaymentRoutes(app, prisma, payments, billing)
registerSubscriptionRoutes(app, prisma, panel, env)
registerApiRoutes(app, { prisma, settings, servers, staff, env })
const bot = registerBot(app, { prisma, tg, botToken, staff, admin, settings, billing, users, env })

app.get('/health', async () => {
  const panelInfo = panel.describe ? await panel.describe().catch((e: Error) => ({ error: e.message })) : null
  // botIds: только публичная часть токенов (id бота), чтобы проверить, какой бот подключён.
  return { ok: true, botIds: botTokens.map(botIdOf), panel: panel.kind, panelInfo }
})

jobs.start()

const port = Number(env.PORT ?? 3000)
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => bot.setup().catch((err) => app.log.error({ err }, 'bot setup failed')))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
