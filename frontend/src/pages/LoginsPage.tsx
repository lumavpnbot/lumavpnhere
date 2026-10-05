import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import Sheet from '@/components/Sheet'
import { PageTitle, TopBar } from '@/components/ui'
import { CheckIcon, LockIcon, MailIcon, ShieldIcon, TelegramIcon } from '@/components/icons'
import { useT } from '@/i18n'
import { haptic, notify } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const RESEND_SEC = 60

type Step = 'email' | 'code' | 'done'

/** Почта с замаскированным именем: an•••@gmail.com */
const maskEmail = (e: string) => {
  const [name, domain] = e.split('@')
  if (!domain) return e
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(4, name.length - 2)))}@${domain}`
}

export default function LoginsPage() {
  const t = useT()
  const profile = useAppStore((s) => s.profile)
  const setEmail = useAppStore((s) => s.setEmail)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('email')
  const [email, setEmailInput] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const [resendIn, setResendIn] = useState(0)
  const codeRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = window.setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => window.clearTimeout(id)
  }, [resendIn])

  useEffect(() => {
    if (step === 'code') window.setTimeout(() => codeRef.current?.focus(), 350)
  }, [step])

  const openSheet = () => {
    haptic('light')
    setStep('email')
    setEmailInput(profile.email ? '' : email)
    setCode('')
    setError(null)
    setOpen(true)
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      haptic('error')
      setShake((n) => n + 1)
      setError(err instanceof Error ? err.message : String(err))
      // Неверный код: стираем, чтобы ввести заново.
      if (step === 'code') {
        setCode('')
        codeRef.current?.focus()
      }
    } finally {
      setBusy(false)
    }
  }

  const valid = EMAIL_RE.test(email.trim())

  const sendCode = () =>
    run(async () => {
      haptic('medium')
      if (apiEnabled) await api.post('/auth/email/start', { email: email.trim() })
      setCode('')
      setStep('code')
      setResendIn(RESEND_SEC)
    })

  const confirm = (value = code) =>
    run(async () => {
      if (apiEnabled) await api.post('/auth/email/verify', { email: email.trim(), code: value })
      haptic('success')
      setEmail(email.trim().toLowerCase())
      setStep('done')
    })

  const onCode = (raw: string) => {
    const v = raw.replace(/\D/g, '').slice(0, 6)
    setCode(v)
    setError(null)
    if (v.length === 6 && !busy) void confirm(v)
  }

  return (
    <>
      <TopBar />
      <PageTitle title={t('logins.title')} subtitle={t('logins.subtitle')} />

      <div className="space-y-3">
        <div className="glass flex items-center gap-3.5 p-4">
          <span className="tile">
            <TelegramIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">Telegram</div>
            <div className="truncate text-[13px] text-faint tabular-nums">{profile.tgId ?? t('common.notSet')}</div>
          </div>
          <Connected label={t('common.connected')} />
        </div>

        {profile.email ? (
          <div className="glass flex items-center gap-3.5 p-4">
            <span className="tile">
              <MailIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-medium">{t('logins.email')}</span>
                <Connected label={t('logins.verified')} />
              </div>
              <div className="truncate text-[13px] text-faint">{profile.email}</div>
            </div>
            <button onClick={openSheet} className="btn-glass !h-9 shrink-0 !px-3.5 !text-[13px]">
              {t('logins.change')}
            </button>
          </div>
        ) : (
          <div className="glass glass-hero relative overflow-hidden p-5">
            <span aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(125,211,252,0.28),transparent_65%)]" />
            <div className="relative flex items-center gap-3.5">
              <span className="tile !h-12 !w-12 !rounded-[16px]">
                <MailIcon className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-semibold">{t('logins.heroTitle')}</div>
                <div className="text-[13px] text-dim">{t('logins.heroText')}</div>
              </div>
            </div>
            <ul className="relative mt-4 grid gap-2.5 border-t border-white/[0.07] pt-4">
              {(['logins.perk1', 'logins.perk2', 'logins.perk3'] as const).map((k, i) => (
                <li key={k} className="flex items-center gap-2.5 text-[13.5px] text-dim">
                  {i === 0 ? <LockIcon className="h-4 w-4 shrink-0 text-fg/70" /> : i === 1 ? <MailIcon className="h-4 w-4 shrink-0 text-fg/70" /> : <ShieldIcon className="h-4 w-4 shrink-0 text-fg/70" />}
                  {t(k)}
                </li>
              ))}
            </ul>
            <button onClick={openSheet} className="btn-glass-strong relative mt-5 w-full">
              {t('logins.connectEmail')}
            </button>
          </div>
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={step === 'done' ? undefined : profile.email && step === 'email' ? t('logins.changeTitle') : t('logins.emailTitle')}>
        <AnimatePresence mode="wait" initial={false}>
          {step === 'email' && (
            <m.div key="email" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
              <p className="mb-4 text-[14px] leading-snug text-dim">{t('logins.emailText')}</p>
              <m.div animate={{ x: shake ? [0, -8, 8, -5, 5, 0] : 0 }} transition={{ duration: 0.35 }} key={`e${shake}`} className="relative">
                <MailIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  placeholder={t('logins.emailPlaceholder')}
                  value={email}
                  onChange={(e) => {
                    setEmailInput(e.target.value)
                    setError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && valid && !busy && sendCode()}
                  className="field !pl-12"
                />
                {valid && <CheckIcon className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ok" strokeWidth={2.6} />}
              </m.div>
              {error && <p className="mt-3 px-1 text-[13px] text-bad">{error}</p>}
              <button onClick={sendCode} disabled={busy || !valid} className="btn-glass-strong mt-4 w-full">
                {busy ? <Spinner /> : t('logins.sendCode')}
              </button>
              <p className="mt-3 text-center text-[12px] text-faint">{t('logins.privacy')}</p>
            </m.div>
          )}

          {step === 'code' && (
            <m.div key="code" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.2 }}>
              <p className="mb-5 text-[14px] leading-snug text-dim">
                {t('logins.codeSent')} <span className="font-medium text-fg">{maskEmail(email.trim())}</span>
              </p>

              {/* 6 ячеек поверх одного настоящего поля: работает автоподстановка кода из письма. */}
              <m.label key={`c${shake}`} animate={{ x: shake ? [0, -10, 10, -6, 6, 0] : 0 }} transition={{ duration: 0.38 }} className="relative block">
                <input
                  ref={codeRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => onCode(e.target.value)}
                  className="absolute inset-0 h-full w-full opacity-0"
                  aria-label={t('logins.codeLabel')}
                />
                <div className="grid grid-cols-6 gap-2" aria-hidden>
                  {Array.from({ length: 6 }, (_, i) => {
                    const ch = code[i]
                    const active = i === Math.min(code.length, 5) && !busy
                    return (
                      <div
                        key={i}
                        className={`flex h-14 items-center justify-center rounded-[16px] text-[24px] font-semibold tabular-nums transition-colors ${
                          error ? 'bg-bad/10 ring-1 ring-bad/40' : active ? 'bg-white/[0.12] ring-1 ring-white/40' : ch ? 'bg-white/[0.09]' : 'bg-white/[0.05]'
                        }`}
                      >
                        {ch ?? (active ? <span className="h-6 w-[2px] animate-pulse rounded bg-white/70" /> : '')}
                      </div>
                    )
                  })}
                </div>
              </m.label>

              <div className="mt-3 min-h-[20px] px-1 text-center text-[13px]">
                {busy ? <span className="text-faint">{t('logins.checking')}</span> : error ? <span className="text-bad">{error}</span> : null}
              </div>

              <button onClick={() => confirm()} disabled={busy || code.length !== 6} className="btn-glass-strong mt-2 w-full">
                {busy ? <Spinner /> : t('logins.confirm')}
              </button>
              <div className="mt-4 flex items-center justify-between px-1 text-[13px]">
                <button
                  onClick={() => {
                    haptic('select')
                    setStep('email')
                    setError(null)
                  }}
                  className="text-faint"
                >
                  {t('logins.otherEmail')}
                </button>
                <button onClick={sendCode} disabled={busy || resendIn > 0} className="font-medium text-fg disabled:text-faint">
                  {resendIn > 0 ? t('logins.resendIn', { s: resendIn }) : t('logins.resend')}
                </button>
              </div>
              <p className="mt-4 text-center text-[12px] leading-snug text-faint">{t('logins.spamHint')}</p>
            </m.div>
          )}

          {step === 'done' && (
            <m.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center pb-2 pt-3 text-center">
              <m.span
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#0b0b0d] shadow-[0_0_40px_rgba(255,255,255,0.35)]"
              >
                <CheckIcon className="h-8 w-8" strokeWidth={2.6} />
              </m.span>
              <div className="mt-5 text-[22px] font-semibold">{t('logins.done')}</div>
              <p className="mt-1.5 max-w-[280px] text-[14px] text-dim">{t('logins.doneText', { email: email.trim().toLowerCase() })}</p>
              <button
                onClick={() => {
                  setOpen(false)
                  notify(t('logins.done'))
                }}
                className="btn-glass-strong mt-6 w-full"
              >
                {t('logins.great')}
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </Sheet>
    </>
  )
}

function Connected({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ok">
      <span className="h-1.5 w-1.5 rounded-full bg-ok" />
      {label}
    </span>
  )
}

function Spinner() {
  return <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
}
