import type { PrismaClient } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import { segmentWhere } from '@/bot/admin'
import { TgError, type Telegram } from '@/bot/tg'
import { recordError } from '@/lib/errors'
import type { AchievementService } from './achievements'
import type { BillingService } from './billing'
import type { NpdReceipts } from './npdReceipts'
import type { StatusService } from './status'
import type { VpnService } from './vpn'

const DAY = 24 * 60 * 60 * 1000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Фоновые задачи: истечение подписок, снятие холда, напоминания,
 * автопродление с баланса, отложенные рассылки.
 */
export function createJobs(deps: {
  prisma: PrismaClient
  tg: Telegram
  billing: BillingService
  vpn: VpnService
  log: FastifyBaseLogger
  webAppUrl: string
  status?: StatusService
  achievements?: AchievementService
  receipts?: NpdReceipts
}) {
  const { prisma, tg, billing, vpn, log, webAppUrl, status, achievements, receipts } = deps

  /** Достижения за лояльность (6/12/24 месяца) наступают со временем: проверяем всех, кто платил. */
  async function achievementsSweep() {
    if (!achievements) return 0
    const payers = await prisma.payment.findMany({ where: { status: 'paid' }, distinct: ['userId'], select: { userId: true } })
    let unlocked = 0
    for (const p of payers) {
      unlocked += (await achievements.evaluateById(p.userId).catch(() => [])).length
    }
    return unlocked
  }
  const openApp = [[{ text: 'Открыть LYNK', web_app: { url: webAppUrl } }]]

  async function remind() {
    if (!tg.enabled) return
    const now = Date.now()
    // Trial: за 2 дня до конца. Платная: за 3 дня (ТЗ, раздел 4).
    const due = await prisma.subscription.findMany({
      where: {
        remindedAt: null,
        OR: [
          { status: 'trial', expiresAt: { gt: new Date(now), lte: new Date(now + 2 * DAY) } },
          { status: 'active', expiresAt: { gt: new Date(now), lte: new Date(now + 3 * DAY) } },
        ],
      },
      include: { user: true },
    })
    for (const sub of due) {
      // Есть ли более поздняя подписка (уже продлили)? Тогда не напоминаем.
      // Строки с тем же сроком (старая смена тарифа) не дублируют напоминание: пишем только по последней.
      const later = await prisma.subscription.count({
        where: { userId: sub.userId, OR: [{ expiresAt: { gt: sub.expiresAt } }, { expiresAt: sub.expiresAt, id: { gt: sub.id } }] },
      })
      await prisma.subscription.update({ where: { id: sub.id }, data: { remindedAt: new Date() } })
      if (later || !sub.user.botStarted) continue
      const days = Math.max(1, Math.ceil((sub.expiresAt.getTime() - now) / DAY))
      const text =
        sub.status === 'trial'
          ? `⏳ Пробный период закончится через <b>${days} дн</b>. Оформите подписку, чтобы соединение не прервалось.`
          : sub.autoRenew
            ? `⏳ Подписка закончится через <b>${days} дн</b>. Автопродление включено: спишем с баланса, если хватит средств.`
            : `⏳ Подписка закончится через <b>${days} дн</b>. Продлите её в приложении, это займёт минуту.`
      await tg.send(sub.user.tgId, text, { keyboard: openApp }).catch(() => undefined)
    }
  }

  async function sendBroadcast(id: bigint) {
    const claimed = await prisma.broadcast.updateMany({ where: { id, status: 'scheduled' }, data: { status: 'sending' } })
    if (!claimed.count) return
    const bc = await prisma.broadcast.findUniqueOrThrow({ where: { id } })
    const users = await prisma.user.findMany({ where: segmentWhere(bc.segment), select: { tgId: true } })
    const keyboard = bc.buttonText && bc.buttonUrl ? [[{ text: bc.buttonText, url: bc.buttonUrl }]] : undefined
    let delivered = 0
    let failed = 0
    let blocked = 0
    for (const u of users) {
      try {
        await tg.send(u.tgId, bc.text, { keyboard })
        delivered++
      } catch (e) {
        if (e instanceof TgError && e.code === 403) {
          blocked++
          await prisma.user.update({ where: { tgId: u.tgId }, data: { botStarted: false } }).catch(() => undefined)
        } else failed++
      }
      await sleep(40) // ~25 сообщений в секунду, в пределах лимитов Telegram
    }
    await prisma.broadcast.update({ where: { id }, data: { status: 'sent', delivered, failed, blocked } })
    const author = bc.createdByTgId
    await tg.send(author, `📢 Рассылка #${id} завершена: доставлено <b>${delivered}</b>, ошибок ${failed}, заблокировали бота ${blocked}.`).catch(() => undefined)
  }

  async function dueBroadcasts() {
    const due = await prisma.broadcast.findMany({ where: { status: 'scheduled', scheduledAt: { lte: new Date() } } })
    for (const bc of due) await sendBroadcast(bc.id)
  }

  const safe = (name: string, fn: () => Promise<unknown>) => () =>
    fn().catch((err) => {
      recordError(`job:${name}`, err)
      log.error({ err }, `job ${name} failed`)
    })

  function start() {
    // Шаги независимы: ошибка в одном (например, панель недоступна) не должна отменять остальные.
    const step = (name: string, fn: () => Promise<unknown>) =>
      fn().catch((err) => {
        recordError(`job:${name}`, err)
        log.error({ err }, `job ${name} failed`)
      })
    const every10 = async () => {
      await step('expire', () => vpn.expireOverdue())
      await step('holds', () => billing.releaseHolds())
      await step('autorenew', () => billing.autoRenewFromBalance())
      await step('activations', () => billing.retryFailedActivations())
      if (receipts) await step('receipts', () => receipts.retryMissing())
      await step('remind', remind)
    }
    setInterval(safe('ten-minutes', every10), 10 * 60 * 1000)
    setInterval(safe('broadcasts', dueBroadcasts), 60 * 1000)
    setTimeout(safe('startup', every10), 30 * 1000)
    // Статус сервиса: проверка узлов раз в минуту, чистка истории раз в час (ТЗ 02).
    if (status && process.env.STATUS_MONITOR !== '0') {
      setInterval(safe('status', () => status.tick()), 60 * 1000)
      setTimeout(safe('status-first', () => status.tick()), 5 * 1000)
      setInterval(safe('status-cleanup', () => status.cleanup()), 60 * 60 * 1000)
    }
    if (achievements) setInterval(safe('achievements', achievementsSweep), 6 * 60 * 60 * 1000)
    // После перезапуска (например, добавили инбаунд в H1_PANELS) обновляем клиентов на панелях.
    if (process.env.SYNC_ON_START !== '0') {
      setTimeout(
        safe('panel-sync', async () => log.info({ result: await vpn.syncAll() }, 'panel sync done')),
        60 * 1000,
      )
    }
  }

  return { start, sendBroadcast, achievementsSweep }
}
