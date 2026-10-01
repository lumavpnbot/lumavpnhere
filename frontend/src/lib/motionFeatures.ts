// Анимации framer-motion грузятся отдельным файлом после старта (LazyMotion в App.tsx):
// первый экран не ждёт ~100 КБ кода анимаций. domMax нужен из-за перетаскивания шторки (Sheet).
export { domMax as default } from 'framer-motion'
