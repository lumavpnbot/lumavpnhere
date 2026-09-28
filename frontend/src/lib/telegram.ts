import WebApp from '@twa-dev/sdk'

/**
 * Обёртка над @twa-dev/sdk. Вся работа с Telegram WebApp API проходит
 * через этот модуль, чтобы не размазывать `window.Telegram.WebApp` по коду
 * и чтобы приложение не падало при открытии вне Telegram (например, в браузере
 * во время разработки).
 */

export function initTelegram() {
  try {
    WebApp.ready()
    WebApp.expand()
    WebApp.setHeaderColor('secondary_bg_color')
  } catch {
    // Открыто не в Telegram (локальная разработка в браузере) — не критично.
    console.warn('[telegram] WebApp API недоступен, работаем в standalone-режиме')
  }
}

export function getInitData(): string {
  return WebApp.initData ?? ''
}

export function haptic(style: 'light' | 'medium' | 'heavy' | 'success' | 'error' = 'light') {
  try {
    if (style === 'success' || style === 'error') {
      WebApp.HapticFeedback.notificationOccurred(style)
    } else {
      WebApp.HapticFeedback.impactOccurred(style)
    }
  } catch {
    /* no-op вне Telegram */
  }
}

export function getTelegramUser() {
  return WebApp.initDataUnsafe?.user ?? null
}

export { WebApp }
