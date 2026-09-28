import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { haptic } from '@/lib/telegram'
import { TAB_PATHS } from '@/lib/navigation'
import { AccountIcon, DevicesIcon, HomeIcon, PlansIcon, ReferralsIcon } from './icons'

const TABS = [
  { to: '/', label: 'Главная', icon: HomeIcon },
  { to: '/plans', label: 'Тарифы', icon: PlansIcon },
  { to: '/devices', label: 'Устройства', icon: DevicesIcon },
  { to: '/referrals', label: 'Друзья', icon: ReferralsIcon },
  { to: '/account', label: 'Аккаунт', icon: AccountIcon },
]

/** Плавающий стеклянный таб-бар. Прячется на вложенных экранах (/connect и т.п.). */
export default function BottomNav() {
  const { pathname } = useLocation()
  if (!TAB_PATHS.includes(pathname)) return null

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 px-4"
      style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
    >
      <div className="glass mx-auto flex max-w-[528px] items-stretch justify-between !rounded-pill p-1.5">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            replace
            onClick={() => haptic('select')}
            className="relative flex flex-1 flex-col items-center justify-center gap-1 rounded-pill py-2"
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="tab-active"
                    className="absolute inset-0 rounded-pill bg-white/[0.12]"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <Icon className={`relative h-[22px] w-[22px] ${isActive ? 'text-fg' : 'text-faint'}`} />
                <span className={`relative text-[11px] font-medium ${isActive ? 'text-fg' : 'text-faint'}`}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
