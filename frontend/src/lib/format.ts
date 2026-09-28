import { plural, type Lang } from '@/i18n'

const MONTHS: Record<Lang, string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}

export function formatDate(iso: string, lang: Lang) {
  const d = new Date(iso)
  return lang === 'en'
    ? `${MONTHS.en[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
    : `${d.getDate()} ${MONTHS.ru[d.getMonth()]} ${d.getFullYear()}`
}

export function formatRub(n: number, signed = false) {
  const sign = signed && n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString('ru-RU')} ₽`
}

export function timeAgo(iso: string, lang: Lang) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 2) return lang === 'en' ? 'just now' : 'только что'
  if (min < 60) return lang === 'en' ? `${min} min ago` : `${min} ${plural(lang, min, { ru: ['минуту', 'минуты', 'минут'], en: ['', ''] })} назад`
  const h = Math.round(min / 60)
  if (h < 24) return lang === 'en' ? `${h} h ago` : `${h} ${plural(lang, h, { ru: ['час', 'часа', 'часов'], en: ['', ''] })} назад`
  const d = Math.round(h / 24)
  return lang === 'en'
    ? `${d} ${plural(lang, d, { ru: ['', '', ''], en: ['day', 'days'] })} ago`
    : `${d} ${plural(lang, d, { ru: ['день', 'дня', 'дней'], en: ['', ''] })} назад`
}

export function daysWord(lang: Lang, n: number) {
  return plural(lang, n, { ru: ['день', 'дня', 'дней'], en: ['day', 'days'] })
}
