import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { recordError } from '@/lib/errors'
import { rateLimit } from '@/plugins/rateLimit'

const hash = (code: string) => crypto.createHash('sha256').update(`lynk-email:${code}`).digest('hex')

/**
 * Привязка почты кодом из письма. Письма отправляются через Resend (HTTP API):
 * RESEND_API_KEY и EMAIL_FROM в Railway. Без ключа эндпоинт честно отвечает,
 * что почта пока не настроена.
 */
/** Письмо с кодом: таблицы и инлайн-стили, чтобы одинаково выглядело в Gmail, Яндексе, Mail.ru и Outlook. */
function codeEmail(code: string) {
  const digits = code
    .split('')
    .map(
      (d) =>
        `<td style="width:44px;height:56px;background:#17171c;border:1px solid #2a2a33;border-radius:12px;font:700 28px/56px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#ffffff;text-align:center">${d}</td><td style="width:6px"></td>`,
    )
    .join('')
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Код LYNK</title></head>
<body style="margin:0;padding:0;background:#050506">
<div style="display:none;max-height:0;overflow:hidden">Ваш код: ${code}. Действует 10 минут.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050506"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#0d0d11;border:1px solid #1f1f26;border-radius:24px">
<tr><td style="padding:32px 32px 0;font:600 13px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.45em;color:#a8a8b4">LYNK</td></tr>
<tr><td style="padding:24px 32px 0;font:700 24px/1.25 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#ffffff">Подтвердите почту</td></tr>
<tr><td style="padding:10px 32px 0;font:400 15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9a9aa6">Введите этот код в приложении LYNK, чтобы привязать почту к аккаунту.</td></tr>
<tr><td style="padding:26px 32px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table></td></tr>
<tr><td style="padding:14px 32px 0;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6e6e7a">Код действует 10 минут.</td></tr>
<tr><td style="padding:26px 32px 0"><div style="height:1px;background:#1f1f26"></div></td></tr>
<tr><td style="padding:18px 32px 32px;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#5e5e6a">Если вы не запрашивали код, просто проигнорируйте письмо: без кода почту привязать нельзя. Никому не сообщайте этот код, даже поддержке.</td></tr>
</table>
<div style="padding:18px 0 0;font:400 11px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#45454f">© LYNK</div>
</td></tr></table></body></html>`
}

/** Отправка не настроена (домен не подтверждён в Resend): ошибка конфигурации, а не адреса. */
class MailSetupError extends Error {}

async function sendMail(env: NodeJS.ProcessEnv, to: string, code: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'LYNK <onboarding@resend.dev>',
      to: [to],
      subject: `${code} — код подтверждения LYNK`,
      html: codeEmail(code),
      text: `Ваш код подтверждения LYNK: ${code}. Действует 10 минут. Если вы не запрашивали код, проигнорируйте письмо.`,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Без своего домена Resend отправляет только на почту владельца аккаунта Resend.
    if (res.status === 403 || /own email|verify a domain|domain is not verified/i.test(body)) {
      throw new MailSetupError(`Resend: домен отправителя не подтверждён (${res.status}). ${body.slice(0, 200)}`)
    }
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`)
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
      // Подробности (ключ, домен) только в логах: пользователю понятный текст.
      request.log.error({ err }, 'email send failed')
      recordError('email send', err)
      return reply.code(502).send({
        error: err instanceof MailSetupError ? 'Отправка писем ещё настраивается. Попробуйте позже.' : 'Не удалось отправить письмо. Проверьте адрес и попробуйте ещё раз.',
      })
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
