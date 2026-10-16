import type { PrismaClient } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import { broadcastMedia, segmentWhere } from '@/bot/admin'
import { sendPost } from '@/bot/welcome'
import { TgError, type Telegram } from '@/bot/tg'
import { recordError } from '@/lib/errors'
import type { AchievementService } from './achievements'
import type { BillingService } from './billing'
import type { NpdReceipts } from './npdReceipts'
import type { HalloweenService } from './halloween'
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
  halloween?: HalloweenService
}) {
  const { prisma, tg, billing, vpn, log, webAppUrl, status, achievements, receipts, halloween } = deps

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
    const media = broadcastMedia(bc)
    let delivered = 0
    let failed = 0
    let blocked = 0
    for (const u of users) {
      try {
        await sendPost(tg, u.tgId, bc.text, media, keyboard)
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

  /**
   * Пуши мероприятия: напоминание про колесо в 10:00 МСК, предупреждение за сутки
   * до закрытия приёма билетов и итоговое сообщение участникам. Что уже отправлено,
   * помним в настройках: перезапуск не рассылает повторно.
   */
  async function halloweenPings() {
    if (!halloween || !tg.enabled) return
    const c = await halloween.config()
    if (!c.enabled) return
    const now = new Date()
    const phase = halloween.phaseOf(c, now.getTime())
    const row = await prisma.setting.findUnique({ where: { key: 'halloweenPings' } })
    const sent = (row?.value as { daily?: string; closing?: boolean; thanks?: boolean } | undefined) ?? {}
    const mskHour = (now.getUTCHours() + 3) % 24
    const today = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const save = async (patch: Record<string, unknown>) => {
      const value = { ...sent, ...patch }
      await prisma.setting.upsert({ where: { key: 'halloweenPings' }, create: { key: 'halloweenPings', value }, update: { value } })
    }
    const keyboard = [[{ text: '🎃 Открыть розыгрыш', web_app: { url: webAppUrl } }]]
    const blast = async (tgIds: bigint[], text: string) => {
      for (const tgId of tgIds) {
        await tg.send(tgId, text, { keyboard }).catch(() => undefined)
        await sleep(40)
      }
      return tgIds.length
    }

    if (phase === 'live' && c.wheel.enabled && mskHour === 10 && sent.daily !== today) {
      await save({ daily: today })
      // Только тем, у кого есть платная подписка: колесо доступно именно им.
      const subs = await prisma.subscription.findMany({
        where: { status: 'active', expiresAt: { gt: new Date(now.getTime() + c.wheel.minSubDays * DAY) } },
        distinct: ['userId'],
        select: { userId: true, user: { select: { tgId: true, botStarted: true, banned: true } } },
      })
      const skip = await halloween.spinnersToday()
      const ids = subs.filter((x) => x.user.botStarted && !x.user.banned && !skip.has(String(x.userId))).map((x) => x.user.tgId)
      log.info({ sent: await blast(ids, '🎃 <b>Колесо фортуны ждёт</b>\nСегодняшний спин ещё не использован: крутите и забирайте билеты в розыгрыш AirPods.') }, 'halloween daily push')
      return
    }

    const closeAt = Date.parse(c.ticketsUntil)
    if (phase === 'live' && !sent.closing && closeAt - now.getTime() < DAY) {
      await save({ closing: true })
      const players = await prisma.halloweenTicket.findMany({ where: { revokedAt: null }, distinct: ['userId'], select: { userId: true, user: { select: { tgId: true, botStarted: true } } } })
      await blast(players.filter((p) => p.user.botStarted).map((p) => p.user.tgId), '⏳ <b>Сутки до закрытия приёма билетов</b>\nУспейте позвать друзей и крутнуть колесо: после 31 октября 23:59 МСК билеты не начисляются.')
      return
    }

    if ((phase === 'closed' || phase === 'off') && sent.closing && !sent.thanks) {
      await save({ thanks: true })
      const players = await prisma.halloweenTicket.findMany({ where: { revokedAt: null }, distinct: ['userId'], select: { userId: true, user: { select: { tgId: true, botStarted: true } } } })
      await blast(players.filter((p) => p.user.botStarted).map((p) => p.user.tgId), '🎃 <b>Спасибо за участие</b>\nПриём билетов закрыт. Результаты розыгрыша опубликуем в канале, победителям напишем в боте.')
    }
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
      await step('addons', () => vpn.expireAddons())
      await step('holds', () => billing.releaseHolds())
      await step('autorenew', () => billing.autoRenewFromBalance())
      await step('activations', () => billing.retryFailedActivations())
      if (receipts) await step('receipts', () => receipts.retryMissing())
      await step('remind', remind)
      if (halloween) await step('halloween', halloweenPings)
    }
    setInterval(safe('ten-minutes', every10), 10 * 60 * 1000)
    setInterval(safe('broadcasts', dueBroadcasts), 60 * 1000)
    // Доступ, который панель не приняла (пробный период, оплата, продление): повтор раз в 2 минуты.
    let repairing = false
    setInterval(
      safe('panel-repair', async () => {
        if (repairing) return
        repairing = true
        try {
          const r = await vpn.repairPending()
          if (r.pending) log.info({ result: r }, 'panel repair')
        } finally {
          repairing = false
        }
      }),
      2 * 60 * 1000,
    )
    setTimeout(safe('startup', every10), 30 * 1000)
    // Статус сервиса: проверка узлов раз в минуту, чистка истории раз в час (ТЗ 02).
    if (status && process.env.STATUS_MONITOR !== '0') {
      setInterval(safe('status', () => status.tick()), 60 * 1000)
      setTimeout(safe('status-first', () => status.tick()), 5 * 1000)
      setInterval(safe('status-cleanup', () => status.cleanup()), 60 * 60 * 1000)
    }
    if (achievements) setInterval(safe('achievements', achievementsSweep), 6 * 60 * 60 * 1000)
    // После перезапуска сверяем клиентов на панелях и чиним только расхождения (нет клиента,
    // выключен, срок меньше). Раньше каждый деплой перезаписывал всех клиентов на всех панелях,
    // а каждая запись перезагружает сервер H1 и рвёт соединения. Новые инбаунды всем раздаёт
    // кнопка «Обновить клиентов на панелях» в /admin (или SYNC_ON_START=full).
    if (process.env.SYNC_ON_START !== '0') {
      const full = process.env.SYNC_ON_START === 'full'
      setTimeout(
        safe('panel-sync', async () => log.info({ result: await vpn.syncAll({ onlyDrift: !full }) }, 'panel sync done')),
        60 * 1000,
      )
    }
  }

  return { start, sendBroadcast, achievementsSweep }
}
