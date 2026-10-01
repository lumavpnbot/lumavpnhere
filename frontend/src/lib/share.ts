import { api, apiEnabled } from './api'
import { openExternal, shareMessage } from './telegram'

/**
 * «Поделиться ссылкой на бота». В новом Telegram (Bot API 8.0) — нативное окно
 * shareMessage: бот готовит сообщение, Telegram сообщает, отправлено ли оно, и
 * тогда засчитывается бейдж «Шеринг». В старых клиентах — обычная ссылка t.me/share
 * (бейдж засчитается, когда по ссылке кто-то придёт).
 * Возвращает true, если бейдж засчитан сразу.
 */
export async function shareReferral(fallbackLink: string, text: string): Promise<boolean> {
  if (apiEnabled) {
    const prepared = await api.post<{ id: string | null; link: string }>('/api/achievements/share/prepare').catch(() => null)
    if (prepared?.id) {
      const sent = await shareMessage(prepared.id)
      if (sent) {
        const r = await api.post<{ unlocked: boolean }>('/api/achievements/share', { preparedId: prepared.id }).catch(() => null)
        return Boolean(r)
      }
      if (sent === false) return false
    }
    fallbackLink = prepared?.link ?? fallbackLink
  }
  openExternal(`https://t.me/share/url?url=${encodeURIComponent(fallbackLink)}&text=${encodeURIComponent(text)}`)
  return false
}
