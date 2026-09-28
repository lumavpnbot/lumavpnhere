import { useNavigate } from 'react-router-dom'
import { PageTitle, TopBar } from '@/components/ui'
import { DevicesIcon, PlusIcon } from '@/components/icons'
import { useLang, useT } from '@/i18n'
import { timeAgo } from '@/lib/format'
import { haptic } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

export default function DevicesPage() {
  const t = useT()
  const lang = useLang()
  const navigate = useNavigate()
  const devices = useAppStore((s) => s.devices)
  const limit = useAppStore((s) => s.profile.devicesLimit)
  const full = devices.length >= limit

  return (
    <>
      <TopBar />
      <PageTitle title={t('devices.title')} subtitle={t('devices.subtitle', { used: devices.length, limit })} />

      {devices.length === 0 ? (
        <div className="glass flex flex-col items-center px-6 py-12 text-center">
          <span className="tile !h-14 !w-14 !rounded-[18px]">
            <DevicesIcon className="h-7 w-7 text-dim" />
          </span>
          <div className="mt-4 text-[17px] font-semibold">{t('devices.empty')}</div>
          <p className="mt-1.5 max-w-[260px] text-[14px] text-dim">{t('devices.emptyText')}</p>
        </div>
      ) : (
        <div className="glass divide-y divide-white/[0.06] overflow-hidden">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-3.5 px-4 py-3.5">
              <span className="tile">
                <DevicesIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{d.label}</div>
                <div className="text-[13px] text-faint">
                  {d.platform}, {timeAgo(d.lastSeenAt, lang)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => {
          haptic('light')
          navigate('/connect')
        }}
        disabled={full}
        className="btn-glass-strong mt-5 w-full"
      >
        <PlusIcon className="h-5 w-5" />
        {t('devices.add')}
      </button>
      {full && <p className="mt-3 text-center text-[12px] text-faint">{t('devices.full')}</p>}
    </>
  )
}
