import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Telegram Mini App требует hash-роутинг и относительные пути (base: './'),
// чтобы приложение корректно открывалось из WebView Telegram.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    // Тот же алиас @/* что и в tsconfig.json — там он только для проверки
    // типов, а Rollup (сборка) о нём не знает, пока не прописан здесь.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
})
