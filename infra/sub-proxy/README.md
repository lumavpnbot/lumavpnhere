# Подписка и приложение LYNK без VPN

Бэкенд живёт на `lynk-vpn-backend-production.up.railway.app`. Часть провайдеров и мобильных
операторов в России этот домен не пропускает (ошибка TLS), поэтому без включённого VPN подписка
не добавлялась в Happ / INCY / Hiddify и не обновлялась.

Решение: свой домен на своём сервере, который просто пересылает запросы на Railway. Бэкенд,
база и платежи остаются где были.

## 1. Сервер и домен

- **Сервер:** любой небольшой VPS (1 ядро, 512 МБ). Лучше в России (Timeweb, Selectel,
  Yandex Cloud и т. п.): российские адреса открываются даже там, где оператор включил «белые
  списки». Подойдёт и зарубежный VPS, но не тот же, где работает Xray на 443.
- **Домен:** любой, лучше в зоне `.ru`, без Cloudflare. Сделайте A-запись, например
  `sub.ваш-домен.ru` → IP сервера.
- Проверьте, что с сервера открывается Railway:
  ```bash
  curl -sI https://lynk-vpn-backend-production.up.railway.app/health | head -1   # HTTP/2 200
  ```

## 2. Запуск

```bash
# на сервере, установлен Docker
git clone https://github.com/lumavpnbot/lumavpnhere.git && cd lumavpnhere/infra/sub-proxy
cp .env.example .env && nano .env          # SUB_DOMAIN=sub.ваш-домен.ru
docker compose up -d
curl -s https://sub.ваш-домен.ru/health | head -c 200   # должен ответить бэкенд: {"ok":true,…}
```

Caddy сам выпустит сертификат через минуту после запуска (порт 80 должен быть открыт).

## 3. Подключить

1. **Railway → Variables бэкенда:** `SUB_URL=https://sub.ваш-домен.ru`
   С этого момента приложение выдаёт ссылки подписки и кнопки «Открыть в Happ / INCY / Hiddify»
   на новом домене. Тем, кто добавил подписку по старой ссылке, при обновлении (если оно прошло)
   приходит сообщение «Обновите ссылку подписки…»: им нужно удалить подписку и добавить её заново
   из приложения.
2. **Чтобы и само приложение открывалось без VPN** (необязательно): GitHub → Settings → Secrets and
   variables → Actions → Variables → `API_URL` = `https://sub.ваш-домен.ru`, затем перезапустить
   workflow «Deploy frontend» (Actions → Run workflow). Без этой переменной приложение ходит на Railway.

Вебхуки бота и платёжных систем (Telegram, ЮKassa, Platega, CryptoBot) остаются на Railway,
менять ничего не нужно.
