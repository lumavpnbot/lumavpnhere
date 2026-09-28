import { Avatar, Brand, Divider, ListRow, PageTitle, Section, TopBar } from '@/components/ui'
import { ChatIcon, DocIcon, MegaphoneIcon, ShieldIcon } from '@/components/icons'
import { APP_VERSION, BRAND, LINKS, PLANS } from '@/config'
import { formatDate } from '@/lib/format'
import { openExternal } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'

export default function AccountPage() {
  const { profile, subscription } = useAppStore()
  const plan = PLANS.find((p) => p.id === subscription.plan)

  return (
    <>
      <TopBar />
      <PageTitle title="Аккаунт" />

      <div className="glass flex items-center gap-4 p-4">
        <Avatar size={56} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold">
            {profile.username ? `@${profile.username}` : profile.firstName ?? 'Гость'}
          </div>
          <div className="mt-0.5 text-[13px] text-faint tabular-nums">ID {profile.tgId ?? '—'}</div>
        </div>
      </div>

      <Section title="Подписка">
        <div className="glass divide-y divide-white/[0.06] px-4">
          <Row label="Тариф" value={plan?.name ?? '—'} />
          <Row label="Действует до" value={subscription.expiresAt ? formatDate(subscription.expiresAt) : '—'} />
          <Row label="Вход" value="через Telegram" />
        </div>
      </Section>

      <Section title="Помощь">
        <div className="glass overflow-hidden">
          <ListRow icon={<ChatIcon className="h-[18px] w-[18px]" />} title="Поддержка" onClick={() => openExternal(LINKS.support)} />
          <Divider />
          <ListRow icon={<MegaphoneIcon className="h-[18px] w-[18px]" />} title="Наш канал" onClick={() => openExternal(LINKS.channel)} />
          <Divider />
          {/* TODO: ссылки на документы */}
          <ListRow icon={<DocIcon className="h-[18px] w-[18px]" />} title="Условия использования" />
          <Divider />
          <ListRow icon={<ShieldIcon className="h-[18px] w-[18px]" />} title="Политика конфиденциальности" />
        </div>
      </Section>

      <div className="mt-10 flex flex-col items-center gap-2 opacity-70">
        <Brand />
        <span className="text-[12px] text-faint">
          {BRAND} · v{APP_VERSION}
        </span>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3.5 text-[15px]">
      <span className="text-dim">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
