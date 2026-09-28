import type { ReactNode } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageTitle, TopBar } from '@/components/ui'
import { CheckIcon, CopyIcon, DownloadIcon, LinkIcon } from '@/components/icons'
import { CLIENT_APP } from '@/config'
import { copyText, haptic, openExternal, tg } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

/** Вложенный экран — нативная BackButton ведёт обратно в «Устройства». */
export default function ConnectPage() {
  const navigate = useNavigate()
  const subscription = useAppStore((s) => s.subscription)
  const subUrl = subscription.subscriptionUrl
  const [copied, setCopied] = useState(false)
  const isAndroid = tg?.platform === 'android'

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
      <PageTitle title="Подключение" subtitle={`Три шага — и VPN работает через ${CLIENT_APP.name}`} />

      {!subUrl ? (
        <div className="glass p-5">
          <div className="text-[16px] font-semibold">Сначала нужна подписка</div>
          <p className="mt-1.5 text-[14px] text-dim">Ссылка для подключения появится сразу после оформления.</p>
          <button onClick={() => navigate('/plans')} className="btn-glass-strong mt-4 w-full">
            Выбрать тариф
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <Step n={1} title={`Установите ${CLIENT_APP.name}`} text="Бесплатный клиент для iOS, Android и компьютера">
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => openExternal(isAndroid ? CLIENT_APP.android : CLIENT_APP.ios)}
                className="btn-glass !h-11 !text-[14px]"
              >
                <DownloadIcon className="h-4 w-4" />
                {isAndroid ? 'Google Play' : 'App Store'}
              </button>
              <button onClick={() => openExternal(CLIENT_APP.site)} className="btn-glass !h-11 !text-[14px]">
                Все платформы
              </button>
            </div>
          </Step>

          <Step n={2} title="Добавьте подписку" text={`Откроется ${CLIENT_APP.name} и сам добавит ваш профиль`}>
            <button onClick={() => openExternal(CLIENT_APP.deeplink(subUrl))} className="btn-glass-strong mt-4 w-full">
              <LinkIcon className="h-5 w-5" />
              Открыть в {CLIENT_APP.name}
            </button>
            <button onClick={copy} className="btn-glass mt-2 w-full !h-11 !text-[14px]">
              {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
              {copied ? 'Скопировано' : 'Скопировать ссылку вручную'}
            </button>
          </Step>

          <Step n={3} title="Включите VPN" text="Нажмите кнопку подключения в приложении — устройство появится в списке" />
        </div>
      )}
    </>
  )
}

function Step({ n, title, text, children }: { n: number; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="glass p-5">
      <div className="flex gap-3.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.1] text-[13px] font-semibold tabular-nums">
          {n}
        </span>
        <div className="min-w-0">
          <div className="text-[16px] font-semibold">{title}</div>
          <div className="mt-0.5 text-[14px] text-dim">{text}</div>
        </div>
      </div>
      {children}
    </div>
  )
}
