import { recordError } from '@/lib/errors'
import { DEFAULT_SETTINGS, type AppSettings } from '@/services/settings'
import { CAPTION_LIMIT, plainText, type InlineKeyboard, type Telegram } from './tg'

/**
 * Приветствие /start: текст или фото/видео/GIF с подписью (настраивается в /admin → Настройки).
 * Подпись длиннее лимита Telegram уходит отдельным сообщением под картинкой. Если картинку
 * отправить не удалось (например, сменили бота и file_id устарел), приходит только текст.
 */
export async function sendWelcome(tg: Telegram, chatId: number, s: AppSettings, opts: { extra?: string; keyboard?: InlineKeyboard } = {}) {
  // Пустое приветствие Telegram не отправит, и /start молча перестал бы отвечать.
  const text = (s.welcomeMessage.trim() || (s.welcomeMedia ? '' : DEFAULT_SETTINGS.welcomeMessage)) + (opts.extra ?? '')
  if (s.welcomeMedia) {
    try {
      if (plainText(text, Infinity).length <= CAPTION_LIMIT) return await tg.sendMedia(chatId, s.welcomeMedia, text.trim(), { keyboard: opts.keyboard })
      await tg.sendMedia(chatId, s.welcomeMedia)
    } catch (err) {
      recordError('welcome media', err)
    }
  }
  return tg.send(chatId, text.trim() || DEFAULT_SETTINGS.welcomeMessage, { keyboard: opts.keyboard })
}
