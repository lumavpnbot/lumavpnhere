import type { PanelClient, PanelProvider } from './types'
import { H1ApiError } from './h1PanelProvider'

/** Через сколько проверяем в фоне, ожила ли панель, которая не ответила (таймаут, сеть, 5xx). */
const DOWN_MS = 2 * 60_000

/** Досоздание/продление клиента на одной стране не чаще раза в BACKFILL_MS. */
const BACKFILL_MS = 30 * 60_000
/** Срок на другой стране считаем отставшим, только если он меньше главного больше чем на сутки:
 * панели могут хранить срок по-разному (до полуночи, в своём часовом поясе). */
const BEHIND_MS = 24 * 60 * 60_000

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
 * не ответила, пропускаем, пока фоновая проверка (раз в DOWN_MS) не увидит, что она ожила.
 * Запросы пользователей её таймаут (10 с) больше не ждут.
 * Раньше из-за одной лежащей панели (de) каждое обновление подписки и выдача новым
 * пользователям занимали 20–40 с, и клиенты обрывали запрос.
 */
export function createMultiPanelProvider(panels: PanelProvider[], logFn: (msg: string) => void = console.warn): PanelProvider {
  // Последняя ошибка по каждой стране, видна в /health (без секретов, только текст ошибки).
  const lastErrors: Record<string, { at: string; error: string }> = {}
  const down: boolean[] = panels.map(() => false)
  const probing: boolean[] = panels.map(() => false)
  const probeAt: number[] = panels.map(() => 0)
  const label = (i: number) => panels[i].countries.join(',') || String(i)
  const log = (msg: string) => {
    logFn(msg)
    const m = /^\[panel ([^\]]+)\] (.*)$/.exec(msg)
    if (m) lastErrors[m[1]] = { at: new Date().toISOString(), error: m[2] }
  }

  /** Фоновая проверка лежащей панели (не чаще раза в DOWN_MS): ответила, значит снова в строю. */
  function probe(i: number) {
    if (probing[i] || Date.now() < probeAt[i]) return
    probing[i] = true
    probeAt[i] = Date.now() + DOWN_MS
    panels[i]
      .getClient(0)
      .then(
        () => {
          down[i] = false
          logFn(`[panel ${label(i)}] снова отвечает`)
        },
        (err) => {
          if (!isOutage(err)) down[i] = false
        },
      )
      .finally(() => {
        probing[i] = false
      })
  }

  /** Вызов одной панели с учётом «лежит»: пока панель недоступна, сразу ошибка без ожидания. */
  function guarded<T>(i: number, fn: (p: PanelProvider) => Promise<T>): Promise<T> {
    if (down[i]) {
      probe(i)
      return Promise.reject(new PanelDownError(`панель ${label(i)} недоступна`))
    }
    return fn(panels[i]).catch((err) => {
      if (isOutage(err) && !down[i]) {
        down[i] = true
        probeAt[i] = Date.now() + DOWN_MS
      }
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

  // Досоздание и продление на остальных странах идёт в фоне, по клиенту и стране не чаще раза
  // в BACKFILL_MS. Каждое изменение клиента на панели H1 перезагружает её сервер, и частые
  // перезаписи рвут соединения (XHTTP и др.) у всех пользователей этой страны.
  const backfilledAt = new Map<string, number>()
  // Сколько раз с запуска меняли клиентов на каждой панели (видно в /health): так заметен «шторм» записей.
  const writes: Record<string, number> = {}
  const countWrite = (i: number) => {
    writes[label(i)] = (writes[label(i)] ?? 0) + 1
  }

  return {
    kind: 'multi',
    countries: panels.flatMap((p) => p.countries),

    async provision(params) {
      panels.forEach((_, i) => !down[i] && countWrite(i))
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
          const behind = !c || !c.enabled || (c.expiresAt != null && c.expiresAt.getTime() < main.expiresAt!.getTime() - BEHIND_MS)
          const key = `${tgId}:${i}`
          if (!behind || Date.now() - (backfilledAt.get(key) ?? 0) < BACKFILL_MS) return
          backfilledAt.set(key, Date.now())
          if (backfilledAt.size > 10_000) backfilledAt.delete(backfilledAt.keys().next().value!)
          countWrite(i)
          void guarded(i, (p) =>
            p.provision({ tgId, expiresAt: main.expiresAt!, trafficLimitGb: main.trafficLimitGb, deviceLimit: main.deviceLimit }),
          )
            .catch((e) => {
              if (!(e instanceof PanelDownError)) log(`[panel ${label(i)}] backfill: ${(e as Error).message}`)
            })
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
      return { panels: out, down: panels.flatMap((_, i) => (down[i] ? [label(i)] : [])), writes, lastErrors }
    },
  }
}
