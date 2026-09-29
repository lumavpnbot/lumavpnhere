import Fastify from 'fastify'
import cors from '@fastify/cors'
import { PrismaClient } from '@prisma/client'
import { ZodError } from 'zod'
import { registerAuth } from '@/plugins/authenticate'
import { registerMeRoutes } from '@/routes/me'
import { registerPaymentRoutes } from '@/routes/payments'
import { registerSubscriptionRoutes } from '@/routes/subscription'
import { registerApiRoutes } from '@/routes/api'
import { registerEmailRoutes } from '@/routes/email'
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
    done(Object.assign(err as Error, { statusCode: 400 }), undefined)
  }
})
// Ошибки валидации (zod) отдаём как 400 с понятным текстом, а не 500.
app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') })
  }
  const status = (error as { statusCode?: number }).statusCode ?? 500
  if (status >= 500) request.log.error({ err: error }, 'request failed')
  return reply.code(status).send({ error: status >= 500 ? 'Внутренняя ошибка сервера' : (error as Error).message })
})
app.addHook('onError', async (request, _reply, error) => {
  recordError(`${request.method} ${request.url.split('?')[0]}`, error)
})

await app.register(cors, { origin: true })
// Первый токен в списке: активный бот (@lynkorobot). Остальные только для входа в Mini App.
const botTokens = parseBotTokens(env.TELEGRAM_BOT_TOKEN)
const botUsername = (env.BOT_USERNAME || 'lynkorobot').replace(/^@/, '').toLowerCase()
registerAuth(app, botTokens)

/**
 * Какой из токенов управляет ботом: тот, чей username совпадает с BOT_USERNAME.
 * Так неважно, в каком порядке токены записаны в TELEGRAM_BOT_TOKEN.
 */
async function pickBotToken(): Promise<{ token: string; username: string | null }> {
  let fallback: { token: string; username: string | null } | null = null
  for (const token of botTokens) {
    try {
      const me = await createTelegram(token).call<{ username: string }>('getMe')
      if (me.username.toLowerCase() === botUsername) return { token, username: me.username }
      fallback ??= { token, username: me.username }
    } catch (err) {
      app.log.warn(`getMe failed for bot ${botIdOf(token)}: ${(err as Error).message}`)
    }
  }
  return fallback ?? { token: botTokens[0] ?? '', username: null }
}
const picked = await pickBotToken()
const botToken = picked.token
app.log.info(`bot: @${picked.username ?? '?'} (id ${botIdOf(botToken)})`)

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
registerEmailRoutes(app, prisma, env)
let botSetup = 'ещё не запускалась'
const bot = registerBot(app, { prisma, tg, botToken, staff, admin, settings, billing, users, vpn, env })

app.get('/health', async () => {
  const panelInfo = panel.describe ? await panel.describe().catch((e: Error) => ({ error: e.message })) : null
  // botIds: только публичная часть токенов (id бота), чтобы проверить, какой бот подключён.
  const webhook = tg.enabled
    ? await tg.call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>('getWebhookInfo').catch((e: Error) => ({ error: e.message }))
    : null
  return {
    ok: true,
    botIds: botTokens.map(botIdOf),
    bot: { username: picked.username, id: botIdOf(botToken), setup: botSetup, webhook },
    panel: panel.kind,
    panelInfo,
  }
})

jobs.start()

const port = Number(env.PORT ?? 3000)
app
  .listen({ port, host: '0.0.0.0' })
  .then(() =>
    bot.setup().then(
      (r) => (botSetup = r),
      (err: Error) => {
        botSetup = `ошибка: ${err.message}`
        app.log.error({ err }, 'bot setup failed')
      },
    ),
  )
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
