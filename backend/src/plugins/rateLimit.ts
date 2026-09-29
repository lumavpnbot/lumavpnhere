import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Простой лимит запросов в памяти (ТЗ 9): 60 в минуту на пользователя,
 * 5 в минуту на создание платежей. Ключ: Telegram ID, если он известен, иначе IP.
 */
export function rateLimit(limit: number, windowMs = 60_000, bucket = 'default') {
  const hits = new Map<string, { count: number; resetAt: number }>()
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
  }, windowMs).unref()

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = `${bucket}:${request.tgUser?.tgId ?? request.ip}`
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return
    }
    entry.count++
    if (entry.count > limit) {
      reply.header('retry-after', Math.ceil((entry.resetAt - now) / 1000))
      return reply.code(429).send({ error: 'Слишком много запросов, попробуйте через минуту' })
    }
  }
}
