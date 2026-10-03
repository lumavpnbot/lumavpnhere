import type { PanelClient, PanelProvider } from './types'
import { H1ApiError } from './h1PanelProvider'

/** Сколько не обращаемся к панели, которая не ответила (таймаут, сеть, 5xx). */
const DOWN_MS = 2 * 60_000

class PanelDownError extends Error {}

/** Панель «лежит»: таймаут, сетевая ошибка или 5xx. Ответ 4xx значит, что панель жива. */
const isOutage = (err: unknown) => !(err instanceof H1ApiError) || err.status >= 500

/**
 * Несколько серверов (стран) как один. Каждая страна у H1 это отдельная
 * панель со своим API и токеном. Клиента создаём на всех, а подписку
 * пользователю склеиваем в одну в /sub/:token.
 *
 * Первая панель главная: по ней считаем срок, трафик и устройства.
 * Если какая-то страна недоступна, выдача на остальных не ломается: панель, которая
 * не ответила, пропускаем DOWN_MS, а не ждём её таймаут (10 с) в каждом запросе.
 * Раньше из-за одной лежащей панели (de) каждое обновление подписки и выдача новым
 * пользователям занимали 20–40 с, и клиенты обрывали запрос.
 */
export function createMultiPanelProvider(panels: PanelProvider[], logFn: (msg: string) => void = console.warn): PanelProvider {
  // Последняя ошибка по каждой стране, видна в /health (без секретов, только текст ошибки).
  const lastErrors: Record<string, { at: string; error: string }> = {}
  const downUntil: number[] = panels.map(() => 0)
  const label = (i: number) => panels[i].countries.join(',') || String(i)
  const log = (msg: string) => {
    logFn(msg)
    const m = /^\[panel ([^\]]+)\] (.*)$/.exec(msg)
    if (m) lastErrors[m[1]] = { at: new Date().toISOString(), error: m[2] }
  }

  /** Вызов одной панели с учётом «лежит»: пока панель недоступна, сразу ошибка без ожидания. */
  function guarded<T>(i: number, fn: (p: PanelProvider) => Promise<T>): Promise<T> {
    if (Date.now() < downUntil[i]) return Promise.reject(new PanelDownError(`панель ${label(i)} недоступна`))
    return fn(panels[i]).catch((err) => {
      if (isOutage(err)) downUntil[i] = Date.now() + DOWN_MS
      throw err
    })
  }

  async function each<T>(fn: (p: PanelProvider) => Promise<T>, what: string) {
    const results = await Promise.allSettled(panels.map((_, i) => guarded(i, fn)))
    results.forEach((r, i) => {
      if (r.status === 'rejected' && !(r.reason instanceof PanelDownError)) log(`[panel ${label(i)}] ${what}: ${(r.reason as Error)?.message}`)
    })
    return results
  }

  // Досоздание и продление на остальных странах идёт в фоне: по одному разу на клиента и страну.
  const backfilling = new Set<string>()

  return {
    kind: 'multi',
    countries: panels.flatMap((p) => p.countries),

    async provision(params) {
      const results = await each((p) => p.provision(params), 'provision')
      const first = results[0]
      if (first.status === 'rejected') throw first.reason
      const ok: PanelClient[] = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      return { ...first.value, upstreamSubscriptionUrls: ok.flatMap((c) => c.upstreamSubscriptionUrls), links: ok.flatMap((c) => c.links ?? []) }
    },

    async getClient(tgId) {
      const results = await each((p) => p.getClient(tgId), 'getClient')
      if (results[0].status === 'rejected') throw results[0].reason
      const main = results[0].value
      if (!main) return null

      // Новая страна добавлена позже, чем пользователь получил доступ, или продление не дошло до
      // неё (панель лежала): выдаём там тот же срок и лимиты, что на главной панели. Только если
      // панель ответила (нет клиента / срок меньше), а не когда она недоступна.
      if (main.enabled && main.expiresAt && main.expiresAt > new Date()) {
        results.forEach((r, i) => {
          if (i === 0 || r.status !== 'fulfilled') return
          const c = r.value
          const behind = !c || !c.enabled || (c.expiresAt != null && c.expiresAt.getTime() < main.expiresAt!.getTime() - 60 * 60_000)
          const key = `${tgId}:${i}`
          if (!behind || backfilling.has(key)) return
          backfilling.add(key)
          void guarded(i, (p) =>
            p.provision({ tgId, expiresAt: main.expiresAt!, trafficLimitGb: main.trafficLimitGb, deviceLimit: main.deviceLimit }),
          )
            .catch((e) => {
              if (!(e instanceof PanelDownError)) log(`[panel ${label(i)}] backfill: ${(e as Error).message}`)
            })
            .finally(() => backfilling.delete(key))
        })
      }

      const alive = results.flatMap((r) => (r.status === 'fulfilled' && r.value?.enabled ? [r.value] : []))
      return { ...main, upstreamSubscriptionUrls: alive.flatMap((c) => c.upstreamSubscriptionUrls), links: alive.flatMap((c) => c.links ?? []) }
    },

    async disable(tgId) {
      await each((p) => p.disable(tgId), 'disable')
    },

    async remove(tgId) {
      await each((p) => p.remove(tgId), 'remove')
    },

    async describe() {
      const out: Record<string, unknown> = {}
      await Promise.all(
        panels.map(async (p, i) => {
          out[p.countries[0] ?? String(i)] = p.describe ? await p.describe().catch((e: Error) => ({ error: e.message })) : null
        }),
      )
      const down = panels.flatMap((_, i) => (Date.now() < downUntil[i] ? [label(i)] : []))
      return { panels: out, down, lastErrors }
    },
  }
}
