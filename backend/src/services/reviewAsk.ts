import type { PrismaClient } from '@prisma/client'
import type { Telegram } from '@/bot/tg'
import { recordError } from '@/lib/errors'
import type { ReviewService } from './reviews'
import type { SettingsService } from './settings'

const DAY = 24 * 60 * 60 * 1000
/** Сколько человек спрашиваем за один проход (раз в 10 минут), чтобы не упереться в лимиты Telegram. */
const BATCH = 30

/**
 * Просьба оценить сервис: одно сообщение в боте с кнопкой «Оценить», которая открывает
 * выбор звёзд в Mini App (?screen=review). Каждому аккаунту один раз и только тем, кто
 * реально пользуется сервисом: через 3 дня после подключения первого устройства или
 * через день после первой оплаты. Кто уже оставил отзыв, сообщение не получает.
 * Пишем днём (11:00–21:00 по Москве). Выключается в /admin → ⭐ Отзывы.
 */
export function createReviewAsk(deps: { prisma: PrismaClient; tg: Telegram; settings: SettingsService; reviews: ReviewService; webAppUrl: string }) {
  const { prisma, tg, settings, reviews } = deps

  const rateUrl = (() => {
    const u = new URL(deps.webAppUrl)
    u.searchParams.set('screen', 'review')
    u.hash = ''
    return u.toString()
  })()

  async function tick(now = new Date()) {
    if (!tg.enabled || !(await settings.get()).reviewAskEnabled) return 0
    const mskHour = (now.getUTCHours() + 3) % 24
    if (mskHour < 11 || mskHour >= 21) return 0

    const users = await prisma.user.findMany({
      where: {
        reviewAskedAt: null,
        banned: false,
        botStarted: true,
        review: null,
        OR: [
          { devices: { some: { createdAt: { lte: new Date(now.getTime() - 3 * DAY) } } } },
          { payments: { some: { status: 'paid', paidAt: { lte: new Date(now.getTime() - DAY) } } } },
        ],
      },
      orderBy: { id: 'asc' },
      take: BATCH,
    })

    let sent = 0
    for (const user of users) {
      // Помечаем до отправки: даже если сообщение не дойдёт (бот заблокирован), второй раз не пишем.
      const claimed = await prisma.user.updateMany({ where: { id: user.id, reviewAskedAt: null }, data: { reviewAskedAt: now } })
      if (!claimed.count) continue
      if (!(await reviews.eligibility(user)).ok) continue
      try {
        await tg.send(
          user.tgId,
          '⭐ <b>Как вам LYNK?</b>\n\nОцените сервис звёздами, это займёт пару секунд. Текст по желанию: расскажите, что нравится или что улучшить.',
          { keyboard: [[{ text: '⭐ Оценить', web_app: { url: rateUrl } }]] },
        )
        sent++
      } catch (err) {
        recordError('review ask', err)
      }
      await new Promise((r) => setTimeout(r, 60))
    }
    return sent
  }

  return { tick, rateUrl }
}

export type ReviewAsk = ReturnType<typeof createReviewAsk>
