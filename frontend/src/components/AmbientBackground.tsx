/** Плавный ч/б/серый фон. Стили и анимация в styles/index.css (.ambient). */
export default function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient__layer ambient__layer--a" />
      <div className="ambient__layer ambient__layer--b" />
      <div className="ambient__grain" />
    </div>
  )
}
