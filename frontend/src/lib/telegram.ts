/**
 * Тонкая типизированная обёртка над window.Telegram.WebApp.
 *
 * Специально без @twa-dev/sdk: его типы отстают от Bot API (fullscreen,
 * safe-area появились в 8.0), а скрипт telegram-web-app.js и так подключён
 * в index.html. Все новые методы вызываются через feature-detect — старые
 * клиенты Telegram их просто не имеют.
 */

type HapticImpact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'

export interface TgUser {
  id: number
  username?: string
  first_name?: string
  last_name?: string
  photo_url?: string
  language_code?: string
}

interface TgBackButton {
  show(): void
  hide(): void
  onClick(cb: () => void): void
  offClick(cb: () => void): void
}

interface TgWebApp {
  initData: string
  initDataUnsafe: { user?: TgUser; start_param?: string }
  platform: string
  version: string
  isFullscreen?: boolean
  ready(): void
  expand(): void
  isVersionAtLeast?(version: string): boolean
  requestFullscreen?(): void
  disableVerticalSwipes?(): void
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  setBottomBarColor?(color: string): void
  onEvent?(event: string, cb: () => void): void
  openLink?(url: string): void
  openTelegramLink?(url: string): void
  showAlert?(message: string): void
  showConfirm?(message: string, cb: (ok: boolean) => void): void
  openInvoice?(url: string, cb?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void
  BackButton?: TgBackButton
  HapticFeedback?: {
    impactOccurred(style: HapticImpact): void
    notificationOccurred(type: 'success' | 'error' | 'warning'): void
    selectionChanged(): void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp }
  }
}

export const tg: TgWebApp | undefined = window.Telegram?.WebApp

/** Вне Telegram скрипт всё равно создаёт WebApp, но с platform = 'unknown'. */
export const inTelegram = !!tg && tg.platform !== 'unknown'

const BG = '#030304'

function atLeast(version: string) {
  return !!tg?.isVersionAtLeast?.(version)
}

function syncFullscreenClass() {
  document.documentElement.classList.toggle('tg-fullscreen', !!tg?.isFullscreen)
}

export function initTelegram() {
  if (!tg) return
  try {
    tg.ready()
    tg.expand()

    if (atLeast('6.1')) {
      tg.setHeaderColor?.(BG)
      tg.setBackgroundColor?.(BG)
    }
    if (atLeast('7.10')) tg.setBottomBarColor?.(BG)

    // Свайп вниз по контенту не должен закрывать мини-апп (Bot API 7.7+).
    if (atLeast('7.7')) tg.disableVerticalSwipes?.()

    // Edge-to-edge как в CallLedger — только на телефонах, на десктопе
    // fullscreen разворачивает окно на весь монитор, это лишнее.
    if (atLeast('8.0') && (tg.platform === 'ios' || tg.platform === 'android')) {
      tg.requestFullscreen?.()
    }
    syncFullscreenClass()
    tg.onEvent?.('fullscreenChanged', syncFullscreenClass)
  } catch (err) {
    console.warn('[telegram] init failed', err)
  }
}

export function getInitData(): string {
  return tg?.initData ?? ''
}

export function getTelegramUser(): TgUser | null {
  return tg?.initDataUnsafe?.user ?? null
}

export function haptic(style: HapticImpact | 'success' | 'error' | 'select' = 'light') {
  const h = tg?.HapticFeedback
  if (!h) return
  try {
    if (style === 'success' || style === 'error') h.notificationOccurred(style)
    else if (style === 'select') h.selectionChanged()
    else h.impactOccurred(style)
  } catch {
    /* no-op */
  }
}

/** Нативная кнопка Back есть только внутри Telegram 6.1+. */
export const nativeBack: TgBackButton | null = inTelegram && atLeast('6.1') && tg?.BackButton ? tg.BackButton : null

export function openExternal(url: string) {
  // Свои схемы (happ://…) Telegram-методы не открывают — только через location.
  if (!/^https?:\/\//.test(url)) window.location.href = url
  else if (inTelegram && url.startsWith('https://t.me/')) tg?.openTelegramLink?.(url)
  else if (inTelegram && tg?.openLink) tg.openLink(url)
  else window.open(url, '_blank', 'noopener')
}

export function notify(message: string) {
  if (inTelegram && tg?.showAlert) tg.showAlert(message)
  else window.alert(message)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Некоторые WebView Telegram не дают Clipboard API — старый путь.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}

export type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending'

/** Оплата Telegram Stars: открывает нативное окно счёта (Bot API 6.1+). */
export function openInvoice(url: string): Promise<InvoiceStatus> {
  return new Promise((resolve) => {
    if (inTelegram && tg?.openInvoice) tg.openInvoice(url, (status) => resolve(status))
    else {
      window.open(url, '_blank', 'noopener')
      resolve('pending')
    }
  })
}

/** Подтверждение: нативное окно Telegram, вне Telegram обычный confirm. */
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (inTelegram && tg?.showConfirm) tg.showConfirm(message, resolve)
    else resolve(window.confirm(message))
  })
}
