/**
 * Страны, убранные из сервиса. Их узлы не мониторятся и не показываются в статусе,
 * панели этих стран не используются, а их конфиги вырезаются из подписки.
 * DISABLED_COUNTRIES="us,de" (коды через запятую, пусто = ни одной). Не задано: убрана США.
 */
export function disabledCountries(env: NodeJS.ProcessEnv): Set<string> {
  return new Set((env.DISABLED_COUNTRIES ?? 'us').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
}

/** Узел отключённой страны: по коду страны или по имени вида «us», «us1», «us-ny». */
export function isDisabledNode(off: Set<string>, id: string, country?: string | null): boolean {
  if (country && off.has(country.toLowerCase())) return true
  const m = /^([a-z]{2})(?:$|[^a-z])/.exec(id.toLowerCase())
  return !!m && off.has(m[1])
}
