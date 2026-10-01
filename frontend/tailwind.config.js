/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Монохромная палитра LynkVPN: чёрный → графит → серебро, как на лого.
      // Цвет появляется только в статусах (активна / истекает / ошибка).
      colors: {
        ink: '#030304',
        fg: '#f4f4f6',
        dim: '#a1a1aa',
        faint: '#63636b',
        ok: '#8be3b0',
        warn: '#f0c674',
        bad: '#ff8a8a',
      },
      fontFamily: {
        // Inter Variable отдаётся вместе с приложением (@fontsource-variable/inter), без Google Fonts.
        sans: ['Inter Variable', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '24px',
        pill: '999px',
      },
    },
  },
  plugins: [],
}
