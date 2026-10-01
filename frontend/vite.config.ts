import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Соединение с API открываем сразу, параллельно с загрузкой скриптов: /me приходит раньше. */
function preconnectApi(apiUrl: string | undefined): Plugin {
  let origin = ''
  try {
    origin = apiUrl ? new URL(apiUrl).origin : ''
  } catch {
    /* кривой VITE_API_URL: без preconnect */
  }
  return {
    name: 'preconnect-api',
    transformIndexHtml: () => (origin ? [{ tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' }, injectTo: 'head-prepend' }] : []),
  }
}

// Telegram Mini App требует hash-роутинг и относительные пути (base: './'),
// чтобы приложение корректно открывалось из WebView Telegram.
export default defineConfig(({ mode }) => ({
  plugins: [react(), preconnectApi(process.env.VITE_API_URL ?? loadEnv(mode, process.cwd()).VITE_API_URL)],
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
  build: {
    rollupOptions: {
      output: {
        // React и роутер меняются редко: отдельный файл остаётся в кэше Telegram после деплоя.
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//.test(id)) return 'react'
        },
      },
    },
  },
}))
