import type { StaffRole } from './staff'
import { esc, type InlineKeyboard } from './tg'

/** Общие типы и оформление админ-меню (используются в admin.ts и adminFeatures.ts). */

export const DAY = 24 * 60 * 60 * 1000
export const PAGE = 8

export interface View {
  text: string
  kb: InlineKeyboard
}

export interface Ctx {
  chatId: number
  tgId: number
  role: StaffRole
  messageId?: number
}

export type Fsm = { kind: string; data: Record<string, string | number | null> }

export const num = (n: unknown) => Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
export const rub = (n: unknown) => `${num(n)} ₽`
export const dt = (d: Date | null | undefined) =>
  d
    ? d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'нет'
export const day = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'нет'
export const planName = (p: string | null | undefined) => (p === 'pro' ? 'Премиум' : p === 'start' ? 'Старт' : p === 'free' ? 'Free' : 'нет')
export const who = (u: { username: string | null; tgId: bigint }) => (u.username ? `@${esc(u.username)}` : `<code>${u.tgId}</code>`)
export const ago = (d: Date) => {
  const m = Math.round((Date.now() - d.getTime()) / 60000)
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`
}
export const line = '<code>─────────────────────</code>'
export const header = (icon: string, title: string, sub?: string) => `${icon} <b>${title}</b>${sub ? `\n<i>${sub}</i>` : ''}\n${line}\n`
export const btn = (text: string, data: string) => ({ text, callback_data: data })
export const back = (to = 'adm:home', label = '‹ Назад') => [btn(label, to)]
export const pager = (prefix: string, page: number, hasNext: boolean) => {
  const row = []
  if (page > 0) row.push(btn('‹', `${prefix}:${page - 1}`))
  row.push(btn(`стр. ${page + 1}`, 'adm:noop'))
  if (hasNext) row.push(btn('›', `${prefix}:${page + 1}`))
  return row
}

/** Начало суток по Москве. */
export function mskDayStart(offsetDays = 0) {
  const now = new Date(Date.now() + 3 * 3600_000)
  now.setUTCHours(0, 0, 0, 0)
  return new Date(now.getTime() - 3 * 3600_000 - offsetDays * DAY)
}
export function mskMonthStart() {
  const now = new Date(Date.now() + 3 * 3600_000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 3 * 3600_000)
}

export function csv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}

export const confirmView = (text: string, yes: string, no: string): View => ({
  text: `${header('⚠️', 'Подтвердите действие')}${text}`,
  kb: [[btn('✅ Подтвердить', yes), btn('Отмена', no)]],
})

/** Разбор даты «ДД.ММ ЧЧ:ММ» по Москве. */
export function parseMsk(input: string): Date | null {
  const m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s+(\d{1,2}):(\d{2})$/.exec(input.trim())
  if (!m) return null
  const now = new Date()
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getUTCFullYear()
  const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1]), Number(m[4]) - 3, Number(m[5])))
  return Number.isNaN(d.getTime()) ? null : d
}
