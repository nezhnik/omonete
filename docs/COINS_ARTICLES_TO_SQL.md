# Перенос монет и статей в SQL (Supabase или Reg.ru)

Что нужно, чтобы подгружать каталог монет и статьи дворов из базы вместо статических JSON и кода.

---

## Вариант: БД на Reg.ru (уже настроено)

У вас уже есть MySQL на Reg.ru: таблицы **coins** и **mints**, подключение по `DATABASE_URL` в `.env`. Скрипты (`export-coins-to-json.js`, `sync-from-cbr-xlsx.js` и др.) успешно к ней ходят.

**Монеты** — переносить никуда не нужно: они уже в Reg.ru. Нужно только:

1. **API-маршруты в Next.js** (серверные), которые через `lib/db.ts` и `getConnection()` читают из MySQL и отдают JSON: список монет, одна монета по id, при необходимости «монеты той же серии».
2. **На Vercel** в Environment Variables добавить **DATABASE_URL** (тот же формат `mysql://user:pass@host:port/db`) и убедиться, что **Reg.ru разрешает удалённые подключения к MySQL** с любых IP (или с диапазона IP Vercel). В панели Reg.ru: раздел баз данных → доступ к MySQL — если сейчас только «localhost», открыть удалённый доступ, иначе Vercel не достучится.
3. В приложении заменить `fetch("/data/coins.json")` и `fetch(\`/data/coins/${id}.json\`)` на вызовы этих API (например `GET /api/coins`, `GET /api/coins/[id]`).

**Статьи дворов** — в Reg.ru таблицы пока нет. Нужно:

1. В той же БД на Reg.ru создать таблицу **mint_articles** (slug, name, short_name, country, logo_url, sections JSON, facts JSON и т.д.).
2. Скрипт однократного импорта: данные из `lib/mint-articles.ts` → INSERT в `mint_articles`.
3. API-маршрут `GET /api/mints/[slug]` (и при необходимости список slug), который читает из MySQL и отдаёт статью. В `app/mints/[slug]/page.tsx` вызывать этот API вместо `getMintArticle()`.

Итого: да, БД на Reg.ru можно использовать — всё уже настроено для монет; остаётся добавить таблицу статей, API в приложении и при необходимости открыть удалённый доступ к MySQL в панели Reg.ru.

---

## Сделано (реализовано)

- **API монет:** `GET /api/coins` (список), `GET /api/coins/[id]` (карточка + sameSeries). Читают из MySQL (Reg.ru) через `lib/coinApiShape.ts` и `lib/db.ts`. При отсутствии DATABASE_URL или ошибке БД возвращают 503.
- **API статей:** `GET /api/mints` (список slug), `GET /api/mints/[slug]` (одна статья). Читают из таблицы `mint_articles`; если таблицы нет или запись не найдена — fallback на данные из `lib/mint-articles.ts`.
- **Приложение** загружает монеты и статьи через API с fallback на статику: сначала запрос к API, при ошибке — `/data/coins.json`, `/data/coins/[id].json` и код статей. Используются `lib/fetchCoins.ts` и `lib/fetchMintArticle.ts`.
- **Таблица статей:** `scripts/mint_articles_schema.sql` — выполнить в phpMyAdmin (Reg.ru). Импорт: сохранить ответ `/api/mint-articles-export` в файл `mint-articles.json` в корень проекта, затем `npm run mints:import`.

---

## 1. Монеты (вариант Supabase)

**Сейчас:** приложение читает `public/data/coins.json` (список) и `public/data/coins/[id].json` (карточка). Данные туда попадают скриптом `export-coins-to-json.js` из MySQL.

**Цель:** хранить те же данные в Supabase и отдавать их через API или клиент Supabase.

### Нужно сделать

- **Таблица в Supabase**  
  Поля по текущему формату карточки монеты (id, title, seriesName, imageUrl, imageUrls, mintName, mintShort, mintCountry, year, faceValue, metal, metalCode, metalColor, metalCodes, mintage, mintageDisplay, weightG, weightOz, purity, quality, diameterMm, thicknessMm, lengthMm, widthMm, catalogSuffix, rectangular, mintLogoUrl и при необходимости sameSeries как JSONB или отдельная связь).

- **Скрипт импорта**  
  Читать `public/data/coins.json` и `public/data/coins/*.json` и вставлять/обновлять строки в Supabase (по id). Запуск после обновления JSON (вместо или вместе с текущим экспортом из MySQL).

- **Правки в приложении**  
  - Список: вместо `fetch("/data/coins.json")` — запрос к API (например `GET /api/coins`) или Supabase `from("coins").select(...)`.  
  - Карточка: вместо `fetch(\`/data/coins/${id}.json\`)` — запрос к API (`GET /api/coins/[id]`) или Supabase.  
  Места: `app/page.tsx`, `app/catalog/page.tsx`, `app/portfolio/page.tsx`, `app/coins/[id]/CoinPageClient.tsx`, `app/layout.tsx` (preload).

- **Политики RLS**  
  Таблицу `coins` сделать только для чтения для anon (или для всех), без персональных данных.

---

## 2. Статьи дворов

**Сейчас:** данные в коде — `lib/mint-articles.ts` (объект `MINT_ARTICLES`). Используются в `app/mints/[slug]/page.tsx` и `components/MintArticle.tsx` через `getMintArticle(slug)` и `getMintArticleSlugs()`.

**Цель:** хранить статьи в Supabase и подгружать по slug.

### Нужно сделать

- **Таблица в Supabase**  
  Например `mint_articles` с полями: slug (pk), name, short_name, country, logo_url, gallery_images (jsonb или text[]), sections (jsonb — массив {title, content}), facts (jsonb или text[]), famous_coins (jsonb), sources_line. По структуре типа `MintArticleData` из `lib/mint-articles.ts`.

- **Скрипт импорта**  
  Либо один раз экспортировать текущий `MINT_ARTICLES` в JSON и залить в Supabase, либо скрипт, который читает `lib/mint-articles.ts` (или сгенерированный JSON) и вставляет/обновляет строки в `mint_articles`.

- **Правки в приложении**  
  - В `app/mints/[slug]/page.tsx`: вместо `getMintArticle(slug)` и `getMintArticleSlugs()` — запрос к API (`GET /api/mints`, `GET /api/mints/[slug]`) или к Supabase.  
  - Для `generateStaticParams` при SSR: либо получать список slug из API/Supabase при сборке, либо перейти на динамический рендер без статического списка.

- **Политики RLS**  
  Только чтение для anon.

---

## 3. Общее

- **Переменные окружения**  
  Уже есть `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Этого достаточно для чтения из браузера или с сервера.

- **Резервный вариант**  
  Можно оставить fallback: если Supabase недоступен или таблицы пусты — использовать текущие `fetch("/data/coins.json")` и `getMintArticle()` из кода (тогда статьи остаются в `mint-articles.ts` до заполнения БД).

- **Порядок работ**  
  1) Создать таблицы и RLS в Supabase.  
  2) Написать скрипты импорта (JSON → Supabase, статьи → Supabase).  
  3) Добавить API-маршруты или прямые запросы к Supabase в приложении.  
  4) Переключить страницы каталога, карточки монеты и страницы дворов на новый источник данных.

После этого монеты и статьи будут подгружаться из SQL (Supabase), а локальные данные (JSON и код статей) можно использовать как источник для импорта и бэкапов.
