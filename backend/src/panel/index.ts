import type { PanelProvider } from './types'
import { createMockPanelProvider } from './mockPanelProvider'
import { createH1PanelProvider } from './h1PanelProvider'

/**
 * PANEL_MODE=h1   боевой режим, H1 Panel (нужны H1_PANEL_URL, H1_PANEL_TOKEN, H1_INBOUND_IDS)
 * PANEL_MODE=mock разработка без сервера
 */
export function createPanelProvider(env: NodeJS.ProcessEnv): PanelProvider {
  if (env.PANEL_MODE === 'h1') {
    const baseUrl = env.H1_PANEL_URL ?? ''
    const token = env.H1_PANEL_TOKEN ?? ''
    const inboundIds = (env.H1_INBOUND_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!baseUrl || !token || inboundIds.length === 0) {
      throw new Error('PANEL_MODE=h1: задайте H1_PANEL_URL, H1_PANEL_TOKEN и H1_INBOUND_IDS')
    }
    return createH1PanelProvider({ baseUrl, token, inboundIds })
  }
  return createMockPanelProvider()
}

export { clientName } from './types'
export type { PanelClient, PanelProvider, ProvisionParams } from './types'
