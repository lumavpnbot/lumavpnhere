import { Routes, Route } from 'react-router-dom'
import BottomNav from '@/components/BottomNav'
import HomePage from '@/pages/HomePage'
import PlansPage from '@/pages/PlansPage'
import DevicesPage from '@/pages/DevicesPage'
import ReferralsPage from '@/pages/ReferralsPage'
import AccountPage from '@/pages/AccountPage'

export default function App() {
  return (
    <div className="min-h-screen bg-bg pb-20">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/referrals" element={<ReferralsPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Routes>
      <BottomNav />
    </div>
  )
}
