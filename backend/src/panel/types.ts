export interface VpnUserConfig {
  vlessUrl: string
  qrData: string
  server: { location: string; host: string }
}

/**
 * Абстракция над панелью управления VPN-серверами (3x-ui/Xray). Пока
 * сокомандник не поднял реальные VPS, вместо этого работает MockPanelProvider,
 * который выдаёт правдоподобные, но фиктивные конфиги — фронт и остальной
 * бэкенд от этого не зависят и не потребуют переделки при переключении.
 */
export interface PanelProvider {
  createOrUpdateUser(params: { tgId: number; trafficLimitGb: number | null }): Promise<VpnUserConfig>
  revokeUser(params: { tgId: number }): Promise<void>
}
