import { useState } from 'react'
import Sheet from '@/components/Sheet'
import { PageTitle, TopBar } from '@/components/ui'
import { MailIcon, TelegramIcon } from '@/components/icons'
import { useT } from '@/i18n'
import { haptic, notify } from '@/lib/telegram'
import { api, apiEnabled } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function LoginsPage() {
  const t = useT()
  const profile = useAppStore((s) => s.profile)
  const setEmail = useAppStore((s) => s.setEmail)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmailInput] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openSheet = () => {
    haptic('light')
    setStep('email')
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
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      haptic('medium')
      if (apiEnabled) await api.post('/auth/email/start', { email: email.trim() })
      setStep('code')
    })

  const confirm = () =>
    run(async () => {
      if (apiEnabled) await api.post('/auth/email/verify', { email: email.trim(), code })
      haptic('success')
      setEmail(email.trim().toLowerCase())
      setOpen(false)
      notify(t('logins.done'))
    })

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
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            {t('common.connected')}
          </span>
        </div>

        <div className="glass flex items-center gap-3.5 p-4">
          <span className="tile">
            <MailIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">{t('logins.email')}</div>
            {profile.email && <div className="truncate text-[13px] text-faint">{profile.email}</div>}
          </div>
          {profile.email ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              {t('common.connected')}
            </span>
          ) : (
            <button onClick={openSheet} className="btn-glass-strong !h-10 !px-4 !text-[14px]">
              {t('logins.connect')}
            </button>
          )}
        </div>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('logins.emailTitle')}>
        {step === 'email' ? (
          <>
            <p className="mb-4 text-[14px] leading-snug text-dim">{t('logins.emailText')}</p>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t('logins.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmailInput(e.target.value)}
              className="field"
            />
            {error && <p className="mt-3 px-1 text-[13px] text-bad">{error}</p>}
            <button onClick={sendCode} disabled={busy || !EMAIL_RE.test(email.trim())} className="btn-glass-strong mt-4 w-full">
              {busy ? <Spinner /> : t('logins.sendCode')}
            </button>
          </>
        ) : (
          <>
            <p className="mb-4 text-[14px] leading-snug text-dim">{t('logins.codeText', { email: email.trim() })}</p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="field text-center !text-[22px] font-semibold tracking-[0.4em]"
            />
            {error && <p className="mt-3 px-1 text-[13px] text-bad">{error}</p>}
            <button onClick={confirm} disabled={busy || code.length !== 6} className="btn-glass-strong mt-4 w-full">
              {busy ? <Spinner /> : t('logins.confirm')}
            </button>
            <button onClick={sendCode} disabled={busy} className="mt-3 w-full text-center text-[13px] text-faint">
              {t('logins.resend')}
            </button>
          </>
        )}
      </Sheet>
    </>
  )
}

function Spinner() {
  return <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
}
