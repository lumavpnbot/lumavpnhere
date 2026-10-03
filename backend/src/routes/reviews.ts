import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { rateLimit } from '@/plugins/rateLimit'
import { ReviewError, type ReviewService } from '@/services/reviews'
import type { UserService } from '@/services/users'

/** Отзывы и рейтинг: GET сводка и список, PUT/DELETE свой отзыв (один на аккаунт). */
export function registerReviewRoutes(app: FastifyInstance, deps: { reviews: ReviewService; users: UserService }) {
  const { reviews, users } = deps
  const read = { preHandler: [app.authenticate, rateLimit(60, 60_000, 'api')] }
  const write = { preHandler: [app.authenticate, rateLimit(6, 60_000, 'review')] }
  const me = async (tgId: number, username: string | null) => (await users.ensureUser({ tgId, username })).user

  app.get('/reviews/summary', read, async (request) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    const [summary, mine, eligible, latest] = await Promise.all([
      reviews.summary(),
      reviews.mine(user),
      reviews.eligibility(user),
      reviews.list({ withText: true, limit: 3 }),
    ])
    return {
      summary,
      latest: latest.items,
      mine: mine && { rating: mine.rating, text: mine.text, hidden: mine.hidden, at: mine.updatedAt.toISOString() },
      eligible,
    }
  })

  app.get('/reviews', read, async (request) => {
    const q = z
      .object({ stars: z.coerce.number().int().min(1).max(5).optional(), text: z.enum(['1']).optional(), cursor: z.string().regex(/^\d+$/).optional() })
      .parse(request.query)
    return reviews.list({ stars: q.stars, withText: q.text === '1', cursor: q.cursor })
  })

  app.put('/reviews/me', write, async (request, reply) => {
    const body = z.object({ rating: z.number().int().min(1).max(5), text: z.string().max(2000).nullable().optional() }).parse(request.body)
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    try {
      const r = await reviews.upsert(user, { rating: body.rating, text: body.text ?? null }, 'app')
      return { rating: r.rating, text: r.text, hidden: r.hidden, at: r.updatedAt.toISOString() }
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(400).send({ error: err.message })
      throw err
    }
  })

  app.delete('/reviews/me', write, async (request) => {
    const user = await me(request.tgUser!.tgId, request.tgUser!.username)
    await reviews.remove(user)
    return { ok: true }
  })
}
