import { useNavigate } from 'react-router-dom'
import { useT } from '@/i18n'
import { haptic } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'
import { ChevronRight, PulseIcon } from './icons'

const TONE = { ok: 'bg-ok', degraded: 'bg-warn', down: 'bg-bad' } as const

/** Виджет статуса сверху главного экрана (ТЗ 02): общий статус, тап открывает «Статус сервиса». */
export default function StatusWidget() {
  const t = useT()
  const navigate = useNavigate()
  const status = useAppStore((s) => s.status)
  const online = status?.nodes.filter((n) => n.online).length ?? 0
  const incident = status?.openIncidents[0]

  return (
    <button
      onClick={() => {
        haptic('light')
        navigate('/status')
      }}
      className="glass press mb-3 flex w-full items-center gap-3 !rounded-2xl px-4 py-3 text-left"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {status && status.overall !== 'ok' && <span className={`absolute inset-0 animate-ping rounded-full opacity-60 ${TONE[status.overall]}`} />}
        <span className={`relative h-2.5 w-2.5 rounded-full ${status ? TONE[status.overall] : 'bg-faint'}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{status ? t(`status.${status.overall}`) : t('status.unknown')}</span>
        <span className="block truncate text-[12px] text-faint">
          {incident ? incident.title : status ? t('status.widgetOk', { n: online, total: status.nodes.length }) : ' '}
        </span>
      </span>
      <PulseIcon className="h-4 w-4 shrink-0 text-dim" />
      <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
    </button>
  )
}
