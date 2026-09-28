import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Stepper, Toggle } from '@/components/controls'
import { PageTitle, TopBar } from '@/components/ui'
import { BellIcon, BoltIcon, GiftIcon, MegaphoneIcon } from '@/components/icons'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'

export default function NotificationsPage() {
  const t = useT()
  const prefs = useAppStore((s) => s.prefs)
  const setPrefs = useAppStore((s) => s.setPrefs)

  return (
    <>
      <TopBar />
      <PageTitle title={t('notif.title')} subtitle={t('notif.subtitle')} />

      <div className="glass divide-y divide-white/[0.06] px-4">
        <Pref
          icon={<BellIcon className="h-[18px] w-[18px]" />}
          title={t('notif.expiry')}
          hint={t('notif.expiryHint')}
          checked={prefs.expiry}
          onChange={(v) => setPrefs({ expiry: v })}
        >
          <SubRow label={t('notif.expiryDays')}>
            <Stepper value={prefs.expiryDays} min={1} max={7} onChange={(v) => setPrefs({ expiryDays: v })} />
          </SubRow>
        </Pref>

        <Pref
          icon={<BoltIcon className="h-[18px] w-[18px]" />}
          title={t('notif.traffic')}
          hint={t('notif.trafficHint')}
          checked={prefs.traffic}
          onChange={(v) => setPrefs({ traffic: v })}
        >
          <SubRow label={t('notif.trafficAt')}>
            <Stepper value={prefs.trafficAt} min={50} max={95} step={5} suffix="%" onChange={(v) => setPrefs({ trafficAt: v })} />
          </SubRow>
        </Pref>

        <Pref
          icon={<MegaphoneIcon className="h-[18px] w-[18px]" />}
          title={t('notif.news')}
          hint={t('notif.newsHint')}
          checked={prefs.news}
          onChange={(v) => setPrefs({ news: v })}
        />

        <Pref
          icon={<GiftIcon className="h-[18px] w-[18px]" />}
          title={t('notif.promo')}
          hint={t('notif.promoHint')}
          checked={prefs.promo}
          onChange={(v) => setPrefs({ promo: v })}
        />
      </div>
    </>
  )
}

function Pref({
  icon,
  title,
  hint,
  checked,
  onChange,
  children,
}: {
  icon: ReactNode
  title: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
  children?: ReactNode
}) {
  return (
    <div className="py-4">
      <div className="flex items-center gap-3.5">
        <span className="tile !h-10 !w-10 !rounded-[13px]">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium">{title}</div>
          <div className="text-[13px] leading-snug text-faint">{hint}</div>
        </div>
        <Toggle checked={checked} onChange={onChange} />
      </div>
      <AnimatePresence initial={false}>
        {children && checked && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SubRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ml-[54px] mt-3 flex items-center justify-between gap-3">
      <span className="text-[14px] text-dim">{label}</span>
      {children}
    </div>
  )
}
