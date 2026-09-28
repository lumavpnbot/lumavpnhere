import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageTitle, TopBar } from '@/components/ui'
import { CheckIcon, CopyIcon, DownloadIcon, LinkIcon } from '@/components/icons'
import { CLIENT_APP } from '@/config'
import { useT } from '@/i18n'
import { copyText, haptic, openExternal, tg } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

/** Вложенный экран: Back ведёт в «Устройства». */
export default function ConnectPage() {
  const t = useT()
  const navigate = useNavigate()
  const subUrl = useAppStore((s) => s.subscription.subscriptionUrl)
  const happUrl = useAppStore((s) => s.subscription.happUrl)
  const [copied, setCopied] = useState(false)
  const isAndroid = tg?.platform === 'android'
  const app = CLIENT_APP.name

  const copy = async () => {
    if (!subUrl) return
    const ok = await copyText(subUrl)
    haptic(ok ? 'success' : 'error')
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <>
      <TopBar />
      <PageTitle title={t('connect.title')} subtitle={t('connect.subtitle', { app })} />

      {!subUrl ? (
        <div className="glass p-5">
          <div className="text-[16px] font-semibold">{t('connect.needSub')}</div>
          <p className="mt-1.5 text-[14px] text-dim">{t('connect.needSubText')}</p>
          <button onClick={() => navigate('/plans', { replace: true })} className="btn-glass-strong mt-4 w-full">
            {t('home.choose')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <Step n={1} title={t('connect.s1', { app })} text={t('connect.s1text')}>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => openExternal(isAndroid ? CLIENT_APP.android : CLIENT_APP.ios)}
                className="btn-glass !h-11 !px-3 !text-[14px]"
              >
                <DownloadIcon className="h-4 w-4" />
                {isAndroid ? 'Google Play' : 'App Store'}
              </button>
              <button onClick={() => openExternal(CLIENT_APP.site)} className="btn-glass !h-11 !px-3 !text-[14px]">
                {t('connect.otherOs')}
              </button>
            </div>
          </Step>

          <Step n={2} title={t('connect.s2')} text={t('connect.s2text', { app })}>
            <button onClick={() => openExternal(happUrl ?? CLIENT_APP.deeplink(subUrl))} className="btn-glass-strong mt-4 w-full">
              <LinkIcon className="h-5 w-5" />
              {t('connect.open', { app })}
            </button>
            <button onClick={copy} className="btn-glass mt-2 w-full !h-11 !text-[14px]">
              {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
              {copied ? t('common.copied') : t('connect.copyManual')}
            </button>
          </Step>

          <Step n={3} title={t('connect.s3')} text={t('connect.s3text')} />
        </div>
      )}
    </>
  )
}

function Step({ n, title, text, children }: { n: number; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="glass p-5">
      <div className="flex gap-3.5">
        <span className="tile !h-8 !w-8 !rounded-[10px] text-[13px] font-semibold tabular-nums">{n}</span>
        <div className="min-w-0">
          <div className="text-[16px] font-semibold">{title}</div>
          <div className="mt-0.5 text-[14px] text-dim">{text}</div>
        </div>
      </div>
      {children}
    </div>
  )
}
