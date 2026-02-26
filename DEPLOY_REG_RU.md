# Развёртывание omonete-app на Reg.ru (ISPmanager) → omonete.ru

---

## Без сервера (только файловый менеджер ISPmanager)

**Да, получится.** Нужно заливать не исходники (.tsx), а **собранную статику** — папку `out`.

1. **Локально** в папке `omonete-app`:
   ```bash
   npm ci
   npm run build
   ```
2. После сборки появится папка **`out`** — в ней готовые HTML, JS, CSS (без .tsx).
3. В **Менеджере файлов** ISPmanager открой корень сайта (например `/www/omonete.ru/`).
4. Удали из корня старые файлы проекта (app, components, package.json и т.д.), если заливал их раньше.
5. Залей **содержимое** папки `out`: все файлы и папки из `out` должны лежать прямо в корне сайта (чтобы в корне был `index.html`, папка `_next`, папки `catalog/`, `portfolio/`, `login/` и файл **`.htaccess`**).
6. Сохрани. Сайт должен открываться по домену.

**Если каталог или портфолио дают 403:** в проекте включён `trailingSlash: true` — страницы лежат в подпапках (`catalog/index.html`, `portfolio/index.html`). Ссылки ведут на `/catalog/`, `/portfolio/`. Файл `.htaccess` в корне редиректит запросы без слеша (`/catalog` → `/catalog/`). Убедись, что залил актуальный `out` после `npm run build` и что в корне сайта есть `.htaccess`.

В проекте включены `output: 'export'` и `trailingSlash: true` в `next.config.ts`, поэтому `npm run build` создаёт папку `out` с такой структурой.

---

## Почему не работает «просто заливка» исходников

Если залить в корень сайта папку с исходниками (app, components, .tsx и т.д.), хостинг **не выполняет** их — он только отдаёт файлы. Сервер не понимает .tsx и не запускает Next.js, поэтому «Сайт размещен некорректно». Нужна либо **собранная статика** (папка `out`, см. выше), либо **Node на сервере** (разделы ниже).

---

## С сервером (Node.js + SSH)

### 1. Подготовка проекта локально

В папке `omonete-app`:

```bash
npm ci
npm run build
```

Проверь, что папка `.next` и файл `package.json` есть. На сервер понадобятся: **вся папка проекта** (включая `.next`, `node_modules` можно не копировать — поставить на сервере через `npm ci --production` или `npm ci`).

---

### 2. Загрузка на сервер Reg.ru

**Вариант А: через Git (удобно для обновлений)**

1. Создай репозиторий (GitHub/GitLab/любой), запушь туда проект (только папку `omonete-app` или весь репозиторий).
2. В ISPmanager: **Сайты** → домен **omonete.ru** → каталог сайта (например `/var/www/omonete.ru/data` или как у тебя).
3. Включи **SSH** для пользователя сайта, зайди по SSH в этот каталог и выполни:
   ```bash
   git clone <url-репозитория> .
   cd omonete-app   # если репо — корень с omonete-app внутри
   npm ci
   npm run build
   ```

**Вариант Б: через FTP/SFTP (файловый менеджер ISPmanager)**

1. В ISPmanager открой **Файловый менеджер** для домена omonete.ru.
2. Залей в каталог сайта:
   - все файлы из `omonete-app` (включая `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `tailwind.config.ts`, папки `app`, `components`, `public`, `.next` после сборки).
3. По SSH зайди в каталог сайта и выполни:
   ```bash
   cd /путь/к/сайту/omonete.ru
   npm ci
   npm run build
   ```

Папку `node_modules` можно не заливать — она создаётся из `npm ci`.

---

### 3. Node.js на сервере

В ISPmanager: **Программное обеспечение** (или **Дополнительное ПО**) → установи **Node.js** (например 20 LTS), если ещё не установлен.

Проверка по SSH:

```bash
node -v   # v20.x.x
npm -v
```

---

### 4. Запуск приложения (PM2)

Next.js по умолчанию слушает порт **3000**. Запуск через PM2 сохранит процесс после отключения SSH.

Установка PM2 (если нет):

```bash
npm install -g pm2
```

В каталоге сайта (где есть `package.json` и собранный `.next`):

```bash
cd /var/www/omonete.ru/data   # или твой путь
pm2 start npm --name "omonete" -- start
# или явно:
# pm2 start node_modules/next/dist/bin/next --name "omonete" -- start
```

Сохранить список процессов, чтобы после перезагрузки сервера приложение поднялось само:

```bash
pm2 save
pm2 startup
```

Проверка: открой в браузере `http://IP_СЕРВЕРА:3000` — должен открыться сайт.

---

### 5. Настройка Nginx (прокси на omonete.ru)

Чтобы сайт открывался по **https://omonete.ru**, Nginx должен проксировать запросы на порт 3000.

В ISPmanager: **Сайты** → **omonete.ru** → **Настройка Nginx** (или правка конфига вручную).

Пример конфига (можно вставить в «Дополнительная конфигурация Nginx» или в виртуальный хост):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
}
```

Включи **SSL** для omonete.ru (Let's Encrypt в ISPmanager), чтобы работал HTTPS.

Перезапуск Nginx после правок (если нужно):

```bash
sudo systemctl reload nginx
```

---

### 6. Краткий чеклист

| Шаг | Действие |
|-----|----------|
| 1 | Локально: `npm ci && npm run build` |
| 2 | Загрузить проект на сервер (Git или FTP) |
| 3 | На сервере в каталоге сайта: `npm ci && npm run build` |
| 4 | Запуск: `pm2 start npm --name "omonete" -- start` |
| 5 | `pm2 save` и `pm2 startup` |
| 6 | Nginx: proxy_pass на 127.0.0.1:3000 для omonete.ru |
| 7 | Включить SSL для omonete.ru |

После этого сайт должен открываться по **https://omonete.ru**.

---

### Обновление сайта

При изменениях в коде:

1. На сервере в каталоге проекта: `git pull` (если используешь Git) или залей обновлённые файлы.
2. Затем:
   ```bash
   npm ci
   npm run build
   pm2 restart omonete
   ```

---

**Без сервера:** см. раздел в начале — [Без сервера (только файловый менеджер ISPmanager)](#без-сервера-только-файловый-менеджер-ispmanager).
