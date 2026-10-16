import type { FastifyInstance } from 'fastify'
import { rateLimit } from '@/plugins/rateLimit'
import type { HalloweenService } from '@/services/halloween'
import type { UserService } from '@/services/users'

/** Хэллоуин-розыгрыш (раздел 08 ТЗ): билеты, колесо фортуны, призы, результаты. */
export function registerHalloweenRoutes(app: FastifyInstance, deps: { halloween: HalloweenService; users: UserService }) {
  const { halloween, users } = deps
  const auth = { preHandler: [app.authenticate, rateLimit(60, 60_000, 'api')] }
  const me = async (tgId: number, username: string | null) => (await users.ensureUser({ tgId, username })).user
  const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null

  app.get('/api/halloween/tickets', auth, async (request) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    return halloween.summary(user)
  })

  app.get('/api/halloween/tickets/history', auth, async (request) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    return { history: await halloween.history(user.id) }
  })

  app.get('/api/halloween/stats', auth, async () => halloween.stats())

  app.get('/api/halloween/wheel/status', auth, async (request) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    return halloween.wheelStatus(user)
  })

  /** Один спин в сутки: лимит на уровне БД, IP и устройство пишем для антифрода. */
  app.post('/api/halloween/wheel/spin', { preHandler: [app.authenticate, rateLimit(10, 60_000, 'wheel')] }, async (request, reply) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    if (user.banned) return reply.code(403).send({ error: 'Доступ ограничен' })
    const result = await halloween.spin(user, request.ip || null, header(request.headers['user-agent']))
    if (!result.ok) return reply.code(409).send({ error: 'Спин сейчас недоступен', ...result })
    return result
  })

  app.get('/api/halloween/wheel/history', auth, async (request) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    return { spins: await halloween.wheelHistory(user.id) }
  })

  app.get('/api/halloween/prizes', auth, async () => halloween.prizes())

  app.get('/api/halloween/winners', auth, async () => halloween.winners())

  /** Статус мероприятия: до старта, приём билетов, закрыт, результаты опубликованы. */
  app.get('/api/halloween/draw/status', auth, async () => {
    const [config, phase, stats] = await Promise.all([halloween.config(), halloween.phase(), halloween.stats()])
    return {
      phase,
      startAt: config.startAt,
      ticketsUntil: config.ticketsUntil,
      drawAt: config.drawAt,
      pool: stats.tickets,
      participants: stats.participants,
    }
  })

  app.get('/api/halloween/draw/results', auth, async () => halloween.winners())
}
