import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'
import { initTelegram } from './lib/telegram'

// Telegram Mini App должен сообщить клиенту, что готов, до первой отрисовки —
// иначе часть API (initData, тема, haptics) может быть недоступна.
initTelegram()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
