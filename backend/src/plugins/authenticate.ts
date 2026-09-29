import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { verifyTelegramInitDataAny } from '@/lib/telegramAuth'

declare module 'fastify' {
  interface FastifyRequest {
    tgUser?: { tgId: number; username: string | null; startParam: string | null }
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

/**
 * Достаёт X-Telegram-Init-Data из заголовка, проверяет подпись и кладёт
 * распознанного пользователя в request.tgUser. Роуты, которым нужна
 * авторизация, вызывают request.server.authenticate как preHandler.
 */
export function registerAuth(app: FastifyInstance, botTokens: string[]) {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const initData = request.headers['x-telegram-init-data']
    if (typeof initData !== 'string') {
      return reply.code(401).send({ error: 'Отсутствует X-Telegram-Init-Data' })
    }

    const verified = verifyTelegramInitDataAny(initData, botTokens)
    if (!verified) {
      return reply.code(401).send({ error: 'Невалидная подпись initData' })
    }

    request.tgUser = { tgId: verified.tgId, username: verified.username, startParam: verified.startParam }
  })
}
