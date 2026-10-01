import type { ComponentType, SVGProps } from 'react'
import { useT, type TKey } from '@/i18n'
import type { Rarity } from '@/store/useAppStore'
import {
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  ClockIcon,
  LinkIcon,
  LockIcon,
  ReferralsIcon,
  ShieldIcon,
  SparkIcon,
  StarIcon,
  TransferIcon,
  TrophyIcon,
  AccountIcon,
  RefreshIcon,
} from './icons'

/** Цвета редкости из ТЗ: обычное (серебро), редкое, эпическое, легендарное. */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#b8b8c0',
  rare: '#93b8ff',
  epic: '#c084fc',
  legendary: '#fcd34d',
}

const ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  first_friend: ReferralsIcon,
  sharing: LinkIcon,
  referrer: AccountIcon,
  gold_referrer: StarIcon,
  ambassador: TrophyIcon,
  yearly: CalendarIcon,
  loyal: ShieldIcon,
  faithful: StarIcon,
  veteran: TrophyIcon,
  transfer: TransferIcon,
  early: ClockIcon,
  feedback: ChatIcon,
  promo_hunter: CheckIcon,
  comeback: RefreshIcon,
  collector: SparkIcon,
  legend: TrophyIcon,
}

export function RarityPill({ rarity }: { rarity: Rarity }) {
  const t = useT()
  const color = RARITY_COLOR[rarity]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-semibold"
      style={{ color, borderColor: `${color}40`, background: `${color}10` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      {t(`ach.rarity.${rarity}` as TKey)}
    </span>
  )
}

export function AchievementIcon({ code, rarity, locked = false, size = 40 }: { code: string; rarity: Rarity; locked?: boolean; size?: number }) {
  const Icon = locked ? LockIcon : (ICONS[code] ?? TrophyIcon)
  const color = RARITY_COLOR[rarity]
  return (
    <span
      className="tile shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        color: locked ? '#6a6a74' : '#f4f4f6',
        background: locked ? 'rgba(255,255,255,0.05)' : `linear-gradient(160deg, ${color}38, rgba(255,255,255,0.04))`,
      }}
    >
      <Icon style={{ width: size * 0.45, height: size * 0.45 }} />
    </span>
  )
}
