import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'
import { initTelegram } from './lib/telegram'
import { useAppStore } from './store/useAppStore'

/*
 * Telegram передаёт параметры запуска в hash: …/lumavpnhere/#tgWebAppData=…
 * telegram-web-app.js уже прочитал их при загрузке, а HashRouter принял бы
 * «tgWebAppData=…» за путь: открывался неизвестный экран, таб-бар прятался
 * и появлялась кнопка Back. Сбрасываем hash на главную до старта роутера.
 */
if (!window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)
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
