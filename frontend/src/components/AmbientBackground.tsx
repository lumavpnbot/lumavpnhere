import { useSeason } from '@/lib/season'

/** Силуэт летучей мыши для сезонного фона. */
const Bat = () => (
  <svg className="season-bat" viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">
    <path d="M32 6c2 0 3.4 1.5 4 3.4 1.8-1.6 4-2.4 6.3-2.4 3.6 0 6.6 2 9.8 5.6 1.5-2.2 3.4-3.6 5.6-4.2-1.2 2.4-1.5 4.8-.9 7.2-2.8-.6-5.3.2-7.6 2.3-2.6 2.4-5 3.6-7.3 3.6-2.5 0-4.6-1-6.3-3-.9 2.2-2 3.3-3.6 3.3s-2.7-1.1-3.6-3.3c-1.7 2-3.8 3-6.3 3-2.3 0-4.7-1.2-7.3-3.6-2.3-2.1-4.8-2.9-7.6-2.3.6-2.4.3-4.8-.9-7.2 2.2.6 4.1 2 5.6 4.2C15.1 9 18.1 7 21.7 7c2.3 0 4.5.8 6.3 2.4.6-1.9 2-3.4 4-3.4z" />
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
        <div className="season-bats">
          <Bat />
          <Bat />
          <Bat />
        </div>
      )}
      <div className="ambient__grain" />
    </div>
  )
}
