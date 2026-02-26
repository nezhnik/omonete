## Кратко о проекте omonete.ru

- **Тип проекта**: статический сайт на Next.js (App Router, `output: 'export'`), деплой через заливку папки `out` на хостинг.
- **Цель**: популяризация нумизматики — каталог монет, статьи о монетных дворах, удобный просмотр информации для новичков и коллекционеров.
- **Основные разделы**: главная, каталог монет, детали монеты, страница монетных дворов, портфолио.

---

## Техническая архитектура

- **Фреймворк**: Next.js 16 (app directory).
- **Сборка**: `npm run build`
  - `data:rectangular` → `public/data/rectangular-coins.json`
  - `mints:webp` → конвертация логотипов дворов в WebP (`public/image/Mints/*.webp`)
  - `data:export` → выгрузка монет и мд из БД в статические JSON (`public/data/coins*.json`, `public/data/mints.json`)
  - `next build` + `output: 'export'` → генерация **папки `out/`** для деплоя.
- **Деплой**:
  - После `npm run build` заливать **содержимое папки `out`** в корень сайта на хостинге (ISPmanager / Reg.ru).
  - В корне сайта должны быть: `index.html`, `.htaccess`, папки `_next`, `catalog`, `coins`, `mints`, `image`, `data` и т.д.

---

## Данные по монетам

- Источник данных: БД + скрипты в `scripts/` (экспорт в JSON).
- Основные файлы:
  - `public/data/coins.json` — список монет для каталога.
  - `public/data/coin-ids.json` — список ID для `generateStaticParams`.
  - `public/data/coins/[id].json` — отдельный JSON на каждую монету (детальная страница).
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
- **Монетные дворы (список)**: `app/mints/page.tsx`
- **Статья о монетном дворе**: `app/mints/[slug]/page.tsx`, `components/MintArticle.tsx`, данные в `lib/mint-articles.ts`
- **Обработка картинок и данных**: папка `scripts/` (экспорт монет, загрузка и оптимизация изображений и т.п.)

