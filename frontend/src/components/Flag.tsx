import { useId } from 'react'
import type { CountryCode } from '@/config'

export type FlagCode = CountryCode

/**
 * Круглые флаги, нарисованные вручную в SVG (без внешних загрузок).
 * Упрощены под маленький размер, 20–40px.
 */
export default function Flag({ code, size = 28 }: { code: FlagCode; size?: number }) {
  return (
    <span
      className="relative inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-white/20"
      style={{ width: size, height: size }}
    >
      <FlagSvg code={code} />
    </span>
  )
}

function Stripes({ colors }: { colors: [string, string, string] }) {
  return (
    <svg viewBox="0 0 30 30" className="block h-full w-full">
      <rect width="30" height="10" fill={colors[0]} />
      <rect y="10" width="30" height="10" fill={colors[1]} />
      <rect y="20" width="30" height="10" fill={colors[2]} />
    </svg>
  )
}

function FlagSvg({ code }: { code: FlagCode }) {
  const uid = useId().replace(/:/g, '')
  switch (code) {
    case 'nl':
      return <Stripes colors={['#AE1C28', '#FFFFFF', '#21468B']} />
    case 'de':
      return <Stripes colors={['#111111', '#DD0000', '#FFCE00']} />
    case 'ru':
      return <Stripes colors={['#FFFFFF', '#0039A6', '#D52B1E']} />
    case 'pl':
      return (
        <svg viewBox="0 0 30 30" className="block h-full w-full">
          <rect width="30" height="15" fill="#FFFFFF" />
          <rect y="15" width="30" height="15" fill="#DC143C" />
        </svg>
      )
    case 'se':
      return (
        <svg viewBox="0 0 30 30" className="block h-full w-full">
          <rect width="30" height="30" fill="#006AA7" />
          <rect x="8" width="6" height="30" fill="#FECC00" />
          <rect y="12" width="30" height="6" fill="#FECC00" />
        </svg>
      )
    case 'fi':
      return (
        <svg viewBox="0 0 30 30" className="block h-full w-full">
          <rect width="30" height="30" fill="#FFFFFF" />
          <rect x="8" width="7" height="30" fill="#002F6C" />
          <rect y="11.5" width="30" height="7" fill="#002F6C" />
        </svg>
      )
    case 'us':
      return (
        <svg viewBox="0 0 30 30" className="block h-full w-full">
          <rect width="30" height="30" fill="#FFFFFF" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} y={i * 8.5 - 0.5 + (i === 0 ? 0.5 : 0)} width="30" height="4.3" fill="#B22234" />
          ))}
          <rect width="14" height="16.5" fill="#3C3B6E" />
          <g fill="#FFFFFF">
            {[3.5, 7, 10.5].flatMap((x) => [4, 8.5, 13].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" />))}
          </g>
        </svg>
      )
    case 'jp':
      return (
        <svg viewBox="0 0 30 30" className="block h-full w-full">
          <rect width="30" height="30" fill="#FFFFFF" />
          <circle cx="15" cy="15" r="7.5" fill="#BC002D" />
        </svg>
      )
    case 'tr':
      return (
        <svg viewBox="0 0 30 30" className="block h-full w-full">
          <rect width="30" height="30" fill="#E30A17" />
          <circle cx="12.5" cy="15" r="7.2" fill="#FFFFFF" />
          <circle cx="14.3" cy="15" r="5.8" fill="#E30A17" />
          <polygon
            fill="#FFFFFF"
            points="17.30,15.00 19.55,14.24 19.58,11.86 21.00,13.76 23.27,13.06 21.90,15.00 23.27,16.94 21.00,16.24 19.58,18.14 19.55,15.76"
          />
        </svg>
      )
    case 'kz':
      return (
        <svg viewBox="0 0 30 30" className="block h-full w-full">
          <rect width="30" height="30" fill="#00AFCA" />
          <circle cx="15" cy="12.5" r="6" fill="none" stroke="#FEC50C" strokeWidth="1.6" strokeDasharray="1.2 1.15" />
          <circle cx="15" cy="12.5" r="3.8" fill="#FEC50C" />
          <path d="M8.5 20.5 Q15 16.8 21.5 20.5 Q15 19.2 8.5 20.5 Z" fill="#FEC50C" />
        </svg>
      )
    case 'gb':
      return (
        <svg viewBox="15 0 30 30" className="block h-full w-full">
          <defs>
            <clipPath id={`gbt${uid}`}>
              <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
            </clipPath>
          </defs>
          <rect width="60" height="30" fill="#012169" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
          <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#gbt${uid})`} stroke="#C8102E" strokeWidth="4" />
          <path d="M30,0 v30 M0,15 h60" stroke="#FFFFFF" strokeWidth="10" />
          <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
        </svg>
      )
  }
}
