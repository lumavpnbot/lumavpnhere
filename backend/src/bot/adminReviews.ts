import type { PrismaClient } from '@prisma/client'
import type { ReviewService } from '@/services/reviews'
import { PAGE, back, btn, dt, header, pager, who, confirmView, type Ctx, type View } from './adminUi'
import type { Staff } from './staff'
import { esc, type InlineKeyboard } from './tg'

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)

/** Раздел «⭐ Отзывы» в админ-меню: сводка, список, скрыть/вернуть, удалить. */
export function createReviewsAdmin(deps: { prisma: PrismaClient; reviews: ReviewService; staff: Staff }, show: (ctx: Ctx, view: View) => Promise<void>) {
  const { prisma, reviews, staff } = deps

  async function menu(): Promise<View> {
    const s = await reviews.summary()
    const hidden = await prisma.review.count({ where: { hidden: true } })
    const bars = ([5, 4, 3, 2, 1] as const)
      .map((n) => {
        const c = s.distribution[n]
        const w = s.count ? Math.round((c / s.count) * 12) : 0
        return `${n}★ <code>${'█'.repeat(w)}${'░'.repeat(12 - w)}</code> ${c}`
      })
      .join('\n')
    return {
      text:
        header('⭐', 'Отзывы и рейтинг') +
        `Средняя: <b>${s.average.toFixed(2)}</b> · взвешенная: <b>${s.weighted.toFixed(2)}</b>\n` +
        `Оценок: <b>${s.count}</b> · с текстом: ${s.withText} · скрыто: ${hidden}\n\n${bars}\n\n` +
        `<i>Во взвешенной оценке покупатели весят вдвое больше. Один аккаунт, один отзыв.</i>`,
      kb: [
        [btn('Все', 'adm:rvl:all:0'), btn('С текстом', 'adm:rvl:text:0'), btn('Скрытые', 'adm:rvl:hidden:0')],
        [btn('1–2★', 'adm:rvl:low:0'), btn('5★', 'adm:rvl:5:0')],
        back(),
      ],
    }
  }

  async function list(filter: string, page: number): Promise<View> {
    const where =
      filter === 'text' ? { text: { not: null } } : filter === 'hidden' ? { hidden: true } : filter === 'low' ? { rating: { lte: 2 } } : filter === '5' ? { rating: 5 } : {}
    const rows = await prisma.review.findMany({ where, include: { user: true }, orderBy: { updatedAt: 'desc' }, skip: page * PAGE, take: PAGE + 1 })
    const list = rows.slice(0, PAGE)
    const kb: InlineKeyboard = list.map((r) => [
      btn(`${r.hidden ? '🙈 ' : ''}${stars(r.rating)} ${r.user.username ? '@' + r.user.username : r.user.tgId}${r.text ? ' · ' + r.text.slice(0, 18) : ''}`, `adm:rvc:${r.id}`),
    ])
    kb.push(pager(`adm:rvl:${filter}`, page, rows.length > PAGE))
    kb.push(back('adm:rv'))
    return { text: `${header('⭐', 'Отзывы', `фильтр: ${filter}`)}${list.length ? 'Выберите отзыв.' : '<i>Пусто.</i>'}`, kb }
  }

  async function card(id: bigint): Promise<View> {
    const r = await prisma.review.findUnique({ where: { id }, include: { user: true } })
    if (!r) return { text: 'Отзыв не найден', kb: [back('adm:rv')] }
    return {
      text:
        header('⭐', `Отзыв #${r.id}`, r.hidden ? 'скрыт от пользователей' : 'опубликован') +
        `От: ${who(r.user)} · <code>${r.user.tgId}</code>\nОценка: <b>${stars(r.rating)}</b> (${r.rating})\n` +
        `Источник: ${r.source === 'bot' ? 'бот' : 'приложение'} · правок: ${r.editCount}\nОставлен: ${dt(r.createdAt)} · изменён: ${dt(r.updatedAt)}\n\n` +
        (r.text ? `«${esc(r.text)}»` : '<i>Без текста</i>'),
      kb: [
        [r.hidden ? btn('👁 Вернуть', `adm:rvh:${id}:0`) : btn('🙈 Скрыть', `adm:rvh:${id}:1`), btn('🗑 Удалить', `adm:rvd:${id}`)],
        [btn('👤 Пользователь', `adm:u:${r.userId}`)],
        back('adm:rvl:all:0'),
      ],
    }
  }

  async function onCallback(ctx: Ctx, p: string[]): Promise<string | void> {
    const [a, b, c] = p
    switch (a) {
      case 'rv':
        return show(ctx, await menu())
      case 'rvl':
        return show(ctx, await list(b ?? 'all', Number(c ?? 0)))
      case 'rvc':
        return show(ctx, await card(BigInt(b)))
      case 'rvh': {
        const id = BigInt(b)
        await reviews.setHidden(id, c === '1')
        await staff.audit(ctx.tgId, c === '1' ? 'review_hide' : 'review_show', `review:${id}`)
        await show(ctx, await card(id))
        return c === '1' ? 'Отзыв скрыт' : 'Отзыв снова виден'
      }
      case 'rvd':
        return show(ctx, confirmView('Удалить отзыв? Пользователь сможет оставить новый.', `adm:rvdok:${b}`, `adm:rvc:${b}`))
      case 'rvdok': {
        const id = BigInt(b)
        await prisma.review.deleteMany({ where: { id } })
        reviews.invalidate()
        await staff.audit(ctx.tgId, 'review_delete', `review:${id}`)
        await show(ctx, await list('all', 0))
        return 'Удалено'
      }
    }
  }

  return {
    homeItem: ['rv', '⭐ Отзывы', 'adm:rv'] as [string, string, string],
    sections: { rv: 'rv', rvl: 'rv', rvc: 'rv', rvh: 'rv', rvd: 'rv', rvdok: 'rv' } as Record<string, string>,
    onCallback,
  }
}
