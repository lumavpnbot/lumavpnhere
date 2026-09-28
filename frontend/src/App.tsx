import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import AmbientBackground from '@/components/AmbientBackground'
import BottomNav from '@/components/BottomNav'
import { useTelegramBackButton } from '@/lib/navigation'
import { useAppStore } from '@/store/useAppStore'
import HomePage from '@/pages/HomePage'
import PlansPage from '@/pages/PlansPage'
import DevicesPage from '@/pages/DevicesPage'
import ConnectPage from '@/pages/ConnectPage'
import ReferralsPage from '@/pages/ReferralsPage'
import AccountPage from '@/pages/AccountPage'

export default function App() {
  const location = useLocation()
  const bootstrap = useAppStore((s) => s.bootstrap)

  useTelegramBackButton()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <>
      <AmbientBackground />
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="page"
        >
          <Routes location={location}>
            <Route path="/" element={<HomePage />} />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/connect" element={<ConnectPage />} />
            <Route path="/referrals" element={<ReferralsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </motion.main>
      </AnimatePresence>
      <BottomNav />
    </>
  )
}
