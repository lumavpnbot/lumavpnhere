import type { PanelProvider } from './types'
import { createMockPanelProvider } from './mockPanelProvider'
import { createH1PanelProvider } from './h1PanelProvider'

/**
 * PANEL_MODE=h1   боевой режим, H1 Panel (нужны H1_PANEL_URL, H1_PANEL_TOKEN; инбаунды по H1_INBOUND_TAGS)
 * PANEL_MODE=mock разработка без сервера
 */
export function createPanelProvider(env: NodeJS.ProcessEnv): PanelProvider {
  if (env.PANEL_MODE === 'h1') {
    const baseUrl = env.H1_PANEL_URL ?? ''
    const token = env.H1_PANEL_TOKEN ?? ''
    const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!baseUrl || !token) throw new Error('PANEL_MODE=h1: задайте H1_PANEL_URL и H1_PANEL_TOKEN')
    return createH1PanelProvider({
      baseUrl,
      token,
      inboundIds: list(env.H1_INBOUND_IDS),
      inboundTags: list(env.H1_INBOUND_TAGS),
    })
  }
  return createMockPanelProvider()
}

export { clientName } from './types'
export type { PanelClient, PanelProvider, ProvisionParams } from './types'
