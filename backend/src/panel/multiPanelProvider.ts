import type { PanelClient, PanelProvider } from './types'

/**
 * Несколько серверов (стран) как один. Каждая страна у H1 это отдельная
 * панель со своим API и токеном. Клиента создаём на всех, а подписку
 * пользователю склеиваем в одну в /sub/:token.
 *
 * Первая панель главная: по ней считаем срок, трафик и устройства.
 * Если какая-то страна недоступна, выдача на остальных не ломается.
 */
export function createMultiPanelProvider(panels: PanelProvider[], log: (msg: string) => void = console.warn): PanelProvider {
  async function each<T>(fn: (p: PanelProvider) => Promise<T>, what: string) {
    const results = await Promise.allSettled(panels.map(fn))
    results.forEach((r, i) => {
      if (r.status === 'rejected') log(`[panel ${panels[i].countries.join(',') || i}] ${what}: ${(r.reason as Error)?.message}`)
    })
    return results
  }

  return {
    kind: 'multi',
    countries: panels.flatMap((p) => p.countries),

    async provision(params) {
      const results = await each((p) => p.provision(params), 'provision')
      const first = results[0]
      if (first.status === 'rejected') throw first.reason
      const ok: PanelClient[] = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      return { ...first.value, upstreamSubscriptionUrls: ok.flatMap((c) => c.upstreamSubscriptionUrls) }
    },

    async getClient(tgId) {
      const results = await each((p) => p.getClient(tgId), 'getClient')
      const main = results[0].status === 'fulfilled' ? results[0].value : null
      if (!main) return null
      const urls = results.flatMap((r) => (r.status === 'fulfilled' && r.value?.enabled ? r.value.upstreamSubscriptionUrls : []))
      return { ...main, upstreamSubscriptionUrls: urls }
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
      return out
    },
  }
}
