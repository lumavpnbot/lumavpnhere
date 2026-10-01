import { disabledCountries } from '@/lib/countries'
import type { PanelProvider } from './types'
import { createMockPanelProvider } from './mockPanelProvider'
import { createH1PanelProvider } from './h1PanelProvider'
import { createMultiPanelProvider } from './multiPanelProvider'

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

interface PanelEnvEntry {
  country: string
  url: string
  token: string
  tags?: string
  /** Каналы H1 через запятую, например "main,bs". */
  channels?: string
}

/**
 * PANEL_MODE=h1 боевой режим.
 *
 * Несколько стран: переменная H1_PANELS со списком JSON, первая страна главная:
 *   [{"country":"fi","url":"http://fi3.h1cloud.net:25589/api","token":"...","tags":"fi-tcp"},
 *    {"country":"de","url":"http://de1.h1cloud.net:XXXXX/api","token":"...","tags":"de-tcp"}]
 *
 * Одна страна (старый вариант): H1_PANEL_URL, H1_PANEL_TOKEN, H1_INBOUND_TAGS, H1_COUNTRY.
 *
 * PANEL_MODE=mock разработка без сервера.
 */
export function createPanelProvider(env: NodeJS.ProcessEnv): PanelProvider {
  if (env.PANEL_MODE !== 'h1') return createMockPanelProvider()

  let entries: PanelEnvEntry[]
  if (env.H1_PANELS) {
    try {
      entries = JSON.parse(env.H1_PANELS) as PanelEnvEntry[]
    } catch {
      throw new Error('H1_PANELS: не удалось разобрать JSON')
    }
  } else {
    entries = [
      {
        country: env.H1_COUNTRY ?? 'fi',
        url: env.H1_PANEL_URL ?? '',
        token: env.H1_PANEL_TOKEN ?? '',
        tags: env.H1_INBOUND_TAGS,
      },
    ]
  }

  // Панели убранных стран (DISABLED_COUNTRIES, по умолчанию США) не используем.
  const off = disabledCountries(env)
  const enabled = entries.filter((e) => !off.has(String(e.country).toLowerCase()))
  if (enabled.length) entries = enabled

  const panels = entries.map((e) => {
    if (!e.url || !e.token) throw new Error(`H1 (${e.country}): нужны url и token`)
    return createH1PanelProvider({
      baseUrl: e.url,
      token: e.token,
      country: e.country,
      inboundIds: [],
      inboundTags: list(e.tags),
      channels: list(e.channels),
    })
  })

  return panels.length === 1 ? panels[0] : createMultiPanelProvider(panels)
}

export { clientName } from './types'
export type { PanelClient, PanelProvider, ProvisionParams } from './types'
