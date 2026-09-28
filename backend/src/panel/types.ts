/** Состояние VPN-клиента пользователя на панели. */
export interface PanelClient {
  /** Имя клиента на панели, у нас всегда `tg_<telegramId>`. */
  name: string
  uuid: string
  enabled: boolean
  expiresAt: Date | null
  trafficUsedGb: number
  trafficLimitGb: number | null // null = безлимит
  deviceLimit: number | null // null = без ограничения
  devicesCount: number
  /** Ссылка подписки у самой панели (http). Пользователю её не отдаём, проксируем через /sub/:token. */
  upstreamSubscriptionUrl: string | null
}

export interface ProvisionParams {
  tgId: number
  expiresAt: Date
  trafficLimitGb: number | null
  deviceLimit: number | null
}

/**
 * Абстракция над панелью VPN-серверов. Бизнес-логика (оплата, trial,
 * истечение) работает только через этот интерфейс и не знает, какая
 * панель внутри: H1 (боевая), 3x-ui (запасной вариант) или мок.
 */
export interface PanelProvider {
  readonly kind: 'h1' | '3xui' | 'mock'
  /** Создать клиента или обновить существующего (срок, лимиты) и включить его. */
  provision(params: ProvisionParams): Promise<PanelClient>
  getClient(tgId: number): Promise<PanelClient | null>
  /** Отключить без удаления: ссылка перестаёт работать, данные остаются. */
  disable(tgId: number): Promise<void>
  remove(tgId: number): Promise<void>
}

export function clientName(tgId: number) {
  return `tg_${tgId}`
}
