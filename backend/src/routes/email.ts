import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { rateLimit } from '@/plugins/rateLimit'

const hash = (code: string) => crypto.createHash('sha256').update(`lynk-email:${code}`).digest('hex')

/**
 * Привязка почты кодом из письма. Письма отправляются через Resend (HTTP API):
 * RESEND_API_KEY и EMAIL_FROM в Railway. Без ключа эндпоинт честно отвечает,
 * что почта пока не настроена.
 */
async function sendMail(env: NodeJS.ProcessEnv, to: string, code: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'LYNK <onboarding@resend.dev>',
      to: [to],
      subject: `Код подтверждения LYNK: ${code}`,
      html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;background:#050505;color:#e8e8ec;padding:32px;border-radius:16px;max-width:420px">
<div style="letter-spacing:.4em;font-weight:600;color:#a8a8b4">LYNK</div>
<h2 style="margin:20px 0 8px;color:#fff">Подтвердите почту</h2>
<p style="color:#9a9aa4">Введите этот код в приложении LYNK. Он действует 10 минут.</p>
<div style="font-size:34px;font-weight:700;letter-spacing:.35em;color:#fff;margin:22px 0">${code}</div>
<p style="color:#6a6a74;font-size:13px">Если вы не запрашивали код, просто проигнорируйте это письмо.</p></div>`,
      text: `Ваш код подтверждения LYNK: ${code}. Действует 10 минут.`,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Не удалось отправить письмо (${res.status}). ${body.slice(0, 160)}`)
  }
}

export function registerEmailRoutes(app: FastifyInstance, prisma: PrismaClient, env: NodeJS.ProcessEnv) {
  const me = (tgId: number) => prisma.user.findUniqueOrThrow({ where: { tgId: BigInt(tgId) } })

  app.post('/auth/email/start', { preHandler: [app.authenticate, rateLimit(3, 10 * 60_000, 'email')] }, async (request, reply) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(120) }).parse(request.body)
    if (!env.RESEND_API_KEY) return reply.code(503).send({ error: 'Привязка почты пока не настроена. Попробуйте позже.' })
    const user = await me(request.tgUser!.tgId)
    const taken = await prisma.user.findFirst({ where: { email, NOT: { id: user.id } } })
    if (taken) return reply.code(409).send({ error: 'Эта почта уже привязана к другому аккаунту' })

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    await prisma.emailCode.create({ data: { userId: user.id, email, codeHash: hash(code), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    try {
      await sendMail(env, email, code)
    } catch (err) {
      request.log.error({ err }, 'email send failed')
      return reply.code(502).send({ error: (err as Error).message })
    }
    return { ok: true }
  })

  app.post('/auth/email/verify', { preHandler: [app.authenticate, rateLimit(10, 10 * 60_000, 'email-verify')] }, async (request, reply) => {
    const { email, code } = z.object({ email: z.string().trim().toLowerCase().email(), code: z.string().regex(/^\d{6}$/) }).parse(request.body)
    const user = await me(request.tgUser!.tgId)
    const row = await prisma.emailCode.findFirst({ where: { userId: user.id, email, usedAt: null }, orderBy: { createdAt: 'desc' } })
    if (!row || row.expiresAt < new Date()) return reply.code(400).send({ error: 'Код устарел, запросите новый' })
    if (row.attempts >= 5) return reply.code(429).send({ error: 'Слишком много попыток, запросите новый код' })
    if (row.codeHash !== hash(code)) {
      await prisma.emailCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
      return reply.code(400).send({ error: 'Неверный код' })
    }
    await prisma.emailCode.update({ where: { id: row.id }, data: { usedAt: new Date() } })
    await prisma.user.update({ where: { id: user.id }, data: { email } })
    return { email }
  })
}
