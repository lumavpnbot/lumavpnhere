import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { BillingService } from '@/services/billing'
import type { SettingsService } from '@/services/settings'
import type { UserService } from '@/services/users'
import type { VpnService } from '@/services/vpn'
import { recordError } from '@/lib/errors'
import type { Admin } from './admin'
import type { Staff } from './staff'
import { esc, type TgMessage, type TgUpdate, type Telegram } from './tg'

/**
 * Бот @lynkorobot: /start (с реферальной ссылкой), /admin, оплата Stars,
 * сообщения в поддержку. Работает через вебхук POST /tg/webhook.
 */
export function registerBot(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient
    tg: Telegram
    botToken: string
    staff: Staff
    admin: Admin
    settings: SettingsService
    billing: BillingService
    users: UserService
    vpn: VpnService
    env: NodeJS.ProcessEnv
  },
) {
  const { prisma, tg, staff, admin, settings, billing, users, vpn, env } = deps
  const webAppUrl = env.WEBAPP_URL || 'https://lumavpnbot.github.io/lumavpnhere/'
  // Секрет вебхука выводим из токена: Telegram присылает его в заголовке, чужие запросы отбрасываем.
  const secret = crypto.createHash('sha256').update(`lynk-webhook:${deps.botToken}`).digest('hex').slice(0, 48)

  async function onStart(msg: TgMessage, payload: string | null) {
    const from = msg.from!
    const { user, created, attached } = await users.ensureUser({ tgId: from.id, username: from.username ?? null, refPayload: payload, fromBot: true })
    if (user.banned) return tg.send(msg.chat.id, 'Доступ к сервису ограничен. Если это ошибка, напишите в поддержку.')
    const s = await settings.get()
    if (attached && !created && user.trialUsed) {
      await vpn.grant(user, 'start', Math.max(0, s.trialDaysReferral - s.trialDays)).catch(() => undefined)
    }
    const extra = attached && user.referrerId ? `\n\n🎁 Вы пришли по приглашению друга: пробный период <b>${s.trialDaysReferral} дней</b>.` : ''
    await tg.send(msg.chat.id, s.welcomeText + extra, {
      keyboard: [[{ text: '🚀 Открыть LYNK', web_app: { url: webAppUrl } }], [{ text: '💬 Написать в поддержку', callback_data: 'u:support' }]],
    })
  }

  /** Любое обычное сообщение пользователя: это обращение в поддержку. */
  async function onUserText(msg: TgMessage) {
    const from = msg.from!
    const { user } = await users.ensureUser({ tgId: from.id, username: from.username ?? null, fromBot: true })
    const text = (msg.text ?? '').trim()
    if (!text) return
    let ticket = await prisma.supportTicket.findFirst({ where: { userId: user.id, status: { in: ['open', 'answered'] } }, orderBy: { updatedAt: 'desc' } })
    const isNew = !ticket
    if (!ticket) ticket = await prisma.supportTicket.create({ data: { userId: user.id, subject: text.slice(0, 80) } })
    else await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'open' } })
    await prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorTgId: user.tgId, text } })
    await tg.send(msg.chat.id, isNew ? `📨 Обращение <b>#${ticket.id}</b> создано. Ответим здесь, в этом чате.` : '📨 Добавили к вашему обращению.')
    for (const id of await staff.staffIds('support')) {
      await tg
        .send(id, `💬 <b>${isNew ? 'Новое обращение' : 'Сообщение в обращении'} #${ticket.id}</b>\nОт: ${user.username ? '@' + esc(user.username) : user.tgId}\n\n${esc(text).slice(0, 800)}`, {
          keyboard: [[{ text: 'Открыть', callback_data: `adm:t:${ticket.id}` }]],
        })
        .catch(() => undefined)
    }
  }

  async function onPreCheckout(q: NonNullable<TgUpdate['pre_checkout_query']>) {
    const payment = await prisma.payment.findUnique({ where: { orderId: q.invoice_payload } })
    const ok = !!payment && payment.status === 'pending' && payment.method === 'stars' && payment.starsAmount === q.total_amount
    await tg.call('answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: 'Счёт устарел. Откройте оплату в приложении заново.' }),
    })
  }

  async function handle(update: TgUpdate) {
    if (update.pre_checkout_query) return onPreCheckout(update.pre_checkout_query)

    if (update.callback_query) {
      const cq = update.callback_query
      const data = cq.data ?? ''
      const chatId = cq.message?.chat.id ?? cq.from.id
      if (data === 'u:support') {
        await tg.answerCallback(cq.id)
        return tg.send(chatId, '✍️ Опишите вопрос одним сообщением: что не работает, какое устройство и приложение. Мы ответим здесь.')
      }
      if (data.startsWith('adm:')) {
        const role = await staff.roleOf(cq.from.id)
        if (!role) return tg.answerCallback(cq.id)
        try {
          const note = await admin.onCallback({ chatId, tgId: cq.from.id, role, messageId: cq.message?.message_id }, data)
          await tg.answerCallback(cq.id, note || undefined)
        } catch (err) {
          recordError('admin', err)
          await tg.answerCallback(cq.id, `Ошибка: ${(err as Error).message}`.slice(0, 190), true)
        }
      }
      return
    }

    const msg = update.message
    if (!msg?.from || msg.chat.type !== 'private') return

    if (msg.successful_payment) {
      const sp = msg.successful_payment
      await billing.completePayment(sp.invoice_payload, sp.telegram_payment_charge_id)
      return
    }

    const text = msg.text ?? ''
    const [command, ...rest] = text.split(' ')
    const isAdminCmd = command === '/admin' || (command === '/start' && rest[0] === 'admin')
    if (command === '/start' && !isAdminCmd) return onStart(msg, rest[0] ?? null)
    if (isAdminCmd) {
      const role = await staff.roleOf(msg.from.id)
      if (!role) return command === '/start' ? onStart(msg, null) : undefined // обычным пользователям /admin не отвечает (ТЗ 6)
      await users.ensureUser({ tgId: msg.from.id, username: msg.from.username ?? null, fromBot: true })
      const view = admin.home(role)
      return admin.show({ chatId: msg.chat.id, tgId: msg.from.id, role }, view)
    }

    const role = await staff.roleOf(msg.from.id)
    if (role && admin.hasState(msg.from.id)) {
      await admin.onText({ chatId: msg.chat.id, tgId: msg.from.id, role }, text)
      return
    }
    if (command.startsWith('/')) {
      return tg.send(msg.chat.id, 'Откройте приложение кнопкой меню или отправьте /start. Вопрос в поддержку можно написать прямо сюда.')
    }
    return onUserText(msg)
  }

  app.post('/tg/webhook', async (request, reply) => {
    if (request.headers['x-telegram-bot-api-secret-token'] !== secret) return reply.code(401).send()
    const update = request.body as TgUpdate
    // Отвечаем Telegram сразу, обработка идёт в фоне (иначе при долгой операции будет повтор).
    handle(update).catch((err) => {
      recordError('bot', err)
      app.log.error({ err }, 'bot update failed')
    })
    return reply.send({ ok: true })
  })

  /** Регистрируем вебхук и команды. PUBLIC_URL: адрес бэкенда на Railway. */
  async function setup(): Promise<string> {
    if (!tg.enabled) return 'нет TELEGRAM_BOT_TOKEN'
    if (!env.PUBLIC_URL) return 'нет PUBLIC_URL'
    if (env.BOT_DISABLED === '1') return 'выключено через BOT_DISABLED'
    const url = `${env.PUBLIC_URL.replace(/\/+$/, '')}/tg/webhook`
    await tg.call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      drop_pending_updates: false,
    })
    await tg.call('setMyCommands', { commands: [{ command: 'start', description: 'Открыть LYNK' }] })
    // Команде показываем /admin в меню команд (только в их личных чатах).
    for (const id of await staff.staffIds('support')) {
      await tg
        .call('setMyCommands', {
          commands: [
            { command: 'start', description: 'Открыть LYNK' },
            { command: 'admin', description: 'Админ-меню' },
          ],
          scope: { type: 'chat', chat_id: id },
        })
        .catch(() => undefined)
    }
    app.log.info(`bot webhook set: ${url}`)
    return `вебхук установлен: ${url}`
  }

  return { setup }
}
