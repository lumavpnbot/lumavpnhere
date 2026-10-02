# LynkVPN

VPN-сервис в формате Telegram Mini App. Монорепо: `frontend/` (Mini App) + `backend/` (API).

## Структура

```
lynkvpn/
├── frontend/    React + Vite + TS + Tailwind + Zustand - Telegram Mini App
└── backend/     Node + Fastify + TS + Prisma + PostgreSQL - API
```

## Статус проекта

MVP в разработке. Ключевые решения на старте:

- **Платежи:** Telegram Stars, CryptoBot (USDT TRC-20, TON) и Platega: СБП и карта на их странице оплаты (`PLATEGA_MERCHANT_ID` / `PLATEGA_SECRET`, callback: `<PUBLIC_URL>/payments/webhook/platega`). ЮKassa (карты РФ) добавляется позже отдельно - код уже спроектирован под подключение нового провайдера без переделки логики (см. `backend/src/payments`).
- **VPN-инфраструктура:** серверы на панелях H1 (VLESS). Backend работает с ними через адаптер `PanelProvider` (`backend/src/panel`), список панелей задаётся переменной `H1_PANELS`.
- **Тарифы:** Free / Старт / Про, 7 дней trial (10 дней по рефералке).
- **Реферальная программа:** 30% с уровнями (Серебро/Золото/Платина), холд 7 дней, вывод от 500 ₽.

## Быстрый старт

```bash
# Frontend
cd frontend && npm install && npm run dev

# Backend
cd backend && npm install && npm run dev
```

Backend требует `.env` (см. `backend/.env.example`) - подключение к PostgreSQL и Redis, токен бота.
