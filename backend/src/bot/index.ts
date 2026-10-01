import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { PanelProvider } from '@/panel'
import { CLIENT_APPS, clientOpenUrls, subscriptionUrl } from '@/routes/subscription'
import type { AchievementService } from '@/services/achievements'
import type { BillingService } from '@/services/billing'
import type { StatusService } from '@/services/status'
import { LEVEL_NAMES, type SettingsService } from '@/services/settings'
import type { UserService } from '@/services/users'
import { LATEST_FIRST, PLAN_LIMITS, type VpnService } from '@/services/vpn'
import { recordError } from '@/lib/errors'
import type { Admin } from './admin'
import type { Staff } from './staff'
import { esc, type InlineKeyboard, type TgMessage, type TgUpdate, type Telegram } from './tg'

const DAY = 24 * 60 * 60 * 1000

/** Публичная страница статуса: STATUS_PAGE_URL (например https://status.lynk.io) или <PUBLIC_URL>/status. */
export function statusPageUrl(env: NodeJS.ProcessEnv) {
  if (env.STATUS_PAGE_URL) return env.STATUS_PAGE_URL
  const base = (env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/status` : null
}

const rub =(n: unknown) => `${Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
const dateMsk = (d: Date) => d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
const daysWord = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'день'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня'
  return 'дней'
}

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
    panel: PanelProvider
    achievements?: AchievementService
    status?: StatusService
    env: NodeJS.ProcessEnv
  },
) {
  const { prisma, tg, staff, admin, settings, billing, users, vpn, panel, achievements, status, env } = deps
  const statusUrl = statusPageUrl(env)

  /** ТЗ 02: при сбое в боте появляется кнопка, ведущая на страницу статуса. */
  async function statusButton(): Promise<InlineKeyboard> {
    if (!status || !statusUrl?.startsWith('https://')) return []
    const overall = await status.overall().catch(() => 'ok' as const)
    return overall === 'ok' ? [] : [[{ text: overall === 'down' ? '🔴 Сбой: статус сервиса' : '🟠 Статус сервиса', url: statusUrl }]]
  }
  const webAppUrl = env.WEBAPP_URL || 'https://lumavpnbot.github.io/lumavpnhere/'
  const botUsername = (env.BOT_USERNAME || 'lynkorobot').replace(/^@/, '')
  // Секрет вебхука выводим из токена: Telegram присылает его в заголовке, чужие запросы отбрасываем.
  const secret = crypto.createHash('sha256').update(`lynk-webhook:${deps.botToken}`).digest('hex').slice(0, 48)

  const openApp = { text: '🚀 Открыть LYNK', web_app: { url: webAppUrl } }
  const startKeyboard: InlineKeyboard = [
    [openApp],
    [{ text: '📊 Моя подписка', callback_data: 'u:sub' }],
    [{ text: '💬 Написать в поддержку', callback_data: 'u:support' }],
  ]

  async function onStart(msg: TgMessage, payload: string | null) {
    const from = msg.from!
    const { user, created, attached } = await users.ensureUser({ tgId: from.id, username: from.username ?? null, refPayload: payload, fromBot: true })
    if (user.banned) return tg.send(msg.chat.id, 'Доступ к сервису ограничен. Если это ошибка, напишите в поддержку.')
    const s = await settings.get()
    if (attached && !created && user.trialUsed) {
      await vpn.grant(user, 'start', Math.max(0, s.trialDaysReferral - s.trialDays)).catch(() => undefined)
    }
    const extra = attached && user.referrerId ? `\n\n🎁 Вы пришли по приглашению друга: пробный период <b>${s.trialDaysReferral} дней</b>.` : ''
    if (attached && user.referrerId && achievements) void achievements.evaluateById(user.referrerId).catch(() => undefined)
    await tg.send(msg.chat.id, s.welcomeText + extra, { keyboard: [...(await statusButton()), ...startKeyboard] })
  }

  /**
   * «Моя подписка» прямо в боте: статус, срок, трафик, устройства, баланс и ссылка
   * подписки. Данные те же, что в Mini App (/me), панель сверяется с БД.
   */
  async function subscriptionCard(from: { id: number; username?: string }): Promise<{ text: string; kb: InlineKeyboard }> {
    const { user } = await users.ensureUser({ tgId: from.id, username: from.username ?? null, fromBot: true })
    if (user.banned) return { text: 'Доступ к сервису ограничен. Если это ошибка, напишите в поддержку.', kb: [] }
    const isOwner = staff.owners.has(from.id)
    if (isOwner) await vpn.ensureAdmin(user).catch((err) => recordError('bot ensureAdmin', err))

    const sub = await vpn.current(user.id)
    const last = sub ?? (await prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: LATEST_FIRST }))
    let client = await panel.getClient(from.id).catch(() => null)
    if (sub && !isOwner) client = await vpn.sync(user, client).then((r) => r.client, () => client)
    const [devices, invited, earned] = await Promise.all([
      prisma.device.count({ where: { userId: user.id } }),
      prisma.user.count({ where: { referrerId: user.id } }),
      prisma.referralPayout.aggregate({ where: { referrerId: user.id, status: { in: ['hold', 'paid'] } }, _sum: { amountRub: true } }),
    ])

    const lines: string[] = ['📊 <b>Моя подписка</b>', '']
    const kb: InlineKeyboard = [[openApp]]
    if (sub) {
      const left = Math.max(0, Math.ceil((sub.expiresAt.getTime() - Date.now()) / DAY))
      const limits = PLAN_LIMITS[sub.plan]
      const trafficLimit = isOwner ? null : limits.trafficGb
      const used = Math.round((client?.trafficUsedGb ?? 0) * 10) / 10
      lines.push(
        `Статус: 🟢 <b>${sub.status === 'trial' ? 'Пробный период' : 'Активна'}</b>`,
        `Тариф: <b>${sub.plan === 'pro' ? 'Премиум' : 'Старт'}</b>`,
        `Действует до: <b>${dateMsk(sub.expiresAt)}</b> (${left} ${daysWord(left)})`,
        `Трафик: <b>${trafficLimit == null ? `${used} ГБ, без лимита` : `${used} из ${trafficLimit} ГБ`}</b>`,
        `Устройства: <b>${devices}${isOwner || limits.devices == null ? '' : ` из ${limits.devices}`}</b>`,
        `Автопродление: <b>${sub.autoRenew ? 'включено' : 'выключено'}</b>`,
      )
      const link = subscriptionUrl(env, user.subToken)
      if (link) lines.push('', '🔗 Ссылка подписки (нажмите, чтобы скопировать):', `<code>${esc(link)}</code>`)
      // Кнопки добавления подписки в каждый клиент: Happ, INCY, Hiddify.
      const open = Object.entries(clientOpenUrls(env, user.subToken)).filter((e): e is [keyof typeof CLIENT_APPS, string] => Boolean(e[1]?.startsWith('https://')))
      if (open.length) kb.push(open.map(([id, url]) => ({ text: `📲 ${CLIENT_APPS[id].name}`, url })))
    } else if (last) {
      lines.push(`Статус: 🔴 <b>Закончилась ${dateMsk(last.expiresAt)}</b>`, '', 'Продлите подписку в приложении: это займёт минуту.')
    } else {
      const s = await settings.get()
      lines.push('Статус: ⚪️ <b>Подписки пока нет</b>')
      if (!user.trialUsed) {
        const days = user.referrerId ? s.trialDaysReferral : s.trialDays
        lines.push('', `Попробуйте бесплатно: пробный период <b>${days} ${daysWord(days)}</b>.`)
        kb.push([{ text: '🎁 Активировать пробный период', callback_data: 'u:trial' }])
      }
    }
    lines.push(
      '',
      `💰 Баланс: <b>${rub(user.balanceRub)}</b>`,
      `🎁 Друзей: <b>${invited}</b> · заработано ${rub(earned._sum.amountRub)} · уровень ${LEVEL_NAMES[user.referralLevel] ?? LEVEL_NAMES[0]}`,
    )
    if (user.refCode) lines.push(`Ваша ссылка для друзей: <code>https://t.me/${esc(botUsername)}?start=REF_${esc(user.refCode)}</code>`)
    lines.push('', `<i>Обновлено ${new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })} МСК</i>`)
    kb.push(...(await statusButton()))
    kb.push([{ text: '🔄 Обновить', callback_data: 'u:subr' }, { text: '💬 Поддержка', callback_data: 'u:support' }])
    return { text: lines.join('\n'), kb }
  }

  async function sendSubscription(chatId: number, from: { id: number; username?: string }, messageId?: number) {
    const view = await subscriptionCard(from)
    if (messageId) await tg.edit(chatId, messageId, view.text, view.kb)
    else await tg.send(chatId, view.text, { keyboard: view.kb })
  }

  /** Пробный период из бота (если человек ещё не открывал Mini App). */
  async function activateTrial(from: { id: number; username?: string }): Promise<string> {
    const { user } = await users.ensureUser({ tgId: from.id, username: from.username ?? null, fromBot: true })
    if (user.banned) return 'Доступ ограничен'
    if (user.trialUsed || (await prisma.subscription.count({ where: { userId: user.id } }))) return 'Пробный период уже использован'
    const s = await settings.get()
    await vpn.startTrial(user, user.referrerId ? s.trialDaysReferral : s.trialDays)
    return 'Пробный период активирован'
  }

  /** Любое обычное сообщение пользователя: это обращение в поддержку. */
  async function onUserText(msg: TgMessage) {
    const from = msg.from!
    const { user } = await users.ensureUser({ tgId: from.id, username: from.username ?? null, fromBot: true })
    const text = (msg.text ?? '').trim()
    if (!text) {
      await tg.send(msg.chat.id, 'Пока принимаем обращения только текстом: опишите вопрос сообщением.').catch(() => undefined)
      return
    }
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
      if (data === 'u:sub' || data === 'u:subr' || data === 'u:trial') {
        try {
          let note: string | undefined
          if (data === 'u:trial') note = await activateTrial(cq.from)
          // «Обновить» и пробный период перерисовывают карточку, кнопка из приветствия присылает новую.
          await sendSubscription(chatId, cq.from, data === 'u:sub' ? undefined : cq.message?.message_id)
          await tg.answerCallback(cq.id, note ?? (data === 'u:subr' ? 'Обновлено' : undefined))
        } catch (err) {
          recordError('bot sub', err)
          await tg.answerCallback(cq.id, 'Не удалось загрузить данные, попробуйте ещё раз', true)
        }
        return
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
    const [rawCommand, ...rest] = text.trim().split(/\s+/)
    // «/sub@lynkorobot» → «/sub»
    const command = rawCommand.startsWith('/') ? rawCommand.split('@')[0].toLowerCase() : rawCommand
    const isAdminCmd = command === '/admin' || (command === '/start' && rest[0] === 'admin')
    if (command === '/start' && !isAdminCmd) return onStart(msg, rest[0] ?? null)
    if (command === '/sub' || command === '/me' || command === '/profile' || command === '/status') return sendSubscription(msg.chat.id, msg.from)
    if (command === '/support' || command === '/help') {
      return tg.send(msg.chat.id, '✍️ Опишите вопрос одним сообщением: что не работает, какое устройство и приложение. Мы ответим здесь.', { keyboard: startKeyboard })
    }
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
    const userCommands = [
      { command: 'start', description: 'Открыть LYNK' },
      { command: 'sub', description: 'Моя подписка' },
      { command: 'support', description: 'Написать в поддержку' },
    ]
    await tg.call('setMyCommands', { commands: userCommands })
    // Команде показываем /admin в меню команд (только в их личных чатах).
    for (const id of await staff.staffIds('support')) {
      await tg
        .call('setMyCommands', {
          commands: [...userCommands, { command: 'admin', description: 'Админ-меню' }],
          scope: { type: 'chat', chat_id: id },
        })
        .catch(() => undefined)
    }
    app.log.info(`bot webhook set: ${url}`)
    return `вебхук установлен: ${url}`
  }

  return { setup }
}
