/**
 * Минимальный клиент Telegram Bot API на fetch, без зависимостей.
 * Используется ботом (/start, админ-меню), уведомлениями и рассылками.
 */

export interface InlineButton {
  text: string
  callback_data?: string
  url?: string
  web_app?: { url: string }
  /** Премиум-эмодзи перед текстом кнопки (Bot API 9.4, нужен Telegram Premium у владельца бота). */
  icon_custom_emoji_id?: string
  style?: 'primary' | 'success' | 'danger'
}
export type InlineKeyboard = InlineButton[][]

export interface TgUser {
  id: number
  username?: string
  first_name?: string
}

/** Разметка сообщения: жирный, ссылки, премиум-эмодзи (custom_emoji) и т.д. Смещения в UTF-16, как в JS. */
export interface TgEntity {
  type: string
  offset: number
  length: number
  url?: string
  user?: { id: number }
  language?: string
  custom_emoji_id?: string
}

export interface TgMessage {
  message_id: number
  chat: { id: number; type: string }
  from?: TgUser
  text?: string
  entities?: TgEntity[]
  /** Фото (несколько размеров, последний самый большой), видео, GIF и подпись к ним. */
  photo?: { file_id: string; width: number; height: number }[]
  video?: { file_id: string }
  animation?: { file_id: string }
  caption?: string
  caption_entities?: TgEntity[]
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

/** Картинка к сообщению: file_id из Telegram (принадлежит этому боту). */
export interface TgMedia {
  type: 'photo' | 'video' | 'animation'
  fileId: string
}

/** Фото / видео / GIF из сообщения (у фото берём самый большой размер). */
export function mediaOf(msg: TgMessage): TgMedia | null {
  if (msg.photo?.length) return { type: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id }
  if (msg.animation) return { type: 'animation', fileId: msg.animation.file_id }
  if (msg.video) return { type: 'video', fileId: msg.video.file_id }
  return null
}

/** Лимит подписи к фото/видео у ботов (символов после разметки). */
export const CAPTION_LIMIT = 1024

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

const attr = (v: unknown) => esc(v).replace(/"/g, '&quot;')

function entityTags(e: TgEntity): [string, string] | null {
  switch (e.type) {
    case 'bold': return ['<b>', '</b>']
    case 'italic': return ['<i>', '</i>']
    case 'underline': return ['<u>', '</u>']
    case 'strikethrough': return ['<s>', '</s>']
    case 'spoiler': return ['<tg-spoiler>', '</tg-spoiler>']
    case 'code': return ['<code>', '</code>']
    case 'pre': return e.language ? [`<pre><code class="language-${attr(e.language)}">`, '</code></pre>'] : ['<pre>', '</pre>']
    case 'text_link': return e.url ? [`<a href="${attr(e.url)}">`, '</a>'] : null
    case 'text_mention': return e.user ? [`<a href="tg://user?id=${e.user.id}">`, '</a>'] : null
    case 'custom_emoji': return e.custom_emoji_id ? [`<tg-emoji emoji-id="${attr(e.custom_emoji_id)}">`, '</tg-emoji>'] : null
    case 'blockquote': return ['<blockquote>', '</blockquote>']
    case 'expandable_blockquote': return ['<blockquote expandable>', '</blockquote>']
    default: return null // url, mention, hashtag… Telegram распознаёт сам
  }
}

/**
 * Текст сообщения + entities → HTML для parse_mode=HTML. Так сохраняются премиум-эмодзи
 * (<tg-emoji>) и форматирование, сделанное средствами Telegram.
 * escapeText=false: остальной текст не экранируем (поля, куда админ пишет HTML руками).
 */
export function entitiesToHtml(text: string, entities: TgEntity[] = [], escapeText = true): string {
  const starts = new Map<number, { e: TgEntity; i: number; tags: [string, string] }[]>()
  const ends = new Map<number, { e: TgEntity; i: number; tags: [string, string] }[]>()
  entities.forEach((e, i) => {
    const tags = entityTags(e)
    if (!tags || e.length <= 0) return
    const item = { e, i, tags }
    starts.set(e.offset, [...(starts.get(e.offset) ?? []), item])
    ends.set(e.offset + e.length, [...(ends.get(e.offset + e.length) ?? []), item])
  })
  let out = ''
  for (let pos = 0; pos <= text.length; pos++) {
    // Сначала закрываем вложенные (начались позже), потом открываем внешние (длиннее).
    for (const x of (ends.get(pos) ?? []).sort((a, b) => b.e.offset - a.e.offset || b.i - a.i)) out += x.tags[1]
    for (const x of (starts.get(pos) ?? []).sort((a, b) => b.e.length - a.e.length || a.i - b.i)) out += x.tags[0]
    if (pos < text.length) out += escapeText ? esc(text[pos]) : text[pos]
  }
  return out
}

/** Премиум-эмодзи → обычные (их символы внутри <tg-emoji>). */
export const stripPremiumEmoji = (html: string) => html.replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/g, '$1')
const hasPremium = (text: string, kb?: InlineKeyboard) => /<tg-emoji/.test(text) || !!kb?.some((r) => r.some((b) => b.icon_custom_emoji_id))
const stripIcons = (kb?: InlineKeyboard) => kb?.map((r) => r.map(({ icon_custom_emoji_id: _, ...b }) => b))

/**
 * Отправка с запасными вариантами: премиум-эмодзи работают, только если у владельца бота
 * Telegram Premium, иначе повторяем с обычными эмодзи. Битая разметка: простым текстом.
 */
async function withFallbacks<T>(text: string, kb: InlineKeyboard | undefined, attempt: (text: string, kb: InlineKeyboard | undefined, html: boolean) => Promise<T>): Promise<T> {
  try {
    return await attempt(text, kb, true)
  } catch (e) {
    if (e instanceof TgError && e.code === 400 && !isFormatError(e) && hasPremium(text, kb)) {
      return withFallbacks(stripPremiumEmoji(text), stripIcons(kb), attempt)
    }
    if (!isFormatError(e)) throw e
    return attempt(plainText(text), kb, false)
  }
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
      }
      return withFallbacks(text, opts.keyboard, (t, kb, html) =>
        call<TgMessage>('sendMessage', { ...params, ...markup(kb), text: t, ...(html ? { parse_mode: 'HTML' } : {}) }),
      )
    },

    /** Фото / видео / GIF с подписью (HTML) и кнопками. */
    async sendMedia(chatId: number | bigint, media: TgMedia, caption = '', opts: SendOptions = {}) {
      const method = media.type === 'photo' ? 'sendPhoto' : media.type === 'video' ? 'sendVideo' : 'sendAnimation'
      const params = { chat_id: Number(chatId), [media.type]: media.fileId }
      return withFallbacks(caption, opts.keyboard, (t, kb, html) =>
        call<TgMessage>(method, { ...params, ...markup(kb), ...(t ? { caption: t, ...(html ? { parse_mode: 'HTML' } : {}) } : {}) }),
      )
    },

    /** Правка сообщения меню. «message is not modified» не считаем ошибкой. */
    async edit(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard) {
      const params = { chat_id: chatId, message_id: messageId, link_preview_options: { is_disabled: true } }
      await withFallbacks(text, keyboard, (t, kb, html) =>
        call('editMessageText', { ...params, ...markup(kb), text: t, ...(html ? { parse_mode: 'HTML' } : {}) }).catch((err: unknown) => {
          if (!(err instanceof TgError && /not modified/.test(err.message))) throw err
        }),
      )
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
