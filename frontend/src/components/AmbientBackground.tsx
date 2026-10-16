import { useSeason } from '@/lib/season'

/** Силуэт летучей мыши для сезонного фона. */
const Bat = ({ n }: { n: 1 | 2 | 3 }) => (
  <svg className={`season-bat season-bat--${n}`} viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">
    <path d="M32 6c2 0 3.4 1.5 4 3.4 1.8-1.6 4-2.4 6.3-2.4 3.6 0 6.6 2 9.8 5.6 1.5-2.2 3.4-3.6 5.6-4.2-1.2 2.4-1.5 4.8-.9 7.2-2.8-.6-5.3.2-7.6 2.3-2.6 2.4-5 3.6-7.3 3.6-2.5 0-4.6-1-6.3-3-.9 2.2-2 3.3-3.6 3.3s-2.7-1.1-3.6-3.3c-1.7 2-3.8 3-6.3 3-2.3 0-4.7-1.2-7.3-3.6-2.3-2.1-4.8-2.9-7.6-2.3.6-2.4.3-4.8-.9-7.2 2.2.6 4.1 2 5.6 4.2C15.1 9 18.1 7 21.7 7c2.3 0 4.5.8 6.3 2.4.6-1.9 2-3.4 4-3.4z" />
  </svg>
)

/**
 * Паутина в углу экрана: четверть круга с радиальными нитями и дугами между ними.
 * Висит в левом верхнем и (зеркально) в правом верхнем углу.
 */
const Web = ({ side }: { side: 'l' | 'r' }) => (
  <svg className={`season-web season-web--${side}`} viewBox="0 0 120 120" fill="none" stroke="currentColor" aria-hidden="true">
    <g strokeWidth="1.1" strokeLinecap="round">
      {/* Нити от угла. */}
      <path d="M0 0 L120 0M0 0 L108 42M0 0 L84 84M0 0 L42 108M0 0 L0 120" />
      {/* Дуги между нитями: чем дальше от угла, тем провисание заметнее. */}
      <path d="M26 0 Q20 20 0 26" />
      <path d="M50 0 Q38 38 0 50" />
      <path d="M76 0 Q58 58 0 76" />
      <path d="M104 0 Q78 78 0 104" />
      {/* Паучок на нижней нити. */}
      <circle cx="64" cy="64" r="3.4" fill="currentColor" stroke="none" />
      <path d="M61 61 L55 57M61 67 L55 71M67 61 L73 57M67 67 L73 71" strokeWidth="0.9" />
    </g>
  </svg>
)

/** Тыква: силуэт с долями и черенком, лежит в фоне сезонной темы. */
const Pumpkin = ({ n }: { n: 1 | 2 }) => (
  <svg className={`season-pumpkin season-pumpkin--${n}`} viewBox="0 0 64 56" aria-hidden="true">
    <path
      fill="currentColor"
      d="M32 10c4-6 11-7 15-5-3 1-5 3-6 5 7-1 14 4 17 12 4 11 0 24-8 29-4 3-8 2-11 0-2-1.4-5-1.4-7 0-3 2-7 3-11 0-8-5-12-18-8-29 3-8 10-13 17-12 0 0 1.4.7 2 0z"
    />
    <path
      stroke="rgba(0,0,0,0.35)"
      strokeWidth="1.6"
      fill="none"
      d="M22 16c-4 8-4 22 0 31M42 16c4 8 4 22 0 31M32 14v36"
    />
  </svg>
)

/** Плавный ч/б/серый фон. Стили и анимация в styles/index.css (.ambient). */
export default function AmbientBackground() {
  const season = useSeason()

  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient__layer ambient__layer--a" />
      <div className="ambient__layer ambient__layer--b" />
      {season === 'halloween' && (
        <div className="season-decor">
          <Web side="l" />
          <Web side="r" />
          <Pumpkin n={1} />
          <Pumpkin n={2} />
          <Bat n={1} />
          <Bat n={2} />
          <Bat n={3} />
        </div>
      )}
      <div className="ambient__grain" />
    </div>
  )
}
