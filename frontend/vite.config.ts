import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Telegram Mini App требует hash-роутинг и относительные пути (base: './'),
// чтобы приложение корректно открывалось из WebView Telegram.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
  },
})
