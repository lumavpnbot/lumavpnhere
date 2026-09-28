/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Своя палитра, намеренно отстроена от elix (фиолетовый/индиго):
        // Luma — тёплое свечение (янтарь → розовый), а не холодный фиолет.
        bg: '#0b0a10',
        surface: '#15131c',
        'surface-2': '#1c1a24',
        border: '#2a2733',
        accent: '#ff8a3d',
        'accent-2': '#ff5f8f',
        success: '#22c55e',
        warn: '#f59e0b',
        danger: '#ef4444',
        'text-primary': '#f2f0f5',
        'text-dim': '#8f8a9c',
      },
      borderRadius: {
        card: '18px',
        pill: '100px',
      },
    },
  },
  plugins: [],
}
