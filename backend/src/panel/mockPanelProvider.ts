import { randomUUID } from 'node:crypto'
import { clientName, type PanelClient, type PanelProvider } from './types'

/** Заглушка для разработки без сервера (PANEL_MODE=mock). Хранит клиентов в памяти. */
export function createMockPanelProvider(): PanelProvider {
  const clients = new Map<number, PanelClient>()

  return {
    kind: 'mock',
    async provision({ tgId, expiresAt, trafficLimitGb, deviceLimit }) {
      const prev = clients.get(tgId)
      const c: PanelClient = {
        name: clientName(tgId),
        uuid: prev?.uuid ?? randomUUID(),
        enabled: true,
        expiresAt,
        trafficUsedGb: prev?.trafficUsedGb ?? 0,
        trafficLimitGb,
        deviceLimit,
        devicesCount: prev?.devicesCount ?? 0,
        upstreamSubscriptionUrl: null,
      }
      clients.set(tgId, c)
      return c
    },
    async getClient(tgId) {
      return clients.get(tgId) ?? null
    },
    async disable(tgId) {
      const c = clients.get(tgId)
      if (c) c.enabled = false
    },
    async remove(tgId) {
      clients.delete(tgId)
    },
  }
}
