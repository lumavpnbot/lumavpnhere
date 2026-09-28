import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { PanelProvider } from '@/panel'

const BRAND = 'LynkVPN'

// Заголовки подписки, которые понимают Happ / Hiddify / v2rayTun: трафик и срок, интервал обновления.
const PASS_HEADERS = ['content-type', 'subscription-userinfo', 'profile-update-interval', 'announce']

/**
 * Публичная ссылка подписки: https://<наш домен>/sub/<subToken>.
 *
 * Зачем прокси, а не ссылка панели:
 *  - панель H1 отдаёт подписку по http://, Happ такие ссылки отклоняет;
 *  - пользователь не видит провайдера серверов;
 *  - при смене провайдера или добавлении страны ссылка у пользователя та же.
 */
export function registerSubscriptionRoutes(app: FastifyInstance, prisma: PrismaClient, panel: PanelProvider, env: NodeJS.ProcessEnv) {
  app.get('/sub/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const user = await prisma.user.findUnique({ where: { subToken: token } })
    if (!user) return reply.code(404).send('not found')

    const client = await panel.getClient(Number(user.tgId))
    if (!client?.enabled || !client.upstreamSubscriptionUrl) return reply.code(404).send('no active subscription')

    const upstream = await fetch(client.upstreamSubscriptionUrl, {
      headers: { 'User-Agent': request.headers['user-agent'] ?? 'LynkVPN' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!upstream.ok) return reply.code(502).send('upstream error')

    for (const h of PASS_HEADERS) {
      const v = upstream.headers.get(h)
      if (v) reply.header(h, v)
    }
    reply.header('profile-title', `base64:${Buffer.from(BRAND).toString('base64')}`)
    if (env.SUPPORT_URL) reply.header('support-url', env.SUPPORT_URL)
    if (env.PUBLIC_URL) reply.header('profile-web-page-url', env.PUBLIC_URL)
    reply.header('cache-control', 'no-store')

    return reply.send(Buffer.from(await upstream.arrayBuffer()))
  })
}

export function subscriptionUrl(env: NodeJS.ProcessEnv, subToken: string) {
  const base = (env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/sub/${subToken}` : null
}
