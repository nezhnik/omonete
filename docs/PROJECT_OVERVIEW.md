# Обзор проекта omonete.ru

**Быстрый контекст**: Next.js статический экспорт (`output: 'export'`), деплой — заливка папки `out/` на Reg.ru. Данные: монеты и дворы из MySQL → JSON в `public/data/`; цены металлов — ЦБ РФ → крон → `data/metal-prices.json`. API в проде не используется (папка убирается при билде). Портфолио и авторизация — Supabase.

---

## Текущий статус (чтобы не терять контекст)

- **Крон на Reg.ru уже настроен.** В планировщике заданий Reg.ru добавлено задание: раз в день запуск `php .../cron-metal-prices.php`. Пользователю был прислан обновлённый код/инструкция, что именно вставить в планировщик; крон обновляет курс доллара, металлы ЦБ и медь за последние 3 дня и перезаписывает `data/metal-prices.json` на сервере.
- **БД (MySQL на Reg.ru, доступ через phpMyAdmin):**
  - **Таблицы для металлов и курса:** `metal_prices` (дата, xau, xag, xpt, xpd, xcu — цены в руб/г), `cbr_rates` (дата, usd_rub — курс ЦБ).
  - **Данные уже занесены:** курс доллара с 1992 года (`cbr_rates`), металлы ЦБ с 2003 года, медь (xcu) с 2006 года (`metal_prices`). Бэкфилл выполнен один раз (`npm run backfill:all`); крон только подтягивает последние 3 дня.
  - Подключение: `.env` в корне проекта и в корне сайта на сервере — строка `DATABASE_URL=mysql://user:password@host:port/database`. На Reg.ru хост/порт/база берутся из панели (phpMyAdmin).
- При ответах по проекту опираться на этот статус: крон настроен, БД заполнена, phpMyAdmin — интерфейс к той же MySQL, что использует сайт и крон.

---

## Кратко о проекте omonete.ru

- **Тип проекта**: статический сайт на Next.js (App Router, `output: 'export'`), деплой через заливку папки `out` на хостинг.
- **Цель**: популяризация нумизматики — каталог монет, статьи о монетных дворах, графики цен металлов, портфолио коллекционера.
- **Основные разделы**: главная, каталог монет, детали монеты, монетные дворы, графики металлов, портфолио, личные данные.

---

## 1. Экономия запросов к ЦБ (крон)

- **Один запуск крона в рабочий день**: 1 запрос к ЦБ (последние 3 дня). При первом заполнении БД — до 10 запросов (бэкфилл за 10 лет).
- **Уже сделано**: в выходные (суббота, воскресенье) запросы к ЦБ **не отправляются** — экспорт БД → JSON всё равно выполняется.
- **Экономия за год только за счёт выходных**: 52×2 = **104 запроса**.
- **Если добавить праздники**: ЦБ не публикует данные в нерабочие праздничные дни РФ (Новый год, 8 Марта, 9 Мая и т.д.). Таких дней в году обычно **около 14–16** (часть уже попадает в выходные). Дополнительная экономия при проверке «праздник»: **порядка 14 запросов в год**. Итого при выходных + праздниках: **~118 запросов в год** вместо 365.

---

## Техническая архитектура

- **Фреймворк**: Next.js 16 (app directory).
- **Сборка**: `npm run build`
  - `data:rectangular` → `public/data/rectangular-coins.json`
  - `mints:webp` → конвертация логотипов дворов в WebP (`public/image/Mints/*.webp`)
  - `data:export` → выгрузка монет и мд из БД в статические JSON (`public/data/coins*.json`, `public/data/mints.json`)
  - `move-api-for-export.js off` → временно убирает `app/api`, чтобы `next build` не падал на `force-dynamic`
  - `next build` (output: 'export') → папка **`out/`**
  - `clean-metal-prices-from-out.js` → удаляет `out/data/metal-prices.json` (на проде JSON обновляется кроном на сервере)
  - `move-api-for-export.js on` → возвращает `app/api`
- **Деплой**:
  - Заливать **содержимое `out/`** в корень сайта (Reg.ru / ISPmanager).
  - На сервере в корне: `index.html`, `data/` (в т.ч. `data/metal-prices.json` пишет крон), `_next/`, `catalog/`, `coins/`, `mints/`, `image/` и т.д.

---

## API и внешние источники

### ЦБ РФ (драгоценные металлы)

- **Назначение**: учётные цены на золото, серебро, платину, палладий (руб/г). Медь ЦБ не публикует.
- **Сервис**: `https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx` (SOAP), метод `DragMetDynamic`, параметры `fromDate`, `ToDate`.
- **Где используется**: крон (Node и PHP) запрашивает ЦБ и пишет в таблицу `metal_prices`, затем экспортирует в `data/metal-prices.json`. На фронте графики и портфолио читают этот JSON.

### Роуты app/api (только dev / fallback)

При `output: 'export'` папка `app/api` на время билда переносится в `.api-backup-for-export`, в `out/` не попадает. На Reg.ru API не работает.

| Роут | Назначение |
|------|------------|
| `GET /api/metal-prices?period=1m|1y|5y|10y|all` | Запрос к ЦБ, ответ в формате JSON для графиков. На проде не вызывается — данные из статического JSON. |
| `GET /api/coins`, `GET /api/coins/[id]` | Список и одна монета из БД. На проде используются `/data/coins.json` и `/data/coins/[id].json`. |
| `GET /api/mints`, `GET /api/mints/[slug]` | Список дворов и двор по slug. На проде — `/data/mints.json` и статика страниц дворов. |
| `GET /api/mint-articles-export` | Экспорт статей дворов (если нужен JSON). |

**Зачем API оставлен**: в режиме `npm run dev` графики могут брать данные из `/api/metal-prices`, если статического JSON ещё нет; плюс возможность позже переехать на хостинг с Node.

---

## Графики металлов

- **Страница**: `app/charts/page.tsx`. Компонент графика: тот же файл, `MetalChart`.
- **Источники данных (по приоритету)**:
  1. Статический файл **`/data/metal-prices.json`** — обновляется кроном **в рабочие дни** (пн–пт): запрос к ЦБ, запись в БД, экспорт в этот файл. В выходные крон не обращается к ЦБ и не перезаписывает файл.
  2. Fallback: **`/api/metal-prices?period=...`** (только в dev или если JSON недоступен).
- **Формат JSON**: объект по периодам `1m`, `1y`, `5y`, `10y`, `all`; в каждом — массивы `XAU`, `XAG`, `XPT`, `XPD` с элементами `{ label, value }`. Для периода «год» в `label` выводится год (например, «13 янв. 25»). Период «Все» — с июля 2003 г., сэмплирование по месяцам.
- **Медь**: данных в ЦБ нет; на графике медь — демо-данные (подпись в описании страницы).
- **Крон**: запускается по расписанию раз в день; в рабочие дни (пн–пт) выполняет запрос к ЦБ, обновление БД и экспорт в JSON; в выходные сразу выходит без запросов и без перезаписи файла. См. `scripts/cron-metal-prices.js` и `scripts/cron-metal-prices.php`.

---

## Крон-задачи

### Node (локально / свой сервер)

- **Скрипт**: `scripts/cron-metal-prices.js`. Запуск: `node scripts/cron-metal-prices.js` или `npm run metal-prices:cron`.
- **Нужен**: `.env` с `DATABASE_URL` (MySQL).
- **Логика**: проверка `isCbrWorkingDay()` (не суббота, не воскресенье). В **рабочий день**: запрос к ЦБ за последние 3 дня, вставка в `metal_prices`, чтение из БД и запись `public/data/metal-prices.json`. В **выходной**: запрос к ЦБ и экспорт не выполняются (новых данных нет — лишние чтение БД и запись файла не делаем).

### Reg.ru (PHP)

- **Крон уже настроен:** в планировщике Reg.ru добавлено задание; пользователю был прислан обновлённый код/команда для вставки (запуск `php .../cron-metal-prices.php` раз в день).
- **Файлы**: на сервере используется скрипт из сборки — `out/cron-metal-prices.php` (исходник `public/cron-metal-prices.php`). Он читает **`.env`** из корня сайта (переменная `DATABASE_URL`), а не отдельный config. Альтернативный вариант с конфигом: `scripts/cron-metal-prices.php` + `scripts/cron-metal-prices-config.php.example` (скопировать в `cron-metal-prices-config.php`, не коммитить).
- **Где лежат на сервере**: корень сайта (рядом с `data/`), например `www/omonete.ru/cron-metal-prices.php`. В корне сайта — `.env` с `DATABASE_URL`.
- **Расписание**: раз в день (например утром), команда:  
  `/usr/bin/php /полный/путь/к/корню/сайта/cron-metal-prices.php`
- **В выходной**: запросы к ЦБ не выполняются; экспорт БД → `data/metal-prices.json` выполняется всегда.
- **Обновление кода**: заменить на сервере файл `cron-metal-prices.php` новой версией из репозитория (из `public/cron-metal-prices.php` после сборки). Расписание и путь к PHP менять не нужно.

Подробнее: `docs/CRON_REG_RU_PHP.md`, `docs/CRON_ЧТО_ОСТАЛОСЬ_И_КАК_РАБОТАЕТ.md`.

---

## Данные по монетам

- Источник данных: БД + скрипты в `scripts/` (экспорт в JSON).
- Основные файлы:
  - `public/data/coins.json` — список монет для каталога (генерируется `scripts/export-coins-to-json.js`, входит в `npm run data:export`).
  - `public/data/coin-ids.json` — список ID для `generateStaticParams`.
  - `public/data/coins/[id].json` — отдельный JSON на каждую монету (детальная страница).
- Загрузка на клиенте: `lib/fetchCoins.ts` — сначала запрос к `/data/coins.json` или `/data/coins/[id].json`, при необходимости fallback на `/api/coins` или `/api/coins/[id]`.
- Страница монеты:
  - Роут: `app/coins/[id]/`
  - Серверная часть: `app/coins/[id]/page.tsx` — читает `public/data/coins/[id].json`.
  - Клиентская часть: `app/coins/[id]/CoinPageClient.tsx`.
  - Отрисовка: `components/CoinDetail.tsx`.

---

## Изображения монет

- См. подробности в `docs/IMAGES_STRATEGY.md`.
- Сейчас:
  - Картинки монет берутся из данных экспорта (путь / URL).
  - На деталях монеты главное изображение и галерея рендерятся в `components/CoinDetail.tsx`.
  - Под изображением отображается дисклеймер:
    - **«Вся информация предоставлена в ознакомительных целях из открытых источников и с сайта Центрального банка России cbr.ru»**
- Планы / нюансы:
  - В ЦБ отправлено письмо с запросом разрешения на использование изображений и материалов с сайта `cbr.ru`.
  - Текст письма лежит в `docs/ПИСЬМО_ЦБ_РАЗРЕШЕНИЕ_ИЗОБРАЖЕНИЯ.md`.

---

## Монетные дворы

- Все статьи и данные по дворам: `lib/mint-articles.ts`
  - Типы: `MintArticleData`, `MintFamousEntry`, `MintFamousCategory`.
  - Поля статьи: `slug`, `name`, `shortName`, `country`, `logoUrl`, `galleryImages`, `sections`, `facts`, `famousCoins`, `sourcesLine`.
  - Функции: `getMintArticle`, `getMintArticleSlugs`, `getOtherMints`.
- Страница двора:
  - Роут: `app/mints/[slug]/page.tsx`
  - Компонент: `components/MintArticle.tsx`
  - Список дворов на странице «Монетные дворы» и на главной:
    - `app/mints/page.tsx` — массив `foreignMints` + данные из `public/data/mints.json`.
    - `app/page.tsx` — блок «Монетные дворы мира» с тем же `foreignMints`.

---

## Монетизация / реклама

- На деталях монеты (`components/CoinDetail.tsx`) есть **скрытый** блок «Где можно приобрести или заказать»:
  - В нём была плашка с картинкой `sales.gif` / `sales.webp` и текстом «Здесь могли быть ваша компания или канал» + ссылка на Telegram (`https://t.me/nezhnik`).
  - Сейчас блок отключён флагом:
    - `const SHOW_MONETIZATION_BLOCK = false;`
    - Рендер блока обёрнут в `{SHOW_MONETIZATION_BLOCK && (...)}`.
  - Чтобы вернуть блок, достаточно поменять `SHOW_MONETIZATION_BLOCK` на `true`.

---

## Важные нюансы для «не забыть»

- **Статический экспорт**:
  - В `next.config.ts` включены `output: 'export'` и `trailingSlash: true`.
  - API на проде не работает, данные уже «запечены» в JSON в `public/data/` и попадают в `out/data/`.
- **Каталог монет**:
  - Работает полностью на данных из JSON (`public/data/coins.json` и `public/data/coins/[id].json`).
  - После изменений в БД нужно обязательно прогнать скрипты экспорта и сделать `npm run build`, чтобы обновились JSON.
- **Изображения ЦБ**:
  - Формально использование материалов с `cbr.ru` требует согласия правообладателя (пользовательское соглашение ЦБ).
  - В проекте учтено:
    - есть дисклеймер под картинкой монеты;
    - есть подготовленное письмо в Банк России с просьбой о разрешении;
    - монетизационный блок на деталях монеты сейчас скрыт.

---

## Где что искать по коду

- **Главная страница**: `app/page.tsx`
- **Каталог монет**: `app/catalog/page.tsx`
- **Детали монеты**: `app/coins/[id]/page.tsx`, `app/coins/[id]/CoinPageClient.tsx`, `components/CoinDetail.tsx`
- **Графики металлов**: `app/charts/page.tsx` (страница и компонент `MetalChart`)
- **Портфолио**: `app/portfolio/page.tsx` (данные из Supabase + кеш в `AuthProvider`; цены металлов — `/data/metal-prices.json` или `/api/metal-prices`)
- **Личные данные**: `app/profile/page.tsx`
- **Монетные дворы (список)**: `app/mints/page.tsx` (данные из `public/data/mints.json` + `lib/mint-articles.ts`)
- **Статья о монетном дворе**: `app/mints/[slug]/page.tsx`, `components/MintArticle.tsx`, данные в `lib/mint-articles.ts`
- **API (dev)**: `app/api/metal-prices/route.ts`, `app/api/coins/route.ts`, `app/api/coins/[id]/route.ts`, `app/api/mints/route.ts`, `app/api/mints/[slug]/route.ts`
- **Скрипты сборки и крона**: `scripts/export-coins-to-json.js`, `scripts/cron-metal-prices.js`, `scripts/cron-metal-prices.php`, `scripts/move-api-for-export.js`, `scripts/clean-metal-prices-from-out.js`

