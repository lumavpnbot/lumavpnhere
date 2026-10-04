import type { Incident, PrismaClient } from '@prisma/client'
import { disabledCountries, isDisabledNode } from '@/lib/countries'
import { recordError } from '@/lib/errors'
import { entries, tcpPing } from './servers'

const HOUR = 3600_000
const DAY = 24 * HOUR

export type Overall = 'ok' | 'degraded' | 'down'

interface Node {
  /** Ключ узла в истории проверок: код страны (fi) или имя монитора Uptime Kuma. */
  id: string
  country: string | null
  host: string
  port: number
}

/**
 * Статус сервиса (ТЗ v6.3 · 02). Источник данных:
 *  - встроенный мониторинг: TCP-проверка узлов из H1_PANELS / STATUS_NODES раз в минуту;
 *  - или Uptime Kuma (UPTIME_KUMA_URL + UPTIME_KUMA_SLUG): берём его публичную страницу статуса.
 * Проверки пишутся в status_checks (30 дней), по ним считаются uptime и почасовой график.
 * Узел не отвечает 3 проверки подряд → инцидент открывается сам и сам закрывается при восстановлении.
 */
export function createStatusService(deps: {
  prisma: PrismaClient
  env: NodeJS.ProcessEnv
  /** Уведомление команде и в канал (STATUS_CHANNEL_ID) об авто-инцидентах. */
  alert: (text: string) => Promise<void>
}) {
  const { prisma, env, alert } = deps
  /** Узлы убранных стран (DISABLED_COUNTRIES) не проверяем и не показываем. */
  const off = disabledCountries(env)
  const hidden = (id: string, country?: string | null) => isDisabledNode(off, id, country)
  /** Инциденты узлов убранных стран тоже не показываем (ручные инциденты без узла остаются). */
  const visibleIncident = { OR: [{ node: null }, { node: { notIn: [...off] } }] }
  const fails = new Map<string, number>()
  /** Когда менялись инциденты: по нему сбрасываются кэши статуса. */
  let changedAt = Date.now()
  const touch = () => {
    changedAt = Date.now()
    cache = null
  }

  function builtinNodes(): Node[] {
    const list: Node[] = []
    for (const e of entries(env)) {
      try {
        const u = new URL(e.url)
        list.push({ id: e.country, country: e.country, host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) })
      } catch {
        /* кривой URL панели пропускаем */
      }
    }
    // Дополнительные узлы: STATUS_NODES='[{"name":"nl","host":"nl1.example.com","port":443}]'
    try {
      for (const n of JSON.parse(env.STATUS_NODES || '[]') as { name: string; host: string; port?: number; country?: string }[]) {
        const country = n.country ?? (/^[a-z]{2}$/.test(n.name) ? n.name : null)
        if (!hidden(n.name, country)) list.push({ id: n.name, country, host: n.host, port: n.port ?? 443 })
      }
    } catch {
      recordError('status', new Error('STATUS_NODES: не удалось разобрать JSON'))
    }
    return list
  }

  const kuma = () => (env.UPTIME_KUMA_URL && env.UPTIME_KUMA_SLUG ? { base: env.UPTIME_KUMA_URL.replace(/\/+$/, ''), slug: env.UPTIME_KUMA_SLUG } : null)

  /** Последние результаты Uptime Kuma: /api/status-page/:slug и /api/status-page/heartbeat/:slug. */
  async function kumaResults(): Promise<{ id: string; ok: boolean; pingMs: number | null }[]> {
    const k = kuma()!
    const [page, beats] = await Promise.all([
      fetch(`${k.base}/api/status-page/${k.slug}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
      fetch(`${k.base}/api/status-page/heartbeat/${k.slug}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
    ])
    const names = new Map<number, string>()
    for (const g of (page as { publicGroupList?: { monitorList?: { id: number; name: string }[] }[] }).publicGroupList ?? []) {
      for (const m of g.monitorList ?? []) names.set(m.id, m.name)
    }
    const list = (beats as { heartbeatList?: Record<string, { status: number; ping: number | null }[]> }).heartbeatList ?? {}
    return Object.entries(list).flatMap(([id, arr]) => {
      const last = arr[arr.length - 1]
      const name = names.get(Number(id)) ?? `monitor-${id}`
      return last && !hidden(name) ? [{ id: name, ok: last.status === 1, pingMs: last.ping ?? null }] : []
    })
  }

  /** Одна итерация мониторинга (джоба раз в минуту). */
  async function tick() {
    const results = kuma()
      ? await kumaResults()
      : await Promise.all(builtinNodes().map(async (n) => ({ id: n.id, ...(await tcpPing(n.host, n.port).then((ms) => ({ ok: ms != null, pingMs: ms }))) })))
    if (!results.length) return results
    await prisma.statusCheck.createMany({ data: results.map((r) => ({ node: r.id, ok: r.ok, pingMs: r.pingMs })) })

    // Узел убрали из мониторинга (страну отключили, панель удалили): его авто-инцидент
    // больше некому закрыть, и статус навсегда оставался «есть проблемы». Закрываем сами.
    const orphaned = await prisma.incident.updateMany({
      where: { auto: true, status: 'open', node: { notIn: results.map((r) => r.id) } },
      data: { status: 'resolved', resolvedAt: new Date() },
    })
    if (orphaned.count) touch()

    const allDown = results.every((r) => !r.ok)
    for (const r of results) {
      const open = await prisma.incident.findFirst({ where: { node: r.id, auto: true, status: 'open' } })
      if (r.ok) {
        fails.set(r.id, 0)
        if (open) {
          // Автозакрытие инцидента при восстановлении.
          await prisma.incident.update({ where: { id: open.id }, data: { status: 'resolved', resolvedAt: new Date() } })
          touch()
          await alert(`🟢 <b>${r.id.toUpperCase()}: работает</b>\nИнцидент «${open.title}» закрыт автоматически, простой ${Math.max(1, Math.round((Date.now() - open.startedAt.getTime()) / 60000))} мин.`)
        }
        continue
      }
      const n = (fails.get(r.id) ?? 0) + 1
      fails.set(r.id, n)
      if (n >= 3 && !open) {
        const inc = await prisma.incident.create({
          data: { title: `${r.id.toUpperCase()}: узел не отвечает`, severity: allDown ? 'major' : 'minor', node: r.id, auto: true, text: 'Обнаружено мониторингом. Уже разбираемся.' },
        })
        touch()
        await alert(`${allDown ? '🔴' : '🟠'} <b>${inc.title}</b>\n${allDown ? 'Все узлы недоступны: крупный сбой.' : 'Остальные страны работают, клиент переключится сам.'}\nИнцидент #${inc.id} открыт автоматически.`)
      }
    }
    return results
  }

  /** Раз в час: история проверок хранится 31 день. */
  async function cleanup() {
    await prisma.statusCheck.deleteMany({ where: { at: { lt: new Date(Date.now() - 31 * DAY) } } })
  }

  async function knownNodes(): Promise<{ id: string; country: string | null }[]> {
    if (!kuma()) return builtinNodes().map((n) => ({ id: n.id, country: n.country }))
    const rows = await prisma.statusCheck.findMany({ where: { at: { gte: new Date(Date.now() - DAY) } }, distinct: ['node'], select: { node: true } })
    return rows.filter((r) => !hidden(r.node)).map((r) => ({ id: r.node, country: /^[a-z]{2}$/.test(r.node) ? r.node : null }))
  }

  function incidentView(i: Incident) {
    return {
      id: i.id.toString(),
      title: i.title,
      text: i.text,
      severity: i.severity,
      status: i.status,
      node: i.node,
      auto: i.auto,
      eta: i.eta?.toISOString() ?? null,
      startedAt: i.startedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    }
  }

  /** GET /api/status: общий статус, узлы с пингом и uptime, почасовой график за сутки, инциденты. */
  async function snapshot() {
    const nodes = await knownNodes()
    const since30 = new Date(Date.now() - 30 * DAY)
    const since24 = new Date(Date.now() - DAY)
    const out = []
    for (const n of nodes) {
      const [last, total30, ok30, recent] = await Promise.all([
        prisma.statusCheck.findFirst({ where: { node: n.id }, orderBy: { at: 'desc' } }),
        prisma.statusCheck.count({ where: { node: n.id, at: { gte: since30 } } }),
        prisma.statusCheck.count({ where: { node: n.id, at: { gte: since30 }, ok: true } }),
        prisma.statusCheck.findMany({ where: { node: n.id, at: { gte: since24 } }, select: { ok: true, at: true } }),
      ])
      // 24 столбика по часам: доля успешных проверок (null — данных нет).
      const hours: (number | null)[] = Array.from({ length: 24 }, () => null)
      const buckets = Array.from({ length: 24 }, () => ({ ok: 0, all: 0 }))
      const start = Date.now() - DAY
      for (const c of recent) {
        const i = Math.min(23, Math.floor((c.at.getTime() - start) / HOUR))
        buckets[i].all++
        if (c.ok) buckets[i].ok++
      }
      buckets.forEach((b, i) => (hours[i] = b.all ? Math.round((b.ok / b.all) * 1000) / 10 : null))
      const ok24 = recent.filter((c) => c.ok).length
      out.push({
        id: n.id,
        country: n.country,
        // Проверка старше 5 минут = нет данных, считаем узел недоступным.
        online: !!last && last.ok && Date.now() - last.at.getTime() < 5 * 60_000,
        pingMs: last?.ok ? last.pingMs : null,
        checkedAt: last?.at.toISOString() ?? null,
        uptime24h: recent.length ? Math.round((ok24 / recent.length) * 10000) / 100 : null,
        uptime30d: total30 ? Math.round((ok30 / total30) * 10000) / 100 : null,
        hourly: hours,
      })
    }
    const [open, history] = await Promise.all([
      prisma.incident.findMany({ where: { status: 'open', ...visibleIncident }, orderBy: { startedAt: 'desc' } }),
      prisma.incident.findMany({ where: visibleIncident, orderBy: { startedAt: 'desc' }, take: 20 }),
    ])
    const down = out.filter((n) => !n.online).length
    const overall: Overall =
      (out.length && down === out.length) || open.some((i) => i.severity === 'major') ? 'down' : down || open.length ? 'degraded' : 'ok'
    const etas = open.map((i) => i.eta?.getTime()).filter((x): x is number => !!x)
    return {
      overall,
      updatedAt: new Date().toISOString(),
      eta: etas.length ? new Date(Math.max(...etas)).toISOString() : null,
      nodes: out,
      openIncidents: open.map(incidentView),
      incidents: history.map(incidentView),
    }
  }

  async function history(limit = 20) {
    return (await prisma.incident.findMany({ where: visibleIncident, orderBy: { startedAt: 'desc' }, take: limit })).map(incidentView)
  }

  /** Короткий статус для бота и виджета (кэш 30 секунд). */
  let cache: { at: number; value: Overall } | null = null
  async function overall(): Promise<Overall> {
    if (cache && Date.now() - cache.at < 30_000) return cache.value
    const value = (await snapshot()).overall
    cache = { at: Date.now(), value }
    return value
  }

  async function publish(p: { title: string; text?: string | null; severity: 'minor' | 'major'; eta?: Date | null; byTgId: number }) {
    const inc = await prisma.incident.create({ data: { title: p.title, text: p.text ?? null, severity: p.severity, eta: p.eta ?? null, createdByTgId: BigInt(p.byTgId) } })
    touch()
    return inc
  }

  async function resolve(id: bigint) {
    const inc = await prisma.incident.update({ where: { id }, data: { status: 'resolved', resolvedAt: new Date() } })
    touch()
    return inc
  }

  /** Удалить инцидент совсем (ошибочный или тестовый): пропадает из статуса и истории. */
  async function remove(id: bigint) {
    const inc = await prisma.incident.delete({ where: { id } })
    touch()
    return inc
  }

  return { tick, cleanup, snapshot, history, overall, publish, resolve, remove, incidentView, knownNodes, changedAt: () => changedAt }
}

export type StatusService = ReturnType<typeof createStatusService>
