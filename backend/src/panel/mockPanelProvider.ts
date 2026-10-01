import { randomUUID } from 'node:crypto'
import { clientName, type PanelClient, type PanelProvider } from './types'

/**
 * Заглушка для разработки без сервера (PANEL_MODE=mock). Хранит клиентов в памяти
 * и отдаёт демонстрационные конфиги, чтобы /sub/:token можно было проверить в Happ.
 */
export function createMockPanelProvider(): PanelProvider {
  const clients = new Map<number, PanelClient>()
  const demoLinks = (uuid: string) => [
    `vless://${uuid}@fi1.mock.local:443?type=tcp&security=reality&sni=example.com&fp=chrome#${encodeURIComponent('🇫🇮 mock')}`,
    `vless://${uuid}@fi1.mock.local:8080?type=xhttp&security=none&path=%2F#${encodeURIComponent('🇫🇮 mock')}`,
  ]

  return {
    kind: 'mock',
    countries: ['fi'],
    async provision({ tgId, expiresAt, trafficLimitGb, deviceLimit }) {
      const prev = clients.get(tgId)
      const uuid = prev?.uuid ?? randomUUID()
      const c: PanelClient = {
        name: clientName(tgId),
        uuid,
        enabled: true,
        expiresAt,
        trafficUsedGb: prev?.trafficUsedGb ?? 0,
        trafficLimitGb,
        deviceLimit,
        devicesCount: prev?.devicesCount ?? 0,
        upstreamSubscriptionUrls: [],
        links: demoLinks(uuid),
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
    async describe() {
      return { clients: clients.size }
    },
  }
}
