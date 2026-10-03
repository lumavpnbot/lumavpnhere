import type { PrismaClient, Review, User } from '@prisma/client'

const DAY = 24 * 60 * 60 * 1000
const MAX_TEXT = 1000
/** Аккаунт должен прожить сутки (если нет оплат): так не накрутить свежими аккаунтами. */
const MIN_ACCOUNT_AGE_MS = DAY
/** Не чаще одного изменения в 15 секунд и не больше 20 в сутки. */
const MIN_EDIT_GAP_MS = 15_000
const MAX_EDITS_PER_DAY = 20
/** Вес оценки покупателя в «взвешенном» балле. */
const PAID_WEIGHT = 2

export class ReviewError extends Error {}

export interface ReviewSummary {
  count: number
  withText: number
  average: number
  weighted: number
  distribution: Record<1 | 2 | 3 | 4 | 5, number>
}

export interface PublicReview {
  id: string
  name: string
  initial: string
  rating: number
  text: string | null
  paid: boolean
  edited: boolean
  at: string
}

export type Eligibility = { ok: true } | { ok: false; reason: string }

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

/** Ник частично скрыт: @sh•••, чтобы отзывы не превращались в базу юзернеймов. */
function displayName(u: { username: string | null }): { name: string; initial: string } {
  if (!u.username) return { name: 'Пользователь LYNK', initial: 'L' }
  const nick = u.username
  const shown = nick.length <= 3 ? nick.slice(0, 1) : nick.slice(0, 3)
  return { name: `@${shown}${'•'.repeat(3)}`, initial: nick.slice(0, 1).toUpperCase() }
}

function cleanText(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const text = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁯]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (!text) return null
  if (text.length > MAX_TEXT) throw new ReviewError(`Отзыв длиннее ${MAX_TEXT} символов`)
  // Ссылки и упоминания: защита от рекламы в отзывах.
  if (/(https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(ru|com|net|org|io|me|su|xyz|top|cc)\b|@[a-z0-9_]{4,})/i.test(text)) {
    throw new ReviewError('Ссылки и упоминания в отзывах нельзя')
  }
  return text
}

export function createReviewService(prisma: PrismaClient, onNew?: (review: Review, user: User, isNew: boolean) => Promise<void>) {
  let cache: { at: number; value: ReviewSummary } | null = null

  async function hasPaid(userId: bigint) {
    return (await prisma.payment.count({ where: { userId, status: 'paid' } })) > 0
  }

  /**
   * Кто может оценивать. Один аккаунт Telegram = один отзыв (уникальный индекс в БД).
   * Плюс: аккаунт не в бане, им реально пользовались (была пробная или платная подписка),
   * и ему больше суток, если он ничего не оплачивал. Это отсекает накрутку пачкой новых аккаунтов.
   */
  async function eligibility(user: User): Promise<Eligibility> {
    if (user.banned) return { ok: false, reason: 'Аккаунт заблокирован' }
    const subs = await prisma.subscription.count({ where: { userId: user.id } })
    if (!subs) return { ok: false, reason: 'Оценить сервис можно после подключения: начните пробный период' }
    if (Date.now() - user.createdAt.getTime() < MIN_ACCOUNT_AGE_MS && !(await hasPaid(user.id))) {
      return { ok: false, reason: 'Оставить отзыв можно через сутки пользования сервисом' }
    }
    return { ok: true }
  }

  async function summary(): Promise<ReviewSummary> {
    if (cache && Date.now() - cache.at < 30_000) return cache.value
    const rows = await prisma.review.findMany({
      where: { hidden: false, user: { banned: false } },
      select: { rating: true, text: true, user: { select: { payments: { where: { status: 'paid' }, select: { id: true }, take: 1 } } } },
    })
    const distribution: ReviewSummary['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    let sum = 0
    let wSum = 0
    let wTotal = 0
    let withText = 0
    for (const r of rows) {
      const rating = Math.min(5, Math.max(1, r.rating)) as 1 | 2 | 3 | 4 | 5
      distribution[rating]++
      sum += rating
      const w = r.user.payments.length ? PAID_WEIGHT : 1
      wSum += rating * w
      wTotal += w
      if (r.text) withText++
    }
    const value: ReviewSummary = {
      count: rows.length,
      withText,
      average: rows.length ? round2(sum / rows.length) : 0,
      weighted: wTotal ? round2(wSum / wTotal) : 0,
      distribution,
    }
    cache = { at: Date.now(), value }
    return value
  }

  async function toPublic(r: Review & { user: { username: string | null; payments: { id: bigint }[] } }): Promise<PublicReview> {
    const { name, initial } = displayName(r.user)
    return {
      id: r.id.toString(),
      name,
      initial,
      rating: r.rating,
      text: r.text,
      paid: r.user.payments.length > 0,
      edited: r.editCount > 0,
      at: r.updatedAt.toISOString(),
    }
  }

  async function list(params: { stars?: number; withText?: boolean; cursor?: string; limit?: number }) {
    const limit = Math.min(30, Math.max(1, params.limit ?? 15))
    const rows = await prisma.review.findMany({
      where: {
        hidden: false,
        user: { banned: false },
        ...(params.stars ? { rating: params.stars } : {}),
        ...(params.withText ? { text: { not: null } } : {}),
      },
      include: { user: { select: { username: true, payments: { where: { status: 'paid' }, select: { id: true }, take: 1 } } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...(params.cursor ? { cursor: { id: BigInt(params.cursor) }, skip: 1 } : {}),
      take: limit + 1,
    })
    const items = await Promise.all(rows.slice(0, limit).map(toPublic))
    return { items, nextCursor: rows.length > limit ? rows[limit - 1].id.toString() : null }
  }

  async function mine(user: User) {
    return prisma.review.findUnique({ where: { userId: user.id } })
  }

  async function upsert(user: User, input: { rating: number; text?: string | null; keepText?: boolean }, source: 'app' | 'bot') {
    const rating = Number(input.rating)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ReviewError('Оценка от 1 до 5 звёзд')
    const elig = await eligibility(user)
    if (!elig.ok) throw new ReviewError(elig.reason)

    const existing = await mine(user)
    if (existing) {
      if (Date.now() - existing.updatedAt.getTime() < MIN_EDIT_GAP_MS) throw new ReviewError('Слишком часто, попробуйте через несколько секунд')
      const dayAgo = Date.now() - DAY
      if (existing.editCount >= MAX_EDITS_PER_DAY && existing.updatedAt.getTime() > dayAgo) throw new ReviewError('Отзыв можно менять не больше 20 раз в сутки')
    }
    const text = input.keepText && existing ? existing.text : cleanText(input.text)
    // upsert по уникальному user_id: даже при одновременных запросах из бота и приложения
    // отзыв у человека останется один.
    const review = await prisma.review.upsert({
      where: { userId: user.id },
      create: { userId: user.id, rating, text, source },
      update: { rating, text, source, editCount: { increment: 1 } },
    })
    cache = null
    if (onNew) await onNew(review, user, !existing).catch(() => undefined)
    return review
  }

  async function remove(user: User) {
    await prisma.review.deleteMany({ where: { userId: user.id } })
    cache = null
  }

  async function setHidden(id: bigint, hidden: boolean) {
    await prisma.review.update({ where: { id }, data: { hidden } })
    cache = null
  }

  return { eligibility, summary, list, mine, upsert, remove, setHidden, invalidate: () => (cache = null), round1 }
}

export type ReviewService = ReturnType<typeof createReviewService>
