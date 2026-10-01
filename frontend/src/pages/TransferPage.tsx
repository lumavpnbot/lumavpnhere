import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PageTitle, Section, StatusPill, TopBar } from '@/components/ui'
import { CheckIcon, ChevronDown, TransferIcon } from '@/components/icons'
import { useLang, useT, type TKey } from '@/i18n'
import { formatDate } from '@/lib/format'
import { api, apiEnabled } from '@/lib/api'
import { haptic, notify } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

type CheckStatus = 'ok' | 'fail' | 'warn' | 'skip'
interface Check {
  n: number
  key: string
  title: string
  status: CheckStatus
  detail: string
}
type Verdict = 'auto_approved' | 'disputed' | 'auto_rejected'
type Status = 'checking' | 'approved' | 'rejected' | 'disputed' | 'need_link'

interface CheckResult {
  verdict: Verdict
  checks: Check[]
  days: number | null
  expireAt: string | null
}

interface TransferRequest {
  id: string
  code: string
  status: Status
  verdict: Verdict | null
  days: number | null
  creditedDays: number | null
  rejectReason: string | null
  checks: Check[]
  createdAt: string
}

interface StatusResponse {
  request: TransferRequest | null
  rules: { minAccountDays: number; minDays: number; maxDays: number }
  accountAgeDays: number
}

const MARK: Record<CheckStatus, { cls: string; sym: string }> = {
  ok: { cls: 'bg-ok/15 text-ok', sym: '✓' },
  fail: { cls: 'bg-bad/15 text-bad', sym: '✕' },
  warn: { cls: 'bg-warn/15 text-warn', sym: '!' },
  skip: { cls: 'bg-white/[0.06] text-faint', sym: '–' },
}
const STATUS_TONE: Record<Status, 'ok' | 'warn' | 'bad' | 'muted'> = { approved: 'ok', disputed: 'warn', checking: 'warn', rejected: 'bad', need_link: 'warn' }

/** ТЗ v6.3 · 01: перенос подписки с другого сервиса (до 90 дней, один раз). */
export default function TransferPage() {
  const t = useT()
  const lang = useLang()
  const refresh = useAppStore((s) => s.refresh)
  const [info, setInfo] = useState<StatusResponse | null>(null)
  const [link, setLink] = useState('')
  const [result, setResult] = useState<CheckResult | null>(null)
  const [busy, setBusy] = useState<'check' | 'submit' | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [providers, setProviders] = useState<{ domain: string; name: string | null }[]>([])
  const [providersOpen, setProvidersOpen] = useState(false)
  const poll = useRef<number | null>(null)

  const load = useCallback(async () => {
    if (!apiEnabled) {
      setInfo({ request: null, rules: { minAccountDays: 3, minDays: 7, maxDays: 90 }, accountAgeDays: 10 })
      return
    }
    const r = await api.get<StatusResponse>('/api/transfer/status').catch(() => null)
    if (r) setInfo(r)
    return r
  }, [])

  useEffect(() => {
    void load()
    if (apiEnabled) api.get<{ providers: { domain: string; name: string | null }[] }>('/api/transfer/providers').then((r) => setProviders(r.providers)).catch(() => undefined)
    return () => {
      if (poll.current) window.clearInterval(poll.current)
    }
  }, [load])

  // Пока заявка на ручной проверке, обновляем статус раз в 15 секунд.
  const pending = info?.request && (info.request.status === 'checking' || info.request.status === 'disputed')
  useEffect(() => {
    if (!pending) return
    poll.current = window.setInterval(async () => {
      const r = await load()
      if (r?.request?.status === 'approved') {
        haptic('success')
        void refresh()
      }
    }, 15_000)
    return () => {
      if (poll.current) window.clearInterval(poll.current)
    }
  }, [pending, load, refresh])

  const check = async () => {
    haptic('medium')
    if (!apiEnabled) return notify(t('common.demoPay'))
    setBusy('check')
    try {
      setResult(await api.post<CheckResult>('/api/transfer/check', { link: link.trim() }))
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    haptic('medium')
    if (!apiEnabled) return notify(t('common.demoPay'))
    setBusy('submit')
    try {
      const r = await api.post<{ request: TransferRequest }>('/api/transfer/submit', { link: link.trim() })
      setInfo((prev) => (prev ? { ...prev, request: r.request } : prev))
      setResult(null)
      setLink('')
      setShowForm(false)
      haptic(r.request.status === 'rejected' ? 'error' : 'success')
      if (r.request.status === 'approved') void refresh()
    } catch (err) {
      haptic('error')
      notify(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const req = info?.request
  const rules = info?.rules ?? { minAccountDays: 3, minDays: 7, maxDays: 90 }
  const approved = req?.status === 'approved'
  const formVisible = !approved && (!req || req.status === 'rejected' || req.status === 'need_link' || showForm) && !pending

  return (
    <>
      <TopBar />
      <PageTitle title={t('transfer.title')} subtitle={t('transfer.subtitle')} />

      {req && (
        <div className="glass glass-hero mb-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="label">{t('transfer.request')}</span>
            <StatusPill tone={STATUS_TONE[req.status]}>{t(`transfer.status.${req.status}` as TKey)}</StatusPill>
          </div>
          <div className="mt-3 font-mono text-[13px] text-dim">{req.code}</div>
          <div className="mt-1 text-[12px] text-faint">{formatDate(req.createdAt, lang)}</div>
          {approved && req.creditedDays && <div className="mt-3 text-[18px] font-semibold">{t('transfer.credited', { days: req.creditedDays })}</div>}
          {req.status === 'rejected' && req.rejectReason && <p className="mt-3 text-[14px] text-bad">{t('transfer.reason', { reason: req.rejectReason })}</p>}
          {approved && <p className="mt-2 text-[13px] text-faint">{t('transfer.done')}</p>}
          <ChecksList checks={req.checks} />
        </div>
      )}

      {!approved && !formVisible && req && !pending && (
        <button onClick={() => setShowForm(true)} className="btn-glass mb-3 w-full">
          {t('transfer.again')}
        </button>
      )}

      {formVisible && (
        <div className="glass p-5">
          <div className="flex items-center gap-3">
            <span className="tile !h-10 !w-10 !rounded-[13px]">
              <TransferIcon className="h-5 w-5" />
            </span>
            <div className="text-[16px] font-semibold">{t('transfer.link')}</div>
          </div>
          <textarea
            value={link}
            onChange={(e) => {
              setLink(e.target.value.replace(/\s+/g, ''))
              setResult(null)
            }}
            rows={3}
            placeholder={t('transfer.placeholder')}
            className="field mt-4 !h-auto resize-none break-all py-3 font-mono !text-[13px] leading-snug"
          />
          <p className="mt-2 px-1 text-[12px] text-faint">{t('transfer.types')}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={check} disabled={!!busy || link.trim().length < 8} className="btn-glass !h-12 !px-3 !text-[14px]">
              {busy === 'check' ? <Spinner /> : t('transfer.check')}
            </button>
            <button onClick={submit} disabled={!!busy || link.trim().length < 8 || result?.verdict === 'auto_rejected'} className="btn-glass-strong !h-12 !px-3 !text-[14px]">
              {busy === 'submit' ? <Spinner /> : t('transfer.submit')}
            </button>
          </div>

          {result && (
            <div className="mt-5 border-t border-white/[0.07] pt-4">
              <div className="label">{t('transfer.result')}</div>
              <div className={`mt-2 text-[16px] font-semibold ${result.verdict === 'auto_approved' ? 'text-ok' : result.verdict === 'disputed' ? 'text-warn' : 'text-bad'}`}>
                {t(`transfer.verdict.${result.verdict}` as TKey)}
              </div>
              {result.verdict !== 'auto_rejected' && <div className="mt-1 text-[14px] text-dim">{result.days ? t('transfer.days', { days: result.days }) : t('transfer.daysUnknown')}</div>}
              <ChecksList checks={result.checks} open />
            </div>
          )}
        </div>
      )}

      <Section title={t('transfer.rules')}>
        <div className="glass divide-y divide-white/[0.06] px-4">
          {(
            [
              ['transfer.rule1', { min: rules.minDays, max: rules.maxDays }],
              ['transfer.rule2', { days: rules.minAccountDays }],
              ['transfer.rule3', {}],
              ['transfer.rule4', {}],
              ['transfer.rule5', {}],
            ] as [TKey, Record<string, number>][]
          ).map(([k, vars], i) => (
            <div key={k} className="flex items-start gap-3.5 py-3.5">
              <span className="tile !h-7 !w-7 !rounded-[9px] text-[12px] font-semibold">{i + 1}</span>
              <span className="pt-0.5 text-[14px] leading-snug text-dim">{t(k, vars)}</span>
            </div>
          ))}
        </div>
      </Section>

      {providers.length > 0 && (
        <Section>
          <div className="glass overflow-hidden">
            <button onClick={() => setProvidersOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3.5 text-left">
              <span className="text-[15px] font-medium">{t('transfer.providers')}</span>
              <ChevronDown className="h-5 w-5 text-dim transition-transform duration-300" style={{ transform: providersOpen ? 'rotate(180deg)' : 'none' }} />
            </button>
            {providersOpen && (
              <div className="flex flex-wrap gap-2 px-4 pb-4">
                {providers.map((p) => (
                  <span key={p.domain} className="rounded-pill bg-white/[0.06] px-3 py-1 text-[13px] text-dim">
                    {p.name ?? p.domain}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}
    </>
  )
}

function ChecksList({ checks, open = false }: { checks: Check[]; open?: boolean }) {
  const t = useT()
  const [expanded, setExpanded] = useState(open)
  if (!checks?.length) return null
  const ok = checks.filter((c) => c.status === 'ok').length
  return (
    <div className="mt-4">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-2 text-[13px] font-medium text-dim">
          <CheckIcon className="h-4 w-4" />
          {t('transfer.checksTitle', { ok, total: checks.length })}
        </span>
        <ChevronDown className="h-4 w-4 text-faint transition-transform duration-300" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="mt-3 space-y-1.5">
              {checks.map((c) => (
                <div key={c.key} className="flex items-start gap-2.5 rounded-xl bg-white/[0.03] px-3 py-2">
                  <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${MARK[c.status].cls}`}>{MARK[c.status].sym}</span>
                  <span className="min-w-0 text-[12.5px] leading-snug">
                    <span className="font-semibold text-fg">{c.title}</span>
                    <span className="text-dim"> — {c.detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Spinner() {
  return <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
}
