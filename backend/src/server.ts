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
import { registerTransferRoutes } from '@/routes/transfer'
import { registerAchievementRoutes } from '@/routes/achievements'
import { registerStatusRoutes } from '@/routes/status'
import { registerReviewRoutes } from '@/routes/reviews'
import { createReviewService } from '@/services/reviews'
import { createAchievementService } from '@/services/achievements'
import { createTransferService } from '@/services/transfer'
import { createStatusService } from '@/services/status'
import { createNpdReceipts } from '@/services/npdReceipts'
import { createTelegram, telegramApiBase, type InlineKeyboard } from '@/bot/tg'
import { createStaff, ownerIds } from '@/bot/staff'
import { createAdmin } from '@/bot/admin'
import { createAdminFeatures } from '@/bot/adminFeatures'
import { registerBot, statusPageUrl } from '@/bot/index'
import { botIdOf, parseBotTokens } from '@/lib/telegramAuth'
import { recordError } from '@/lib/errors'

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string
  }
}

// Локальный запуск (npm run dev): читаем backend/.env. На Railway переменные уже в окружении,
// и они важнее файла (loadEnvFile не перезаписывает заданные переменные).
try {
  process.loadEnvFile()
} catch {
  /* .env нет — берём только окружение */
}

const env = process.env
// За прокси Railway реальный IP клиента в X-Forwarded-For: он нужен для антифрода переноса и лимитов.
const app = Fastify({ logger: true, trustProxy: env.TRUST_PROXY !== '0' })
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

const tg = createTelegram(botToken, telegramApiBase(env))
const staff = createStaff(prisma, tg, env)
const settings = createSettingsService(prisma)
// 02.10.2026 пробный период стал 3 дня (по приглашению 4): значения, сохранённые в админке раньше
// (7 и 10), больше не действуют. Изменения из админки после этой даты сохраняются как обычно.
await prisma.setting
  .deleteMany({ where: { key: { in: ['trialDays', 'trialDaysReferral'] }, updatedAt: { lt: new Date('2026-10-02T13:00:00Z') } } })
  .catch((err) => app.log.error({ err }, 'trial settings reset failed'))
const payments = createPaymentRegistry({
  TELEGRAM_BOT_TOKEN: botToken,
  TELEGRAM_API_URL: telegramApiBase(env),
  CRYPTOBOT_API_TOKEN: env.CRYPTOBOT_API_TOKEN,
  YOOKASSA_SHOP_ID: env.YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY: env.YOOKASSA_SECRET_KEY,
  YOOKASSA_RECEIPT: env.YOOKASSA_RECEIPT,
  YOOKASSA_RECEIPT_EMAIL: env.YOOKASSA_RECEIPT_EMAIL,
  YOOKASSA_VAT_CODE: env.YOOKASSA_VAT_CODE,
  PLATEGA_MERCHANT_ID: env.PLATEGA_MERCHANT_ID,
  PLATEGA_SECRET: env.PLATEGA_SECRET,
  // После оплаты СБП возвращаем покупателя в бота (Mini App тем временем ждёт подтверждения).
  PLATEGA_RETURN_URL: env.PLATEGA_RETURN_URL || `https://t.me/${picked.username ?? botUsername}`,
})
const panel = createPanelProvider(env)
const owners = ownerIds(env)
const vpn = createVpnService(prisma, panel, (tgId) => owners.has(tgId))
const achievements = createAchievementService({ prisma, settings, vpn, notify: staff.notify })
// Чеки самозанятого в «Мой налог» после оплаты рублями: ключ доступа по SMS из админки
// (хранится в БД, шифруется токеном бота) или MOY_NALOG_INN / MOY_NALOG_PASSWORD.
const receipts = createNpdReceipts({
  prisma,
  settings,
  env,
  secret: botToken,
  notifyUser: staff.notify,
  notifyStaff: (t) => staff.notifyStaff(t, 'admin'),
})
await receipts.init().catch((err) => app.log.error({ err }, 'npd init failed'))
const billing = createBillingService(prisma, settings, vpn, payments, staff.notify, (t) => staff.notifyStaff(t, 'admin'), achievements, (id) => {
  void receipts.issue(id)
})
const users = createUserService(prisma, (t) => staff.notifyStaff(t, 'owner'))
const servers = createServerStatus(env)
/** Сообщение команде (админам и владельцам) с кнопками, например «Открыть заявку». */
const notifyAdmins = async (text: string, keyboard?: InlineKeyboard) => {
  for (const id of await staff.staffIds('admin')) await tg.send(id, text, { keyboard }).catch(() => undefined)
}
const transfer = createTransferService({ prisma, settings, vpn, achievements, notify: staff.notify, notifyStaff: notifyAdmins })
const status = createStatusService({
  prisma,
  env,
  // Авто-инциденты: команде и в канал статуса (STATUS_CHANNEL_ID, ТЗ 02 «бот дублирует алерты в канал»).
  alert: async (text) => {
    await notifyAdmins(text)
    if (env.STATUS_CHANNEL_ID) await tg.send(env.STATUS_CHANNEL_ID, text).catch((err) => recordError('status channel', err))
  },
})
// Новый отзыв: команде уведомление с кнопкой «Скрыть» (на случай мата или спама).
const reviews = createReviewService(prisma, async (review, user, isNew) => {
  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)
  const text = review.text ? `\n\n«${review.text.replace(/</g, '&lt;').slice(0, 600)}»` : ''
  await notifyAdmins(`⭐ <b>${isNew ? 'Новый отзыв' : 'Отзыв изменён'}</b> · ${stars}\nОт: ${user.username ? '@' + user.username : user.tgId}${text}`, [
    [{ text: '🙈 Скрыть', callback_data: `adm:rvh:${review.id}:1` }, { text: 'Открыть', callback_data: `adm:rvc:${review.id}` }],
  ])
})
const webAppUrl = env.WEBAPP_URL || 'https://lumavpnbot.github.io/lumavpnhere/'
const jobs = createJobs({ prisma, tg, billing, vpn, log: app.log, webAppUrl, status, achievements, receipts })
const admin = createAdmin({
  prisma,
  tg,
  staff,
  settings,
  billing,
  vpn,
  panel,
  servers,
  receipts,
  sendBroadcast: jobs.sendBroadcast,
  features: (api) =>
    createAdminFeatures({ prisma, tg, staff, settings, vpn, transfer, achievements, status, sendBroadcast: jobs.sendBroadcast, statusUrl: statusPageUrl(env), reviews }, api),
})
app.log.info(`panel mode: ${panel.kind}`)

registerMeRoutes(app, { prisma, panel, vpn, users, settings, achievements, env })
registerPaymentRoutes(app, prisma, payments, billing)
registerSubscriptionRoutes(app, prisma, panel, vpn, env)
registerApiRoutes(app, { prisma, settings, servers, staff, vpn, env })
registerEmailRoutes(app, prisma, env)
registerTransferRoutes(app, { transfer, settings, users })
registerAchievementRoutes(app, { achievements, users, tg, env })
registerStatusRoutes(app, status)
registerReviewRoutes(app, { reviews, users })
let botSetup = 'ещё не запускалась'
const bot = registerBot(app, { prisma, tg, botToken, staff, admin, settings, billing, users, vpn, achievements, reviews, env })

app.get('/health', async () => {
  const panelInfo = panel.describe ? await panel.describe().catch((e: Error) => ({ error: e.message })) : null
  // botIds: только публичная часть токенов (id бота), чтобы проверить, какой бот подключён.
  const webhook = tg.enabled
    ? await tg.call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>('getWebhookInfo').catch((e: Error) => ({ error: e.message }))
    : null
  return {
    ok: true,
    // Какая версия сейчас запущена (Railway подставляет коммит сам) и какие способы оплаты включены:
    // так видно, выкатился ли деплой и подхватились ли ключи (например, ЮKassa → yookassa_sbp).
    version: env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    payments: payments.listEnabled().map((p) => p.id),
    receipts: receipts.enabled ? 'moy-nalog' : null,
    botIds: botTokens.map(botIdOf),
    bot: { username: picked.username, id: botIdOf(botToken), setup: botSetup, webhook },
    panel: panel.kind,
    panelInfo,
    // Сколько пользователей ждут выдачи доступа на панели (панель не приняла; повтор раз в 2 минуты).
    panelPending: await prisma.user.count({ where: { panelPendingAt: { not: null } } }).catch(() => null),
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
