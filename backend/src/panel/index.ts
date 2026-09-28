import type { PanelProvider } from './types'
import { createMockPanelProvider } from './mockPanelProvider'
import { createThreeXUiProvider } from './threeXUiProvider'

export function createPanelProvider(env: {
  PANEL_MODE?: string
  PANEL_BASE_URL?: string
  PANEL_USERNAME?: string
  PANEL_PASSWORD?: string
}): PanelProvider {
  if (env.PANEL_MODE === '3xui') {
    return createThreeXUiProvider({
      baseUrl: env.PANEL_BASE_URL ?? '',
      username: env.PANEL_USERNAME ?? '',
      password: env.PANEL_PASSWORD ?? '',
    })
  }
  return createMockPanelProvider()
}

export type { PanelProvider, VpnUserConfig } from './types'
