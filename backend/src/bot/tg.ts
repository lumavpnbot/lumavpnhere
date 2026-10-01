/**
 * Минимальный клиент Telegram Bot API на fetch, без зависимостей.
 * Используется ботом (/start, админ-меню), уведомлениями и рассылками.
 */

export interface InlineButton {
  text: string
  callback_data?: string
  url?: string
  web_app?: { url: string }
}
export type InlineKeyboard = InlineButton[][]

export interface TgUser {
  id: number
  username?: string
  first_name?: string
}

export interface TgMessage {
  message_id: number
  chat: { id: number; type: string }
  from?: TgUser
  text?: string
  successful_payment?: {
    currency: string
    total_amount: number
    invoice_payload: string
    telegram_payment_charge_id: string
  }
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage }
  pre_checkout_query?: { id: string; from: TgUser; invoice_payload: string; total_amount: number; currency: string }
}

export class TgError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

export interface SendOptions {
  keyboard?: InlineKeyboard
  disablePreview?: boolean
}

/** Адрес Bot API. TELEGRAM_API_URL можно переопределить (локальный Bot API сервер или мок для тестов). */
export function telegramApiBase(env: NodeJS.ProcessEnv = process.env) {
  return (env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/+$/, '')
}

/** Telegram отвергает слишком длинный текст или битую HTML-разметку: такие ошибки лечим отправкой простым текстом. */
const isFormatError = (e: unknown) => e instanceof TgError && /too long|can't parse entities|unsupported start tag/i.test(e.message)

/** HTML → простой текст до лимита Telegram (4096 символов). */
export function plainText(html: string, max = 4000) {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function createTelegram(token: string, apiBase = telegramApiBase()) {
  const base = `${apiBase}/bot${token}`

  async function call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => ({ ok: false, description: res.statusText }))) as {
      ok: boolean
      result?: T
      description?: string
      error_code?: number
    }
    if (!data.ok) throw new TgError(data.error_code ?? res.status, `${method}: ${data.description ?? 'error'}`)
    return data.result as T
  }

  const markup = (keyboard?: InlineKeyboard) => (keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {})

  return {
    enabled: Boolean(token),
    call,

    async send(chatId: number | bigint | string, text: string, opts: SendOptions = {}) {
      const params = {
        // Строка — это @канал или числовой id канала из переменной окружения.
        chat_id: typeof chatId === 'string' && !/^-?\d+$/.test(chatId) ? chatId : Number(chatId),
        link_preview_options: { is_disabled: opts.disablePreview ?? true },
        ...markup(opts.keyboard),
      }
      try {
        return await call<TgMessage>('sendMessage', { ...params, text, parse_mode: 'HTML' })
      } catch (e) {
        if (!isFormatError(e)) throw e
        return call<TgMessage>('sendMessage', { ...params, text: plainText(text) })
      }
    },

    /** Правка сообщения меню. «message is not modified» не считаем ошибкой. */
    async edit(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard) {
      const params = { chat_id: chatId, message_id: messageId, link_preview_options: { is_disabled: true }, ...markup(keyboard) }
      try {
        await call('editMessageText', { ...params, text, parse_mode: 'HTML' })
      } catch (e) {
        if (e instanceof TgError && /not modified/.test(e.message)) return
        if (!isFormatError(e)) throw e
        await call('editMessageText', { ...params, text: plainText(text) }).catch((err: unknown) => {
          if (!(err instanceof TgError && /not modified/.test(err.message))) throw err
        })
      }
    },

    answerCallback(id: string, text?: string, alert = false) {
      return call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }).catch(() => undefined)
    },

    /** Отправка файла (CSV / XLSX / JSON) через multipart. */
    async sendDocument(chatId: number, filename: string, content: string | Buffer, caption?: string, mime = 'text/csv') {
      const form = new FormData()
      form.append('chat_id', String(chatId))
      if (caption) form.append('caption', caption)
      // CSV с BOM, чтобы Excel сразу открыл кириллицу.
      const body = typeof content === 'string' ? (mime === 'text/csv' ? `﻿${content}` : content) : new Uint8Array(content)
      form.append('document', new Blob([body], { type: mime }), filename)
      const res = await fetch(`${base}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) })
      const data = (await res.json()) as { ok: boolean; description?: string }
      if (!data.ok) throw new TgError(res.status, `sendDocument: ${data.description}`)
    },
  }
}

export type Telegram = ReturnType<typeof createTelegram>

/** Экранирование для parse_mode=HTML. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
