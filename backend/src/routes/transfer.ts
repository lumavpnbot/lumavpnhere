import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { rateLimit } from '@/plugins/rateLimit'
import type { SettingsService } from '@/services/settings'
import type { TransferService } from '@/services/transfer'
import type { UserService } from '@/services/users'

const linkSchema = z.object({ link: z.string().trim().min(8).max(4096) })

/** ТЗ v6.3 · 04: перенос подписок. */
export function registerTransferRoutes(
  app: FastifyInstance,
  deps: { prisma: PrismaClient; transfer: TransferService; settings: SettingsService; users: UserService },
) {
  const { prisma, transfer, settings, users } = deps
  const me = async (tgId: number, username: string | null) => (await users.ensureUser({ tgId, username })).user
  const ctxOf = (req: { ip: string; headers: Record<string, string | string[] | undefined> }) => ({
    ip: req.ip || null,
    userAgent: (Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent']) ?? null,
  })

  /** Проверить ссылку (без заявки): что получилось бы при подаче. */
  app.post('/api/transfer/check', { preHandler: [app.authenticate, rateLimit(6, 60_000, 'transfer-check')] }, async (request, reply) => {
    const { link } = linkSchema.parse(request.body)
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    if (user.banned) return reply.code(403).send({ error: 'Доступ ограничен' })
    const r = await transfer.runChecks(user, link, ctxOf(request))
    return {
      verdict: r.verdict,
      checks: r.checks,
      linkType: r.parsed?.type ?? null,
      provider: r.provider,
      days: r.creditDays,
      rawDays: r.days,
      expireAt: r.expireAt?.toISOString() ?? null,
      configsCount: r.configsCount,
      httpStatus: r.httpStatus,
      responseMs: r.responseMs,
    }
  })

  /** Подать заявку: 14 проверок, автопометка, начисление или модерация. */
  app.post('/api/transfer/submit', { preHandler: [app.authenticate, rateLimit(3, 60_000, 'transfer-submit')] }, async (request, reply) => {
    const { link } = linkSchema.parse(request.body)
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    if (user.banned) return reply.code(403).send({ error: 'Доступ ограничен' })
    const t = await transfer.submit(user, link, ctxOf(request))
    return { request: transfer.publicView(t) }
  })

  /** Статус последней заявки и правила переноса. */
  app.get('/api/transfer/status', { preHandler: [app.authenticate, rateLimit(60, 60_000, 'api')] }, async (request) => {
    const s = await settings.get()
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    const last = await transfer.latestFor(user.id)
    return {
      request: last ? transfer.publicView(last) : null,
      rules: { minAccountDays: s.transferMinAccountDays, minDays: s.transferMinDays, maxDays: s.transferMaxDays },
      accountAgeDays: Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000),
    }
  })

  /** Провайдеры из белого списка (для подсказки в Mini App). */
  app.get('/api/transfer/providers', async () => {
    const rows = await prisma.transferProvider.findMany({ where: { list: 'white' }, orderBy: { domain: 'asc' } })
    return { providers: rows.map((r) => ({ domain: r.domain, name: r.name })) }
  })
}
