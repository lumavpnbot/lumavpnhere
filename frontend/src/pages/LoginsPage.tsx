import { useState } from 'react'
import Sheet from '@/components/Sheet'
import { PageTitle, TopBar } from '@/components/ui'
import { MailIcon, TelegramIcon } from '@/components/icons'
import { useT } from '@/i18n'
import { haptic, notify } from '@/lib/telegram'
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

  const openSheet = () => {
    haptic('light')
    setStep('email')
    setCode('')
    setOpen(true)
  }

  // TODO: POST /auth/email/start { email } → письмо с кодом; POST /auth/email/verify { email, code }.
  const sendCode = () => {
    haptic('medium')
    setStep('code')
  }

  const confirm = () => {
    haptic('success')
    setEmail(email.trim())
    setOpen(false)
    notify(t('logins.done'))
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
            <div className="truncate text-[13px] text-faint tabular-nums">{profile.tgId ?? '·'}</div>
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
            <button onClick={sendCode} disabled={!EMAIL_RE.test(email.trim())} className="btn-glass-strong mt-4 w-full">
              {t('logins.sendCode')}
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
            <button onClick={confirm} disabled={code.length !== 6} className="btn-glass-strong mt-4 w-full">
              {t('logins.confirm')}
            </button>
          </>
        )}
      </Sheet>
    </>
  )
}
