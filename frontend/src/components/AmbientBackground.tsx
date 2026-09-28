/** Переливающийся ч/б/серый фон — стили и анимация в styles/index.css (.ambient). */
export default function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient__blob ambient__blob--a" />
      <div className="ambient__blob ambient__blob--b" />
      <div className="ambient__blob ambient__blob--c" />
      <div className="ambient__streak" />
      <div className="ambient__sheen" />
      <div className="ambient__grain" />
      <div className="ambient__vignette" />
    </div>
  )
}
