import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import AmbientBackground from '@/components/AmbientBackground'
import BottomNav from '@/components/BottomNav'
import { TAB_PATHS, useTelegramBackButton } from '@/lib/navigation'
import { onAppVisible } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'
import HomePage from '@/pages/HomePage'
import PlansPage from '@/pages/PlansPage'
import DevicesPage from '@/pages/DevicesPage'
import ConnectPage from '@/pages/ConnectPage'
import ReferralsPage from '@/pages/ReferralsPage'
import AccountPage from '@/pages/AccountPage'
import BalancePage from '@/pages/BalancePage'
import NotificationsPage from '@/pages/NotificationsPage'
import LoginsPage from '@/pages/LoginsPage'
import SupportPage from '@/pages/SupportPage'
import DocPage from '@/pages/DocPage'
import StatusPage from '@/pages/StatusPage'
import TransferPage from '@/pages/TransferPage'
import AchievementsPage from '@/pages/AchievementsPage'

export default function App() {
  const location = useLocation()
  const bootstrap = useAppStore((s) => s.bootstrap)
  const refresh = useAppStore((s) => s.refresh)
  const loadStatus = useAppStore((s) => s.loadStatus)
  const nested = !TAB_PATHS.includes(location.pathname)

  useTelegramBackButton()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // Подписка и баланс меняются вне приложения (оплата в CryptoBot, продление из админки,
  // бонусы). Раньше /me грузился один раз при запуске, и данные «не обновлялись» до перезапуска.
  useEffect(() => {
    let last = Date.now()
    const update = () => {
      if (Date.now() - last < 5_000) return
      last = Date.now()
      void refresh()
      void loadStatus()
    }
    const off = onAppVisible(update)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') update()
    }, 60_000)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [refresh, loadStatus])

  return (
    <>
      <AmbientBackground />
      {/* Скролл сбрасываем ПОСЛЕ того, как старый экран исчез, иначе он дёргается вверх во время анимации. */}
      <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo(0, 0)}>
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className={`page ${nested ? 'page--nested' : ''}`}
        >
          <Routes location={location}>
            <Route path="/" element={<HomePage />} />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/connect" element={<ConnectPage />} />
            <Route path="/referrals" element={<ReferralsPage />} />
            <Route path="/balance" element={<BalancePage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/account/notifications" element={<NotificationsPage />} />
            <Route path="/account/logins" element={<LoginsPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/docs/:doc" element={<DocPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/account/transfer" element={<TransferPage />} />
            <Route path="/account/achievements" element={<AchievementsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.main>
      </AnimatePresence>
      <BottomNav />
    </>
  )
}
