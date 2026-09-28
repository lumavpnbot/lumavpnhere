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
