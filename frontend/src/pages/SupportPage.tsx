import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Sheet from '@/components/Sheet'
import { PageTitle, Section, StatusPill, TopBar } from '@/components/ui'
import { ChatIcon, ChevronDown, TelegramIcon } from '@/components/icons'
import { BOT_USERNAME } from '@/config'
import { useLang, useT } from '@/i18n'
import { timeAgo } from '@/lib/format'
import { haptic, notify, openExternal } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'

interface Ticket {
  id: string
  subject: string
  status: 'open' | 'answered' | 'closed'
  updatedAt: string
  messages: { id: string; fromStaff: boolean; text: string; at: string }[]
}

/** Поддержка: обращения прямо из приложения, ответы приходят и сюда, и в чат с ботом. */
export default function SupportPage() {
  const t = useT()
  const lang = useLang()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(apiEnabled)
  const [composer, setComposer] = useState<{ ticketId?: string } | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!apiEnabled) return
    try {
      const r = await api.get<{ tickets: Ticket[] }>('/support/tickets')
      setTickets(r.tickets)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const send = async () => {
    if (text.trim().length < 3) return
    haptic('medium')
    if (!apiEnabled) {
      notify(t('common.demoPay'))
      return
    }
    setSending(true)
    try {
      const r = await api.post<{ ticketId: string }>('/support/ticket', { text: text.trim(), ticketId: composer?.ticketId })
      setText('')
      setComposer(null)
      setOpenId(r.ticketId)
      haptic('success')
      await load()
    } catch (err) {
      haptic('error')
      notify(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const statusTone = (s: Ticket['status']) => (s === 'answered' ? 'ok' : s === 'open' ? 'warn' : 'muted')

  return (
    <>
      <TopBar />
      <PageTitle title={t('support.title')} subtitle={t('support.subtitle')} />

      <div className="glass glass-hero relative overflow-hidden p-5">
        <div aria-hidden="true" className="pointer-events-none absolute -left-16 -top-20 h-48 w-48 rounded-full bg-white/[0.08] blur-2xl" />
        <div className="relative flex items-center gap-4">
          <span className="tile !h-14 !w-14 !rounded-[18px]">
            <ChatIcon className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <div className="text-[18px] font-semibold">{t('support.heroTitle')}</div>
            <div className="mt-0.5 text-[13px] text-dim">{t('support.heroText')}</div>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              haptic('light')
              setComposer({})
            }}
            className="btn-glass-strong !h-12 !px-3 !text-[14px]"
          >
            {t('support.new')}
          </button>
          <button onClick={() => openExternal(`https://t.me/${BOT_USERNAME}`)} className="btn-glass !h-12 !px-3 !text-[14px]">
            <TelegramIcon className="h-[18px] w-[18px]" />
            {t('support.chat')}
          </button>
        </div>
      </div>

      <Section title={t('support.mine')}>
        {loading ? (
          <div className="glass flex justify-center py-8">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="glass px-5 py-8 text-center">
            <div className="text-[15px] font-medium">{t('support.emptyTitle')}</div>
            <p className="mt-1 text-[13px] text-faint">{t('support.emptyText')}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {tickets.map((tk) => {
              const open = openId === tk.id
              return (
                <div key={tk.id} className="glass overflow-hidden">
                  <button
                    onClick={() => {
                      haptic('select')
                      setOpenId(open ? null : tk.id)
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium tabular-nums text-faint">#{tk.id}</span>
                        <StatusPill tone={statusTone(tk.status)}>{t(`support.status.${tk.status}`)}</StatusPill>
                      </div>
                      <div className="mt-1.5 truncate text-[15px] font-medium">{tk.subject}</div>
                      <div className="text-[12.5px] text-faint">{timeAgo(tk.updatedAt, lang)}</div>
                    </div>
                    <ChevronDown className="h-5 w-5 shrink-0 text-dim transition-transform duration-300" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 border-t border-white/[0.06] px-4 py-4">
                          {tk.messages.map((m) => (
                            <div key={m.id} className={`flex ${m.fromStaff ? 'justify-start' : 'justify-end'}`}>
                              <div
                                className={`max-w-[85%] rounded-[18px] px-3.5 py-2.5 text-[14px] leading-snug ${
                                  m.fromStaff ? 'rounded-bl-md bg-white/[0.08] text-fg' : 'rounded-br-md bg-white/[0.18] text-fg'
                                }`}
                              >
                                {m.fromStaff && <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-dim">{t('support.team')}</div>}
                                <div className="whitespace-pre-wrap break-words">{m.text}</div>
                                <div className="mt-1 text-right text-[11px] text-faint">{timeAgo(m.at, lang)}</div>
                              </div>
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              haptic('light')
                              setComposer({ ticketId: tk.id })
                            }}
                            className="btn-glass mt-2 w-full !h-11 !text-[14px]"
                          >
                            {tk.status === 'closed' ? t('support.reopen') : t('support.reply')}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Sheet open={composer !== null} onClose={() => setComposer(null)} title={composer?.ticketId ? t('support.replyTitle', { id: composer.ticketId }) : t('support.newTitle')}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={3000}
          placeholder={t('support.placeholder')}
          className="field !h-auto resize-none py-3.5 leading-snug"
        />
        <p className="mt-2 px-1 text-[12px] text-faint">{t('support.hint')}</p>
        <button onClick={send} disabled={sending || text.trim().length < 3} className="btn-glass-strong mt-5 w-full">
          {sending ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : t('support.send')}
        </button>
      </Sheet>
    </>
  )
}
