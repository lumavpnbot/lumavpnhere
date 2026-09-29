import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Flag from '@/components/Flag'
import { LangSheet } from '@/components/LangSwitch'
import { Avatar, Brand, DemoBadge, Divider, ListRow, PageTitle, Section, TopBar, useDisplayName } from '@/components/ui'
import { BellIcon, ChatIcon, DocIcon, LanguageIcon, MailIcon, MegaphoneIcon, ShieldIcon } from '@/components/icons'
import { APP_VERSION, BRAND, DOCS, LINKS, PLANS } from '@/config'
import { useLang, useT } from '@/i18n'
import { formatDate } from '@/lib/format'
import { openExternal } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

export default function AccountPage() {
  const t = useT()
  const lang = useLang()
  const navigate = useNavigate()
  const profile = useAppStore((s) => s.profile)
  const subscription = useAppStore((s) => s.subscription)
  const name = useDisplayName()
  const [langOpen, setLangOpen] = useState(false)
  const plan = PLANS.find((p) => p.id === subscription.plan)

  return (
    <>
      <TopBar />
      <PageTitle title={t('account.title')} />
      <DemoBadge />

      <div className="glass glass-hero flex items-center gap-4 p-4">
        <Avatar size={56} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[18px] font-semibold">{name}</div>
          <div className="mt-0.5 text-[13px] text-faint">
            {plan ? t(plan.nameKey) : t('home.none')}
            {plan && subscription.expiresAt ? `, ${t('home.until', { date: formatDate(subscription.expiresAt, lang) })}` : ''}
          </div>
        </div>
      </div>

      <Section title={t('account.info')}>
        <div className="glass divide-y divide-white/[0.06] px-4">
          <Row label={t('account.tgId')} value={profile.tgId ? String(profile.tgId) : t('common.notSet')} />
          <Row label={t('account.username')} value={profile.username ? `@${profile.username}` : t('common.notSet')} />
          <Row label={t('account.name')} value={profile.firstName ?? t('common.notSet')} />
          <Row label={t('account.registered')} value={profile.registeredAt ? formatDate(profile.registeredAt, lang) : t('common.notSet')} />
        </div>
      </Section>

      <Section title={t('account.settings')}>
        <div className="glass overflow-hidden">
          <ListRow
            icon={<LanguageIcon className="h-[18px] w-[18px]" />}
            title={t('account.language')}
            right={
              <span className="mr-1 flex items-center gap-2 text-[14px] text-dim">
                <Flag code={lang === 'ru' ? 'ru' : 'gb'} size={20} />
                {lang === 'ru' ? t('lang.ru') : t('lang.en')}
              </span>
            }
            onClick={() => setLangOpen(true)}
          />
          <Divider />
          <ListRow
            icon={<BellIcon className="h-[18px] w-[18px]" />}
            title={t('account.notifications')}
            hint={t('account.notificationsHint')}
            onClick={() => navigate('/account/notifications')}
          />
          <Divider />
          <ListRow
            icon={<MailIcon className="h-[18px] w-[18px]" />}
            title={t('account.logins')}
            hint={profile.email ?? t('account.loginsHint')}
            onClick={() => navigate('/account/logins')}
          />
        </div>
      </Section>

      <Section title={t('account.help')}>
        <div className="glass overflow-hidden">
          <ListRow icon={<ChatIcon className="h-[18px] w-[18px]" />} title={t('home.support')} onClick={() => openExternal(LINKS.support)} />
          <Divider />
          <ListRow icon={<MegaphoneIcon className="h-[18px] w-[18px]" />} title={t('home.channel')} onClick={() => openExternal(LINKS.channel)} />
          <Divider />
          <ListRow icon={<DocIcon className="h-[18px] w-[18px]" />} title={t('account.terms')} onClick={() => openExternal(DOCS.terms)} />
          <Divider />
          <ListRow icon={<ShieldIcon className="h-[18px] w-[18px]" />} title={t('account.privacy')} onClick={() => openExternal(DOCS.privacy)} />
        </div>
      </Section>

      <div className="mt-10 flex flex-col items-center gap-2 opacity-70">
        <Brand />
        <span className="text-[12px] text-faint">
          {BRAND} v{APP_VERSION}
        </span>
      </div>

      <LangSheet open={langOpen} onClose={() => setLangOpen(false)} />
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 text-[15px]">
      <span className="shrink-0 text-dim">{label}</span>
      <span className="truncate font-medium tabular-nums">{value}</span>
    </div>
  )
}
