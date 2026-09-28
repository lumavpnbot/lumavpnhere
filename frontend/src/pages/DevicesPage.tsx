import { useAppStore } from '@/store/useAppStore'

export default function DevicesPage() {
  const { profile } = useAppStore()
  const used = profile?.devicesUsed ?? 0

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-1 text-xl font-bold">Устройства</h1>
      <p className="mb-6 text-sm text-text-dim">
        {used} из {profile?.devicesLimit ?? 5}
      </p>

      {used === 0 ? (
        <div className="flex flex-col items-center rounded-card border border-border bg-surface px-6 py-12 text-center">
          <div className="mb-3 text-text-dim">Нет устройств</div>
          <p className="text-xs text-text-dim">
            Подключитесь через VPN-клиент — устройство появится автоматически
          </p>
        </div>
      ) : (
        <div className="space-y-2">{/* список устройств из /me/devices */}</div>
      )}
    </div>
  )
}
