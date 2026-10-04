import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, LazyMotion, m } from 'framer-motion'
import AmbientBackground from '@/components/AmbientBackground'
import BottomNav from '@/components/BottomNav'
import { TAB_PATHS, useTelegramBackButton } from '@/lib/navigation'
import { onAppVisible } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'
// Вкладки таб-бара грузятся сразу, остальные экраны отдельными файлами (первый запуск быстрее).
import HomePage from '@/pages/HomePage'
import PlansPage from '@/pages/PlansPage'
import DevicesPage from '@/pages/DevicesPage'
import ReferralsPage from '@/pages/ReferralsPage'
import AccountPage from '@/pages/AccountPage'
import ReviewsPage from '@/pages/ReviewsPage'

/**
 * После деплоя старые файлы экранов удаляются с GitHub Pages. Если Telegram открыл
 * закэшированную версию приложения, файл экрана не загрузится: перезагружаем приложение
 * один раз (иначе экран оставался пустым).
 */
function reloadOnce(err: unknown): never {
  let reloaded = false
  try {
    reloaded = sessionStorage.getItem('lynk.chunkReload') === '1'
    if (!reloaded) sessionStorage.setItem('lynk.chunkReload', '1')
  } catch {
    reloaded = true
  }
  if (!reloaded) window.location.reload()
  throw err
}
const page = <T,>(load: () => Promise<T>) => lazy(() => load().catch(reloadOnce) as Promise<{ default: React.ComponentType }>)

const LAZY_PAGES = {
  connect: () => import('@/pages/ConnectPage'),
  balance: () => import('@/pages/BalancePage'),
  notifications: () => import('@/pages/NotificationsPage'),
  logins: () => import('@/pages/LoginsPage'),
  support: () => import('@/pages/SupportPage'),
  doc: () => import('@/pages/DocPage'),
  status: () => import('@/pages/StatusPage'),
  transfer: () => import('@/pages/TransferPage'),
  achievements: () => import('@/pages/AchievementsPage'),
}
const ConnectPage = page(LAZY_PAGES.connect)
const BalancePage = page(LAZY_PAGES.balance)
const NotificationsPage = page(LAZY_PAGES.notifications)
const LoginsPage = page(LAZY_PAGES.logins)
const SupportPage = page(LAZY_PAGES.support)
const DocPage = page(LAZY_PAGES.doc)
const StatusPage = page(LAZY_PAGES.status)
const TransferPage = page(LAZY_PAGES.transfer)
const AchievementsPage = page(LAZY_PAGES.achievements)

const loadMotionFeatures = () => import('@/lib/motionFeatures').then((r) => r.default, reloadOnce)

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

  // Экран загрузки (index.html) держим, пока не пришёл профиль, но не дольше 10 с:
  // если сервер не отвечает, лучше показать приложение с ошибкой и кнопкой «Повторить».
  const loaded = useAppStore((s) => s.loaded)
  useEffect(() => {
    const hide = () => {
      const el = document.getElementById('splash')
      if (!el) return
      el.classList.add('splash--hide')
      window.setTimeout(() => el.remove(), 400)
    }
    if (loaded) return hide()
    const timer = window.setTimeout(hide, 10_000)
    return () => window.clearTimeout(timer)
  }, [loaded])

  // Когда первый экран показан и браузер свободен, подгружаем остальные экраны в фоне:
  // переходы остаются мгновенными, но не тормозят запуск.
  useEffect(() => {
    // Фоновая подгрузка без перезагрузки: перезагружаем, только если экран реально открыли.
    const preload = () => Object.values(LAZY_PAGES).forEach((load) => void load().catch(() => undefined))
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(preload, 2000)
    return () => clearTimeout(id)
  }, [])

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
    <LazyMotion features={loadMotionFeatures} strict>
      <AmbientBackground />
      {/* Скролл сбрасываем ПОСЛЕ того, как старый экран исчез, иначе он дёргается вверх во время анимации. */}
      <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo(0, 0)}>
        <m.main
          key={location.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className={`page ${nested ? 'page--nested' : ''}`}
        >
          <Suspense fallback={null}>
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
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/account/transfer" element={<TransferPage />} />
              <Route path="/account/achievements" element={<AchievementsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </m.main>
      </AnimatePresence>
      <BottomNav />
    </LazyMotion>
  )
}
