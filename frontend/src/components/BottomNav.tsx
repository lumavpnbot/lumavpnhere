import { useLocation, useNavigate } from 'react-router-dom'
import { useT, type TKey } from '@/i18n'
import { haptic } from '@/lib/telegram'
import { TAB_PATHS } from '@/lib/navigation'
import { AccountIcon, DevicesIcon, HomeIcon, PlansIcon, ReferralsIcon } from './icons'

const TABS: { to: string; label: TKey; icon: typeof HomeIcon }[] = [
  { to: '/', label: 'tab.home', icon: HomeIcon },
  { to: '/plans', label: 'tab.plans', icon: PlansIcon },
  { to: '/devices', label: 'tab.devices', icon: DevicesIcon },
  { to: '/referrals', label: 'tab.friends', icon: ReferralsIcon },
  { to: '/account', label: 'tab.account', icon: AccountIcon },
]

/**
 * Плавающий таб-бар. Индикатор активной вкладки двигается чистым CSS
 * transform по фиксированной сетке из 5 равных ячеек, поэтому не прыгает
 * и не залезает на соседей (раньше был framer layoutId, он пересчитывал
 * размеры во время смены страницы и дёргался).
 */
export default function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const t = useT()
  const index = TAB_PATHS.indexOf(pathname)
  if (index < 0) return null

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#050506] via-[#050506]/80 to-transparent px-4 pt-6"
      style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
    >
      <div className="glass glass-nav mx-auto max-w-[528px] !rounded-pill p-1.5">
        <div className="relative grid grid-cols-5">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1/5 p-0.5 transition-transform duration-300"
            style={{ transform: `translateX(${index * 100}%)`, transitionTimingFunction: 'var(--ease)' }}
          >
            <span className="block h-full w-full rounded-pill bg-white/[0.13]" />
          </span>

          {TABS.map(({ to, label, icon: Icon }, i) => {
            const active = i === index
            return (
              <button
                key={to}
                onClick={() => {
                  if (active) return
                  haptic('select')
                  navigate(to, { replace: true })
                }}
                className="relative z-10 flex min-w-0 flex-col items-center justify-center gap-1 py-2"
              >
                <Icon className={`h-[22px] w-[22px] transition-colors duration-200 ${active ? 'text-fg' : 'text-faint'}`} />
                <span
                  className={`max-w-full truncate px-1 text-[10.5px] font-medium leading-none transition-colors duration-200 ${
                    active ? 'text-fg' : 'text-faint'
                  }`}
                >
                  {t(label)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
