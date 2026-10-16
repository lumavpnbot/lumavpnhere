const parseList = (v: string) => new Set(v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))

/** Страны своих серверов с 3x-ui (XUI_PANELS). */
export function ownServerCountries(env: NodeJS.ProcessEnv): Set<string> {
  try {
    const list = JSON.parse(env.XUI_PANELS || '[]') as { country?: string }[]
    return new Set(list.map((e) => String(e.country ?? '').trim().toLowerCase()).filter(Boolean))
  } catch {
    return new Set()
  }
}

/**
 * Страны, убранные из сервиса. Их узлы не мониторятся и не показываются в статусе,
 * панели этих стран не используются, а их конфиги вырезаются из подписки.
 * DISABLED_COUNTRIES="us,de" (коды через запятую, пусто = ни одной). Не задано: убрана США,
 * но только пока для неё нет своего сервера в XUI_PANELS.
 */
export function disabledCountries(env: NodeJS.ProcessEnv): Set<string> {
  if (env.DISABLED_COUNTRIES != null) return parseList(env.DISABLED_COUNTRIES)
  const off = parseList('us')
  for (const c of ownServerCountries(env)) off.delete(c)
  return off
}

/**
 * Убранные страны для панелей H1 и конфигов из их подписок. Не задано: США
 * (даже если есть свой сервер США: старые узлы H1 в США не возвращаем).
 */
export function h1DisabledCountries(env: NodeJS.ProcessEnv): Set<string> {
  return parseList(env.DISABLED_COUNTRIES ?? 'us')
}

/** Узел отключённой страны: по коду страны или по имени вида «us», «us1», «us-ny». */
export function isDisabledNode(off: Set<string>, id: string, country?: string | null): boolean {
  if (country && off.has(country.toLowerCase())) return true
  const m = /^([a-z]{2})(?:$|[^a-z])/.exec(id.toLowerCase())
  return !!m && off.has(m[1])
}
