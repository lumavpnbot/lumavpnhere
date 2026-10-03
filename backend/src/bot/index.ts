import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { AchievementService } from '@/services/achievements'
import type { BillingService } from '@/services/billing'
import { ReviewError, type ReviewService } from '@/services/reviews'
import type { AppSettings, SettingsService } from '@/services/settings'
import type { UserService } from '@/services/users'
import type { VpnService } from '@/services/vpn'
import { recordError } from '@/lib/errors'
import type { Admin } from './admin'
import type { Staff } from './staff'
import { sendWelcome } from './welcome'
import { esc, mediaOf, type InlineButton, type InlineKeyboard, type TgMessage, type TgUpdate, type Telegram } from './tg'

/** Публичная страница статуса: STATUS_PAGE_URL (например https://status.lynk.io) или <PUBLIC_URL>/status. */
export function statusPageUrl(env: NodeJS.ProcessEnv) {
  if (env.STATUS_PAGE_URL) return env.STATUS_PAGE_URL
  const base = (env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/status` : null
}

/**
 * Бот @lynkorobot: /start (с реферальной ссылкой), /support, /admin, оплата Stars,
 * сообщения в поддержку. Всё остальное (подписка, оплата, подключение) в Mini App:
 * в боте только кнопки «Открыть» и «Перенести подписку». Работает через вебхук POST /tg/webhook.
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
    achievements?: AchievementService
    reviews?: ReviewService
    env: NodeJS.ProcessEnv
  },
) {
  const { prisma, tg, staff, admin, settings, billing, users, vpn, achievements, reviews, env } = deps
  const webAppUrl = env.WEBAPP_URL || 'https://lumavpnbot.github.io/lumavpnhere/'
  // Секрет вебхука выводим из токена: Telegram присылает его в заголовке, чужие запросы отбрасываем.
  const secret = crypto.createHash('sha256').update(`lynk-webhook:${deps.botToken}`).digest('hex').slice(0, 48)

  /** Mini App сразу на нужном экране: ?screen=transfer (см. frontend/src/main.tsx). */
  const screenUrl = (screen: string) => {
    const u = new URL(webAppUrl)
    u.searchParams.set('screen', screen)
    u.hash = ''
    return u.toString()
  }
  /** Кнопка Mini App: с премиум-эмодзи из настроек (админка → «Эмодзи кнопок») или с обычным. */
  const appButton = (label: string, emoji: string, iconId: string, url: string): InlineButton =>
    iconId ? { text: label, icon_custom_emoji_id: iconId, web_app: { url } } : { text: `${emoji} ${label}`, web_app: { url } }
  const startKeyboard = (s: AppSettings): InlineKeyboard => [
    [appButton('Открыть LYNK', '🚀', s.buttonEmoji.open, webAppUrl)],
    [appButton('Перенести подписку', '🔁', s.buttonEmoji.transfer, screenUrl('transfer'))],
    ...(reviews ? [[{ text: '⭐ Оценить LYNK', callback_data: 'rv:open' }]] : []),
  ]
  const SUPPORT_PROMPT = '✍️ Опишите вопрос одним сообщением: что не работает, какое устройство и приложение. Мы ответим здесь.'

  async function onStart(msg: TgMessage, payload: string | null) {
    const from = msg.from!
    const { user, created, attached } = await users.ensureUser({ tgId: from.id, username: from.username ?? null, refPayload: payload, fromBot: true })
    if (user.banned) return tg.send(msg.chat.id, 'Доступ к сервису ограничен. Если это ошибка, напишите в поддержку.')
    const s = await settings.get()
    if (attached && !created && user.trialUsed) {
      await vpn.grant(user, 'start', Math.max(0, s.trialDaysReferral - s.trialDays)).catch(() => undefined)
    }
    const n = s.trialDaysReferral
    const word = n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'дня' : 'дней'
    const extra = attached && user.referrerId ? `\n\n🎁 Тебя пригласил друг: пробный период <b>${n} ${word}</b>.` : ''
    if (attached && user.referrerId && achievements) void achievements.evaluateById(user.referrerId).catch(() => undefined)
    await sendWelcome(tg, msg.chat.id, s, { extra, keyboard: startKeyboard(s) })
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

  // ── Отзывы в боте: оценка кнопками, текст следующим сообщением ─────────────
  // Кто сейчас пишет текст отзыва: tgId → до какого времени ждём сообщение.
  const reviewWaiting = new Map<number, number>()
  const STAR_LABEL = ['', 'Ужасно', 'Плохо', 'Нормально', 'Хорошо', 'Отлично']
  const starsLine = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)

  async function reviewView(tgId: number, username: string | null): Promise<{ text: string; keyboard: InlineKeyboard }> {
    const { user } = await users.ensureUser({ tgId, username, fromBot: true })
    const [mine, elig, sum] = await Promise.all([reviews!.mine(user), reviews!.eligibility(user), reviews!.summary()])
    const head =
      `⭐ <b>Отзыв о LYNK</b>\n` +
      (sum.count ? `Средняя оценка: <b>${sum.average.toFixed(1)}</b> из 5 · ${sum.count} оценок\n` : '') +
      `<code>─────────────────────</code>\n`
    if (!elig.ok && !mine) return { text: `${head}${esc(elig.reason)}.`, keyboard: [] }
    const stars = [1, 2, 3, 4, 5].map((n) => ({ text: mine?.rating === n ? `✅ ${n}⭐` : `${n}⭐`, callback_data: `rv:s:${n}` }))
    const body = mine
      ? `Ваша оценка: <b>${starsLine(mine.rating)}</b> · ${STAR_LABEL[mine.rating]}\n` +
        (mine.text ? `\n«${esc(mine.text).slice(0, 600)}»\n` : '\n<i>Без текста</i>\n') +
        (mine.hidden ? '\n<i>Отзыв скрыт модератором.</i>\n' : '') +
        `\nМожно поменять оценку или текст в любой момент. Один аккаунт, один отзыв.`
      : 'Поставьте оценку от 1 до 5. Текст по желанию: можно добавить после оценки.'
    const keyboard: InlineKeyboard = [stars]
    if (mine) keyboard.push([{ text: mine.text ? '✍️ Изменить текст' : '✍️ Добавить текст', callback_data: 'rv:text' }, { text: '🗑 Удалить', callback_data: 'rv:del' }])
    return { text: head + body, keyboard }
  }

  async function onReviewCallback(cq: NonNullable<TgUpdate['callback_query']>, data: string) {
    const chatId = cq.message?.chat.id ?? cq.from.id
    const messageId = cq.message?.message_id
    const render = async () => {
      const v = await reviewView(cq.from.id, cq.from.username ?? null)
      if (messageId && data !== 'rv:open') await tg.edit(chatId, messageId, v.text, v.keyboard)
      else await tg.send(chatId, v.text, { keyboard: v.keyboard })
    }
    const { user } = await users.ensureUser({ tgId: cq.from.id, username: cq.from.username ?? null, fromBot: true })
    try {
      if (data.startsWith('rv:s:')) {
        const rating = Number(data.slice(5))
        const had = await reviews!.mine(user)
        await reviews!.upsert(user, { rating, keepText: true }, 'bot')
        await tg.answerCallback(cq.id, `Оценка ${rating} из 5 сохранена`)
        await render()
        if (!had?.text) {
          reviewWaiting.set(cq.from.id, Date.now() + 10 * 60_000)
          await tg.send(chatId, '✍️ Хотите добавить пару слов? Напишите отзыв одним сообщением. Или просто ничего не отправляйте: оценка уже сохранена.', {
            keyboard: [[{ text: 'Без текста', callback_data: 'rv:skip' }]],
          })
        }
        return
      }
      if (data === 'rv:text') {
        reviewWaiting.set(cq.from.id, Date.now() + 10 * 60_000)
        await tg.answerCallback(cq.id)
        await tg.send(chatId, '✍️ Напишите отзыв одним сообщением (до 1000 символов, без ссылок).', { keyboard: [[{ text: 'Отмена', callback_data: 'rv:skip' }]] })
        return
      }
      if (data === 'rv:skip') {
        reviewWaiting.delete(cq.from.id)
        await tg.answerCallback(cq.id, 'Готово')
        if (messageId) await tg.call('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => undefined)
        return
      }
      if (data === 'rv:del') {
        await reviews!.remove(user)
        reviewWaiting.delete(cq.from.id)
        await tg.answerCallback(cq.id, 'Отзыв удалён')
        await render()
        return
      }
      await tg.answerCallback(cq.id)
      await render()
    } catch (err) {
      await tg.answerCallback(cq.id, err instanceof ReviewError ? err.message : 'Не получилось, попробуйте ещё раз', true)
    }
  }

  async function onReviewText(msg: TgMessage) {
    reviewWaiting.delete(msg.from!.id)
    const { user } = await users.ensureUser({ tgId: msg.from!.id, username: msg.from!.username ?? null, fromBot: true })
    const mine = await reviews!.mine(user)
    if (!mine) return tg.send(msg.chat.id, 'Сначала поставьте оценку: /review')
    try {
      await reviews!.upsert(user, { rating: mine.rating, text: msg.text ?? '' }, 'bot')
      const v = await reviewView(msg.from!.id, msg.from!.username ?? null)
      await tg.send(msg.chat.id, `✅ Спасибо! Отзыв сохранён.\n\n${v.text}`, { keyboard: v.keyboard })
    } catch (err) {
      reviewWaiting.set(msg.from!.id, Date.now() + 10 * 60_000)
      await tg.send(msg.chat.id, `⚠️ ${err instanceof ReviewError ? esc(err.message) : 'Не получилось сохранить'}. Отправьте текст ещё раз.`)
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
      if (data.startsWith('rv:') && reviews) return onReviewCallback(cq, data)
      // Кнопки старых сообщений («Моя подписка», «Поддержка» и т.п.): всё теперь в приложении.
      if (data.startsWith('u:')) {
        if (data === 'u:support') {
          await tg.answerCallback(cq.id)
          return tg.send(chatId, SUPPORT_PROMPT)
        }
        return tg.answerCallback(cq.id, 'Подписка, оплата и подключение теперь в приложении: нажмите «Открыть LYNK».', true)
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
    if (command === '/support' || command === '/help') return tg.send(msg.chat.id, SUPPORT_PROMPT)
    if (command === '/review' && reviews) {
      reviewWaiting.delete(msg.from.id)
      const v = await reviewView(msg.from.id, msg.from.username ?? null)
      return tg.send(msg.chat.id, v.text, { keyboard: v.keyboard })
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
      // Фото / видео / GIF с подписью: текст в caption, разметка в caption_entities.
      const media = mediaOf(msg)
      await admin.onText({ chatId: msg.chat.id, tgId: msg.from.id, role }, media ? (msg.caption ?? '') : text, media ? msg.caption_entities : msg.entities, media)
      return
    }
    const waitUntil = reviewWaiting.get(msg.from.id)
    if (reviews && waitUntil && !command.startsWith('/')) {
      if (waitUntil > Date.now() && msg.text) return onReviewText(msg)
      reviewWaiting.delete(msg.from.id)
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
    // Меню команд: /start и /support (/sub убрана: всё в приложении).
    const userCommands = [
      { command: 'start', description: 'Открыть LYNK' },
      { command: 'support', description: 'Написать в поддержку' },
      ...(reviews ? [{ command: 'review', description: 'Оценить LYNK' }] : []),
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
