import type { PrismaClient, User } from '@prisma/client'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DAY = 24 * 60 * 60 * 1000

function randomCode(len = 6) {
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return s
}

/**
 * Регистрация пользователя из бота (/start) или Mini App (/me).
 * Реферальная ссылка: t.me/lynkorobot?start=REF_<код> (старый формат ref_<tg_id> тоже понимаем).
 * Реферер привязывается только при первой регистрации, себя пригласить нельзя.
 */
export function createUserService(prisma: PrismaClient, onSuspicious: (text: string) => Promise<void>) {
  async function referrerFrom(payload: string | null | undefined, selfTgId: bigint): Promise<User | null> {
    const m = /^ref_?([A-Za-z0-9]+)$/i.exec(payload ?? '')
    if (!m) return null
    const code = m[1]
    const referrer = /^\d{5,}$/.test(code)
      ? await prisma.user.findUnique({ where: { tgId: BigInt(code) } })
      : await prisma.user.findUnique({ where: { refCode: code.toUpperCase() } })
    if (!referrer || referrer.tgId === selfTgId || referrer.banned) return null
    return referrer
  }

  async function ensureRefCode(user: User): Promise<User> {
    if (user.refCode) return user
    for (let i = 0; i < 5; i++) {
      try {
        return await prisma.user.update({ where: { id: user.id }, data: { refCode: randomCode() } })
      } catch {
        /* код занят, пробуем другой */
      }
    }
    return user
  }

  async function ensureUser(params: { tgId: number; username: string | null; refPayload?: string | null; fromBot?: boolean }) {
    const tgId = BigInt(params.tgId)
    let user = await prisma.user.findUnique({ where: { tgId } })
    let created = false

    if (!user) {
      const referrer = await referrerFrom(params.refPayload, tgId)
      user = await prisma.user.create({
        data: { tgId, username: params.username, referrerId: referrer?.id ?? null, botStarted: Boolean(params.fromBot) },
      })
      created = true
      if (referrer) {
        await prisma.referral.create({ data: { referrerId: referrer.id, referredId: user.id, levelAtTime: referrer.referralLevel } }).catch(() => undefined)
        // Антифрод из ТЗ: больше 10 приглашений за сутки отправляем на ручную проверку.
        const today = await prisma.referral.count({ where: { referrerId: referrer.id, createdAt: { gte: new Date(Date.now() - DAY) } } })
        if (today === 11) {
          await onSuspicious(`🚩 У ${referrer.username ? '@' + referrer.username : referrer.tgId} больше 10 рефералов за сутки. Проверьте в админ-меню.`)
        }
      }
    } else {
      const patch: { username?: string | null; botStarted?: boolean } = {}
      if (params.username !== user.username) patch.username = params.username
      if (params.fromBot && !user.botStarted) patch.botStarted = true
      if (Object.keys(patch).length) user = await prisma.user.update({ where: { id: user.id }, data: patch })
    }

    user = await ensureRefCode(user)
    return { user, created }
  }

  return { ensureUser }
}

export type UserService = ReturnType<typeof createUserService>
