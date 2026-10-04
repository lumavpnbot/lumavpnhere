import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
// Шрифт лежит рядом с приложением: раньше CSS Google Fonts блокировал запуск (из РФ он отвечает медленно).
import '@fontsource-variable/inter'
import './styles/index.css'
import { initTelegram } from './lib/telegram'
import { useAppStore } from './store/useAppStore'

/*
 * Telegram передаёт параметры запуска в hash: …/lumavpnhere/#tgWebAppData=…
 * telegram-web-app.js уже прочитал их при загрузке, а HashRouter принял бы
 * «tgWebAppData=…» за путь: открывался неизвестный экран, таб-бар прятался
 * и появлялась кнопка Back. Сбрасываем hash на главную до старта роутера.
 */
// Кнопки бота открывают Mini App сразу на нужном экране: ?screen=transfer (перенос подписки),
// ?screen=review (просьба оценить: открывается выбор звёзд).
const START_SCREENS: Record<string, string> = { transfer: '/account/transfer', review: '/reviews?rate=1' }
if (!window.location.hash.startsWith('#/')) {
  const start = START_SCREENS[new URLSearchParams(window.location.search).get('screen') ?? ''] ?? '/'
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${start}`)
}

initTelegram()
document.documentElement.lang = useAppStore.getState().lang

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
