# Страница статуса на Uptime Kuma (ТЗ v6.3 · 02)

Бэкенд LYNK уже умеет показывать статус сам: мониторинг узлов раз в минуту, uptime за 30 дней,
инциденты с автозакрытием, публичная страница `GET /status` и API `GET /api/status`.
Uptime Kuma подключается как источник данных, если нужен отдельный VPS и домен `status.lynk.io`.

## 1. Развернуть

```bash
# на отдельном VPS, DNS-запись status.lynk.io → IP этого сервера
docker compose up -d
```

Caddy сам выпустит SSL-сертификат для `status.lynk.io`.

## 2. Настроить

1. Открыть `https://status.lynk.io`, создать админа.
2. Добавить мониторы: по одному на страну (TCP Port или Ping до узла H1). Имя монитора — код
   страны (`fi`, `nl`, `de` …): тогда Mini App покажет флаг и название страны.
3. Status Pages → New Status Page, slug например `lynk`. Добавить мониторы в группу.
4. Edit → Custom CSS → вставить `status-theme.css` (тёмная серебряная тема, форк не нужен).
5. Notifications → Telegram: бот `@lynkorobot`, chat id канала статуса — Kuma сам дублирует алерты в канал.

## 3. Подключить к бэкенду (Railway → Variables)

```
UPTIME_KUMA_URL=https://status.lynk.io
UPTIME_KUMA_SLUG=lynk
STATUS_PAGE_URL=https://status.lynk.io/status/lynk
STATUS_CHANNEL_ID=@lynk_status        # канал для алертов бота (необязательно)
```

С этими переменными бэкенд раз в минуту берёт данные из публичной страницы Kuma
(`/api/status-page/<slug>` и `/api/status-page/heartbeat/<slug>`), хранит историю, считает uptime,
открывает и закрывает инциденты. Виджет в Mini App, раздел «Статус» в админке и кнопка в боте при
сбое работают одинаково с Kuma и без неё.

Без Kuma: достаточно `H1_PANELS` (узлы берутся оттуда) и, если нужно, `STATUS_NODES` для
дополнительных узлов: `[{"name":"nl","host":"nl1.example.com","port":443}]`.
