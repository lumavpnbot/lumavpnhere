import type { PanelProvider, VpnUserConfig } from './types'

/**
 * Реальная интеграция с 3x-ui API. Включается через PANEL_MODE=3xui в .env,
 * когда появятся боевые серверы (см. раздел 7 ТЗ — VLESS + Reality + XHTTP).
 *
 * TODO: реализовать логин в панель (POST /login), создание/обновление inbound
 * клиента (POST /panel/api/inbounds/addClient) и сборку vless:// ссылки из
 * параметров inbound'а (id, publicKey, shortId, sni).
 */
export function createThreeXUiProvider(config: {
  baseUrl: string
  username: string
  password: string
}): PanelProvider {
  return {
    async createOrUpdateUser(): Promise<VpnUserConfig> {
      throw new Error('3x-ui провайдер ещё не реализован — заполните TODO в threeXUiProvider.ts')
    },
    async revokeUser() {
      throw new Error('3x-ui провайдер ещё не реализован — заполните TODO в threeXUiProvider.ts')
    },
  }
}
