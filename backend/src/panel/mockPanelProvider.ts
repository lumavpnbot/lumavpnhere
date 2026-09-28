import type { PanelProvider, VpnUserConfig } from './types'

/** Заглушка для разработки без реальных VPS. См. PANEL_MODE в .env. */
export function createMockPanelProvider(): PanelProvider {
  return {
    async createOrUpdateUser({ tgId }): Promise<VpnUserConfig> {
      const uuid = `mock-${tgId}-${Date.now()}`
      const vlessUrl = `vless://${uuid}@mock.lynkvpn.local:443?security=reality&type=tcp#Lynk-Mock`
      return {
        vlessUrl,
        qrData: vlessUrl,
        server: { location: 'Mock (NL)', host: 'mock.lynkvpn.local' },
      }
    },
    async revokeUser() {
      /* no-op */
    },
  }
}
