import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

function Base({ children, ...props }: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const HomeIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </Base>
)
export const PlansIcon = (p: P) => (
  <Base {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M3 10h18M7 15h3" />
  </Base>
)
export const DevicesIcon = (p: P) => (
  <Base {...p}>
    <rect x="3" y="4.5" width="13" height="9.5" rx="1.5" />
    <path d="M7 18h5M9.5 14v4" />
    <rect x="17.5" y="8.5" width="4" height="10" rx="1.2" />
  </Base>
)
export const ReferralsIcon = (p: P) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5" />
    <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.9c1.6.8 2.7 2.5 3 5.1" />
  </Base>
)
export const AccountIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="8.5" r="4" />
    <path d="M4.5 20.5c.8-3.9 3.9-6 7.5-6s6.7 2.1 7.5 6" />
  </Base>
)
export const ChevronRight = (p: P) => (
  <Base {...p}>
    <path d="m9 6 6 6-6 6" />
  </Base>
)
export const ChevronLeft = (p: P) => (
  <Base {...p}>
    <path d="m15 6-6 6 6 6" />
  </Base>
)
export const CopyIcon = (p: P) => (
  <Base {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Base>
)
export const CheckIcon = (p: P) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
)
export const ShareIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
    <path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" />
  </Base>
)
export const ShieldIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Base>
)
export const GlobeIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.3 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.3-3.5-8.5S9.7 5.9 12 3.5z" />
  </Base>
)
export const BoltIcon = (p: P) => (
  <Base {...p}>
    <path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12z" />
  </Base>
)
export const InfinityIcon = (p: P) => (
  <Base {...p}>
    <path d="M7 15.5c-2 0-3.5-1.6-3.5-3.5S5 8.5 7 8.5c3.5 0 6.5 7 10 7 2 0 3.5-1.6 3.5-3.5S19 8.5 17 8.5c-3.5 0-6.5 7-10 7z" />
  </Base>
)
export const ChatIcon = (p: P) => (
  <Base {...p}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.3A8 8 0 1 1 20 12z" />
  </Base>
)
export const MegaphoneIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z" />
    <path d="M16.5 9a4 4 0 0 1 0 6" />
  </Base>
)
export const DocIcon = (p: P) => (
  <Base {...p}>
    <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
    <path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" />
  </Base>
)
export const PlusIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
)
export const DownloadIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </Base>
)
export const LinkIcon = (p: P) => (
  <Base {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Base>
)
export const WalletIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3" />
    <rect x="4" y="8" width="16.5" height="11" rx="2.5" />
    <path d="M16 13.5h1.5" />
  </Base>
)
export const ChevronDown = (p: P) => (
  <Base {...p}>
    <path d="m6 9 6 6 6-6" />
  </Base>
)
export const BellIcon = (p: P) => (
  <Base {...p}>
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Base>
)
export const MailIcon = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="m4.5 7 7.5 6 7.5-6" />
  </Base>
)
export const TelegramIcon = (p: P) => (
  <Base {...p}>
    <path d="M20.5 4.5 3.5 11.2c-.8.3-.8 1.4 0 1.7l4 1.4 1.6 5c.2.7 1.1.9 1.6.4l2.4-2.3 4.2 3.1c.6.4 1.4.1 1.6-.6L21.9 5.8c.2-.9-.6-1.6-1.4-1.3z" />
    <path d="m7.5 14.3 9-6.3-6.4 7.4" />
  </Base>
)
export const MinusIcon = (p: P) => (
  <Base {...p}>
    <path d="M5 12h14" />
  </Base>
)
export const ArrowDownLeft = (p: P) => (
  <Base {...p}>
    <path d="M17 7 7 17M7 9v8h8" />
  </Base>
)
export const ArrowUpRight = (p: P) => (
  <Base {...p}>
    <path d="M7 17 17 7M9 7h8v8" />
  </Base>
)
export const GiftIcon = (p: P) => (
  <Base {...p}>
    <rect x="4" y="9" width="16" height="11" rx="1.5" />
    <path d="M3 9h18M12 9v11M12 9c-1.5-3.5-5-4-5-1.5S10 9 12 9zm0 0c1.5-3.5 5-4 5-1.5S14 9 12 9z" />
  </Base>
)
export const PercentIcon = (p: P) => (
  <Base {...p}>
    <path d="M18 6 6 18" />
    <circle cx="7.5" cy="7.5" r="2.2" />
    <circle cx="16.5" cy="16.5" r="2.2" />
  </Base>
)
export const SparkIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5z" />
    <path d="M18.5 16.5c.2 1.5.8 2.1 2.3 2.3-1.5.2-2.1.8-2.3 2.3-.2-1.5-.8-2.1-2.3-2.3 1.5-.2 2.1-.8 2.3-2.3z" />
  </Base>
)
export const LanguageIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.3 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.3-3.5-8.5S9.7 5.9 12 3.5z" />
  </Base>
)
export const RefreshIcon = (p: P) => (
  <Base {...p}>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
    <path d="M20 20v-4h-4" />
  </Base>
)
export const TrophyIcon = (p: P) => (
  <Base {...p}>
    <path d="M7 4.5h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 6.5H4.5v1.5A3 3 0 0 0 7.5 11M17 6.5h2.5v1.5a3 3 0 0 1-3 3M12 14.5V18M8.5 20.5h7M9.5 18h5" />
  </Base>
)
export const PulseIcon = (p: P) => (
  <Base {...p}>
    <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
  </Base>
)
export const TransferIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 8h13.5M14 4.5 17.5 8 14 11.5" />
    <path d="M20 16H6.5M10 12.5 6.5 16l3.5 3.5" />
  </Base>
)
export const LockIcon = (p: P) => (
  <Base {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Base>
)
export const StarIcon = (p: P) => (
  <Base {...p}>
    <path d="m12 3.5 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7z" />
  </Base>
)
export const CalendarIcon = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Base>
)
export const ClockIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Base>
)
export const CardIcon = (p: P) => (
  <Base {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M3 10h18M7 15h3" />
  </Base>
)
export const QrIcon = (p: P) => (
  <Base {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1.2" />
    <rect x="14" y="4" width="6" height="6" rx="1.2" />
    <rect x="4" y="14" width="6" height="6" rx="1.2" />
    <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
  </Base>
)
