# AlienX Arena — Ready To Run (Render)
Готовая игра (пошаговая арена) без БД — всё хранится в памяти процесса, поэтому развернуть максимально просто.

## Render — Web Service
- Root Directory: server
- Build Command: npm install
- Start Command: node index.js
- Env:
  - BOT_TOKEN=твой токен (обязателен, иначе авторизация WebApp не пройдет)
  - (опционально) ORIGIN=https://<ваш-домен>
- Disk: не нужен

## Render — Background Worker
- Root Directory: bot
- Build Command: npm install
- Start Command: node index.js
- Env:
  - BOT_TOKEN=твой токен
  - WEBAPP_URL=https://<домен веб-сервиса>

Открой бота → /start → «🎮 Open Game». Играй.
