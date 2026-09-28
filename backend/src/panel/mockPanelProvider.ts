import type { PanelProvider, VpnUserConfig } from './types'

/** Заглушка для разработки без реальных VPS. См. PANEL_MODE в .env. */
export function createMockPanelProvider(): PanelProvider {
  return {
    async createOrUpdateUser({ tgId }): Promise<VpnUserConfig> {
      const uuid = `mock-${tgId}-${Date.now()}`
      const vlessUrl = `vless://${uuid}@mock.luma-vpn.local:443?security=reality&type=tcp#Luma-Mock`
      return {
        vlessUrl,
        qrData: vlessUrl,
        server: { location: 'Mock (NL)', host: 'mock.luma-vpn.local' },
      }
    },
    async revokeUser() {
      /* no-op */
    },
  }
}
