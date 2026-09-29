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

export function createTelegram(token: string) {
  const base = `https://api.telegram.org/bot${token}`

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

    send(chatId: number | bigint, text: string, opts: SendOptions = {}) {
      return call<TgMessage>('sendMessage', {
        chat_id: Number(chatId),
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: opts.disablePreview ?? true },
        ...markup(opts.keyboard),
      })
    },

    /** Правка сообщения меню. «message is not modified» не считаем ошибкой. */
    async edit(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard) {
      try {
        await call('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...markup(keyboard),
        })
      } catch (e) {
        if (!(e instanceof TgError && /not modified/.test(e.message))) throw e
      }
    },

    answerCallback(id: string, text?: string, alert = false) {
      return call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }).catch(() => undefined)
    },

    /** Отправка файла (CSV-экспорт) через multipart. */
    async sendDocument(chatId: number, filename: string, content: string, caption?: string) {
      const form = new FormData()
      form.append('chat_id', String(chatId))
      if (caption) form.append('caption', caption)
      form.append('document', new Blob([content], { type: 'text/csv' }), filename)
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
