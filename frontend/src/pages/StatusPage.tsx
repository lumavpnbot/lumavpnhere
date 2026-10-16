import { useEffect } from 'react'
import Flag from '@/components/Flag'
import { PageTitle, Section, StatusPill, TopBar } from '@/components/ui'
import { LinkIcon } from '@/components/icons'
import type { CountryCode } from '@/config'
import { useLang, useT, type TKey } from '@/i18n'
import { API_BASE, apiEnabled } from '@/lib/api'
import { openExternal } from '@/lib/telegram'
import { useAppStore, type StatusNode } from '@/store/useAppStore'

// Полные имена классов: Tailwind не видит собранные из кусков (`bg-${…}`).
const DOT = { ok: 'bg-ok text-ok', degraded: 'bg-warn text-warn', down: 'bg-bad text-bad' } as const

/** ТЗ 02: текущий статус, серверы с пингом и uptime за 30 дней, график по часам, инциденты. */
export default function StatusPage() {
  const t = useT()
  const lang = useLang()
  const status = useAppStore((s) => s.status)
  const loadStatus = useAppStore((s) => s.loadStatus)

  // Автообновление каждые 60 секунд, пока экран открыт.
  useEffect(() => {
    void loadStatus()
    const timer = window.setInterval(() => void loadStatus(), 60_000)
    return () => window.clearInterval(timer)
  }, [loadStatus])

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <TopBar />
      <PageTitle title={t('status.title')} subtitle={t('status.subtitle')} />

      <div className="glass glass-hero p-5">
        {status ? (
          <>
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full shadow-[0_0_14px_currentColor] ${DOT[status.overall]}`} />
              <span className="text-[20px] font-semibold">{t(`status.${status.overall}`)}</span>
            </div>
            {status.eta && <p className="mt-2 text-[14px] text-dim">{t('status.eta', { date: fmt(status.eta) })}</p>}
            {status.openIncidents.map((i) => (
              <div key={i.id} className="mt-3 rounded-2xl bg-white/[0.05] px-4 py-3">
                <div className={`text-[14px] font-semibold ${i.severity === 'major' ? 'text-bad' : 'text-warn'}`}>{i.title}</div>
                {i.text && <div className="mt-0.5 text-[13px] text-dim">{i.text}</div>}
                <div className="mt-1 text-[12px] text-faint">
                  {fmt(i.startedAt)} · {t('status.ongoing')}
                </div>
              </div>
            ))}
            <div className="mt-3 text-[12px] text-faint">{fmt(status.updatedAt)}</div>
          </>
        ) : (
          <div className="flex items-center gap-3 text-dim">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-white" />
            {t('status.unknown')}
          </div>
        )}
      </div>

      <Section title={t('status.servers')}>
        <div className="glass divide-y divide-white/[0.06] overflow-hidden">
          {(status?.nodes ?? []).map((n) => (
            <NodeRow key={n.id} node={n} />
          ))}
          {status && !status.nodes.length && <div className="px-5 py-6 text-center text-[14px] text-faint">{t('status.noData')}</div>}
        </div>
        <p className="mt-2.5 px-1 text-[12px] text-faint">{t('status.last24')}</p>
      </Section>

      <Section title={t('status.incidents')}>
        <div className="glass divide-y divide-white/[0.06] overflow-hidden">
          {(status?.incidents ?? []).length === 0 ? (
            <div className="px-5 py-6 text-center text-[14px] text-faint">{t('status.noIncidents')}</div>
          ) : (
            status!.incidents.map((i) => (
              <div key={i.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[15px] font-medium">{i.title}</span>
                  <StatusPill tone={i.status === 'open' ? (i.severity === 'major' ? 'bad' : 'warn') : 'muted'}>
                    {i.status === 'open' ? t('status.ongoing') : t('status.resolved', { date: fmt(i.resolvedAt!) })}
                  </StatusPill>
                </div>
                {i.text && <div className="mt-1 text-[13px] text-dim">{i.text}</div>}
                <div className="mt-1 text-[12px] text-faint">{fmt(i.startedAt)}</div>
              </div>
            ))
          )}
        </div>
      </Section>

      {apiEnabled && (
        <button onClick={() => openExternal(`${API_BASE.replace(/\/+$/, '')}/status`)} className="btn-glass mt-5 w-full">
          <LinkIcon className="h-5 w-5" />
          {t('status.publicPage')}
        </button>
      )}
    </>
  )
}

function NodeRow({ node }: { node: StatusNode }) {
  const t = useT()
  const known = node.country && /^[a-z]{2}$/.test(node.country)
  // Новый узел: за сутки меньше 12 часов проверок. Процент за 30 дней по такой истории (и по старым
  // проверкам умершего узла) только пугает, поэтому вместо него короткая пометка.
  const isNew = node.hourly.filter((h) => h != null).length < 12
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-3.5">
        {known ? <Flag code={node.country as CountryCode} size={32} /> : <span className="tile !h-8 !w-8 !rounded-full text-[11px] font-semibold">{node.id.slice(0, 2).toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium">{known ? t(`country.${node.country}` as TKey) : node.id}</div>
          <div className="text-[12.5px] text-faint">
            {isNew ? t('status.newNode') : `${t('status.uptime30')}: ${node.uptime30d != null ? `${node.uptime30d}%` : '—'}`} · {t('status.uptime24')}: {node.uptime24h != null ? `${node.uptime24h}%` : '—'}
          </div>
        </div>
        <StatusPill tone={node.online ? (node.pingMs != null && node.pingMs > 250 ? 'warn' : 'ok') : 'bad'}>
          {node.online ? (node.pingMs != null ? `${node.pingMs} ${t('common.ms')}` : t('common.available')) : t('common.offline')}
        </StatusPill>
      </div>
      <div className="mt-3 flex h-6 items-end gap-[3px]">
        {node.hourly.map((h, i) => (
          <span
            key={i}
            title={h == null ? t('status.noData') : `${h}%`}
            className={`h-full flex-1 rounded-[3px] ${h == null ? 'bg-white/[0.04]' : h >= 99 ? 'bg-ok/70' : h >= 90 ? 'bg-warn/80' : 'bg-bad/80'}`}
          />
        ))}
      </div>
    </div>
  )
}
