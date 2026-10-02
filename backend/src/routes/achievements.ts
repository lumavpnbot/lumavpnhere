import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Telegram } from '@/bot/tg'
import { rateLimit } from '@/plugins/rateLimit'
import type { AchievementService } from '@/services/achievements'
import type { UserService } from '@/services/users'

/** ТЗ v6.3 · 04: достижения, награды, шоукейс. */
export function registerAchievementRoutes(
  app: FastifyInstance,
  deps: { achievements: AchievementService; users: UserService; tg: Telegram; env: NodeJS.ProcessEnv },
) {
  const { achievements, users, tg, env } = deps
  const auth = { preHandler: [app.authenticate, rateLimit(60, 60_000, 'api')] }
  const botUsername = (env.BOT_USERNAME || 'lynkorobot').replace(/^@/, '')
  const me = async (tgId: number, username: string | null) => (await users.ensureUser({ tgId, username })).user
  const langOf = (q: unknown) => ((q as { lang?: string })?.lang === 'en' ? 'en' : 'ru') as 'ru' | 'en'
  // Подготовленные сообщения для «Поделиться» (Telegram shareMessage): кто и когда запросил.
  const prepared = new Map<string, { userId: bigint; at: number }>()

  app.get('/api/achievements', auth, async (request) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    await achievements.evaluate(user).catch((err) => request.log.warn({ err }, 'achievements evaluate failed'))
    const lang = langOf(request.query)
    const list = await achievements.list(user, lang)
    return {
      achievements: list,
      showcase: await achievements.showcase(user, lang),
      unlocked: list.filter((a) => a.unlocked).length,
      total: list.length,
    }
  })

  app.get('/api/achievements/rewards', auth, async (request) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    return achievements.rewardsSummary(user)
  })

  /** «Применить к следующему платежу»: включить или отложить разовую скидку. */
  app.post('/api/achievements/rewards/apply', auth, async (request, reply) => {
    const { rewardId, enabled } = z.object({ rewardId: z.string().regex(/^\d+$/), enabled: z.boolean() }).parse(request.body)
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    if (!(await achievements.setApplyNext(user, BigInt(rewardId), enabled))) return reply.code(404).send({ error: 'Скидка не найдена' })
    return achievements.rewardsSummary(user)
  })

  app.get('/api/achievements/showcase', auth, async (request) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    return { showcase: await achievements.showcase(user, langOf(request.query)) }
  })

  app.post('/api/achievements/showcase', auth, async (request) => {
    const { codes } = z.object({ codes: z.array(z.string().max(40)).max(3) }).parse(request.body)
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    return { showcase: await achievements.setShowcase(user, codes) }
  })

  /**
   * «Шеринг»: бот готовит сообщение с реферальной ссылкой (savePreparedInlineMessage, Bot API 8.0),
   * Mini App открывает нативное окно «Поделиться», и только если сообщение отправлено, засчитываем бейдж.
   */
  app.post('/api/achievements/share/prepare', { preHandler: [app.authenticate, rateLimit(10, 60_000, 'share')] }, async (request, reply) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    if (!user.refCode) return reply.code(400).send({ error: 'Реферальная ссылка ещё не готова' })
    const link = `https://t.me/${botUsername}?start=REF_${user.refCode}`
    try {
      const res = await tg.call<{ id: string }>('savePreparedInlineMessage', {
        user_id: Number(user.tgId),
        result: {
          type: 'article',
          id: crypto.randomBytes(8).toString('hex'),
          title: 'LYNK: быстрый и защищённый сервис в Telegram',
          description: 'Пробный период по моей ссылке длиннее',
          input_message_content: { message_text: `Пользуюсь LYNK: быстрый и защищённый сервис прямо в Telegram. По моей ссылке пробный период длиннее 👇\n${link}` },
          reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть LYNK', url: link }]] },
        },
        allow_user_chats: true,
        allow_group_chats: true,
        allow_channel_chats: true,
      })
      prepared.set(res.id, { userId: user.id, at: Date.now() })
      return { id: res.id, link }
    } catch (err) {
      request.log.warn({ err }, 'savePreparedInlineMessage failed')
      return { id: null, link }
    }
  })

  app.post('/api/achievements/share', { preHandler: [app.authenticate, rateLimit(10, 60_000, 'share')] }, async (request, reply) => {
    const { preparedId } = z.object({ preparedId: z.string().min(1).max(128) }).parse(request.body)
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    const p = prepared.get(preparedId)
    if (!p || p.userId !== user.id || Date.now() - p.at > 3600_000) return reply.code(400).send({ error: 'Сообщение для отправки не найдено' })
    prepared.delete(preparedId)
    const unlocked = await achievements.unlock(user, 'sharing')
    return { unlocked }
  })

  /** Отзыв о сервисе: уходит в поддержку и даёт бейдж «Обратная связь». */
  app.post('/api/achievements/feedback', { preHandler: [app.authenticate, rateLimit(3, 10 * 60_000, 'feedback')] }, async (request) => {
    const { rating, text } = z.object({ rating: z.number().int().min(1).max(5), text: z.string().trim().min(30).max(2000) }).parse(request.body)
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    return achievements.leaveFeedback(user, rating, text)
  })
}
