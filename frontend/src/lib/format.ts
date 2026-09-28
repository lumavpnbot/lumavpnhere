export function ruPlural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function formatRub(n: number) {
  return `${n.toLocaleString('ru-RU')} ₽`
}

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 2) return 'только что'
  if (min < 60) return `${min} ${ruPlural(min, 'минуту', 'минуты', 'минут')} назад`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} ${ruPlural(h, 'час', 'часа', 'часов')} назад`
  const d = Math.round(h / 24)
  return `${d} ${ruPlural(d, 'день', 'дня', 'дней')} назад`
}
