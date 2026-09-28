import { useNavigate } from 'react-router-dom'
import { PageTitle, TopBar } from '@/components/ui'
import { DevicesIcon, PlusIcon } from '@/components/icons'
import { timeAgo } from '@/lib/format'
import { haptic } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

export default function DevicesPage() {
  const navigate = useNavigate()
  const { devices, profile } = useAppStore()
  const full = devices.length >= profile.devicesLimit

  const addDevice = () => {
    haptic('light')
    navigate('/connect')
  }

  return (
    <>
      <TopBar />
      <PageTitle
        title="Устройства"
        subtitle={`${devices.length} из ${profile.devicesLimit} · появляются автоматически после подключения`}
      />

      {devices.length === 0 ? (
        <div className="glass flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.07]">
            <DevicesIcon className="h-7 w-7 text-dim" />
          </span>
          <div className="mt-4 text-[17px] font-semibold">Пока нет устройств</div>
          <p className="mt-1.5 max-w-[260px] text-[14px] text-dim">
            Подключите телефон или компьютер — это займёт около минуты
          </p>
        </div>
      ) : (
        <div className="glass divide-y divide-white/[0.06] overflow-hidden">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-3.5 px-4 py-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.07]">
                <DevicesIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{d.label}</div>
                <div className="text-[13px] text-faint">
                  {d.platform} · {timeAgo(d.lastSeenAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={addDevice} disabled={full} className="btn-glass-strong mt-5 w-full">
        <PlusIcon className="h-5 w-5" />
        Подключить устройство
      </button>
      {full && (
        <p className="mt-3 text-center text-[12px] text-faint">Достигнут лимит тарифа — удалите устройство в приложении</p>
      )}
    </>
  )
}
