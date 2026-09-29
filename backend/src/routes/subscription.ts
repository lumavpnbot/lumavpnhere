import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { PanelProvider } from '@/panel'

const BRAND = 'LYNK'

// Заголовки подписки, которые понимают Happ / Hiddify / v2rayTun: трафик и срок, интервал обновления.
const PASS_HEADERS = ['content-type', 'subscription-userinfo', 'profile-update-interval', 'announce']

// Чтобы склеить несколько стран, просим у панелей простой список ссылок (как для v2rayNG).
const PLAIN_UA = 'v2rayNG/1.9.0'

function decodeList(body: string): string[] {
  const text = body.trim()
  const raw = /^[A-Za-z0-9+/=\s_-]+$/.test(text) && !text.includes('://') ? Buffer.from(text, 'base64').toString('utf8') : text
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[a-z0-9]+:\/\//i.test(l))
}

/**
 * Публичная ссылка подписки: https://<наш домен>/sub/<subToken>.
 *
 * Зачем прокси, а не ссылка панели:
 *  - панель H1 отдаёт подписку по http://, Happ такие ссылки отклоняет;
 *  - пользователь не видит провайдера серверов;
 *  - все страны (отдельные панели) собираются в одну подписку;
 *  - при смене провайдера или добавлении страны ссылка у пользователя та же.
 */
export function registerSubscriptionRoutes(app: FastifyInstance, prisma: PrismaClient, panel: PanelProvider, env: NodeJS.ProcessEnv) {
  app.get('/sub/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const user = await prisma.user.findUnique({ where: { subToken: token } })
    if (!user) return reply.code(404).send('not found')

    const client = await panel.getClient(Number(user.tgId))
    const urls = client?.enabled ? client.upstreamSubscriptionUrls : []
    if (!urls.length) return reply.code(404).send('no active subscription')

    const ua = request.headers['user-agent'] ?? BRAND
    const single = urls.length === 1

    const responses = await Promise.allSettled(
      urls.map((u) =>
        fetch(u, { headers: { 'User-Agent': single ? ua : PLAIN_UA }, signal: AbortSignal.timeout(10_000) }).then(async (r) => {
          if (!r.ok) throw new Error(`upstream ${r.status}`)
          return { headers: r.headers, body: Buffer.from(await r.arrayBuffer()) }
        }),
      ),
    )
    const ok = responses.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    if (!ok.length) return reply.code(502).send('upstream error')

    for (const h of PASS_HEADERS) {
      const v = ok[0].headers.get(h)
      if (v && (single || h !== 'content-type')) reply.header(h, v)
    }
    reply.header('profile-title', `base64:${Buffer.from(BRAND).toString('base64')}`)
    if (env.SUPPORT_URL) reply.header('support-url', env.SUPPORT_URL)
    reply.header('cache-control', 'no-store')

    // Одна страна: отдаём как есть (сохраняются все возможности панели, например автовыбор).
    if (single) return reply.send(ok[0].body)

    // Несколько стран: склеиваем списки ссылок.
    // Панели H1 в одном аккаунте связаны: подписка одной уже может содержать
    // другие страны. Убираем повторы по ссылке без названия (#…).
    const seen = new Set<string>()
    const links = ok
      .flatMap((r) => decodeList(r.body.toString('utf8')))
      .filter((l) => {
        const key = l.split('#')[0]
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    reply.header('content-type', 'text/plain; charset=utf-8')
    return reply.send(Buffer.from(links.join('\n')).toString('base64'))
  })

  /**
   * Кнопка «Открыть в Happ». Telegram на iOS не открывает из Mini App свои схемы
   * вроде happ://, поэтому Mini App открывает эту https-страницу во внешнем
   * браузере, а она уже переходит в happ://add/<ссылка подписки>.
   */
  app.get('/open/happ/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const url = subscriptionUrl(env, token)
    if (!url) return reply.code(500).send('PUBLIC_URL is not set')
    const deeplink = `happ://add/${url}`
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    reply.header('content-type', 'text/html; charset=utf-8')
    return reply.send(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LYNK</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050506;color:#f4f4f6;font:16px/1.5 -apple-system,BlinkMacSystemFont,Inter,sans-serif}
main{max-width:360px;padding:24px;text-align:center}
a.btn{display:block;margin-top:20px;padding:15px;border-radius:999px;background:rgba(255,255,255,.18);color:#fff;text-decoration:none;font-weight:600}
p{color:#a1a1aa}
</style></head><body><main>
<h2>Открываем Happ…</h2>
<p>Если приложение не открылось само, нажмите кнопку. Happ должен быть установлен.</p>
<a class="btn" href="${esc(deeplink)}">Открыть в Happ</a>
</main><script>location.href=${JSON.stringify(deeplink)}</script></body></html>`)
  })
}

export function subscriptionUrl(env: NodeJS.ProcessEnv, subToken: string) {
  const base = (env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/sub/${subToken}` : null
}

export function happOpenUrl(env: NodeJS.ProcessEnv, subToken: string) {
  const base = (env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/open/happ/${subToken}` : null
}
