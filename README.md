# Omonete — каталог монет

Статический сайт-каталог монет (Next.js, export в `out/`). Данные: MySQL → JSON в `public/data/`; цены металлов — ЦБ РФ и крон; портфолио и авторизация — Supabase.

---

## Быстрый старт

```bash
npm install
npm run dev
```

Открыть [http://localhost:3000](http://localhost:3000). Для работы каталога и портфолио нужны `.env` с `DATABASE_URL` (MySQL) и Supabase (см. `docs/ЧТО_СДЕЛАТЬ_ПЕРЕД_ЗАПУСКОМ.md`).

---

## Сборка и деплой

- **Сборка**: `npm run build` — экспорт монет/дворов из БД в JSON, затем `next build` → папка **`out/`**.
- **Деплой**: залить содержимое `out/` на хостинг (Reg.ru и т.д.). Подробнее: `docs/PROJECT_OVERVIEW.md`.

### После изменений в БД (монеты, дворы)

1. **Экспорт**: `node scripts/export-coins-to-json.js` — обновляет `public/data/coins.json` и `public/data/coins/*.json`.
2. **Сборка**: `npm run build` — пересобирает статику в `out/`.
3. **Деплой**: залить `out/` на сервер.

Если менялись только данные (без кода), можно после экспорта запустить `npm run build` — в него уже входит инкрементальный экспорт (`data:export:incremental`).

---

## Синхронизация Perth Mint (как работает и что мы исправили)

Монеты Perth хранятся в БД и подтягиваются из канонических JSON в `data/perth-mint-*.json` (каждый JSON = одна страница товара на perthmint.com с полем `source_url`).

### Порядок шагов (чтобы не было перезаписи чужих данных)

**Порядок обязателен**: сначала импорт (чтобы в БД был `source_url`), затем update-perth.

1. **Fetch** — скачать/обновить данные с сайта Perth:  
   `node scripts/fetch-perth-mint-coin.js` (при необходимости `--refresh`).
2. **Импорт в БД** — совпадение по `source_url`, при отсутствии по `catalog_number`:  
   `node scripts/import-perth-mint-to-db.js`
3. **Обновление из каноников** — **сопоставление сначала по `source_url`**, при отсутствии URL — по `catalog_number`:  
   `node scripts/update-perth-from-canonical-json.js`

Важно: в `update-perth-from-canonical-json.js` запись обновляется каноником **только если у записи тот же `source_url`** (или нет URL и тогда по `catalog_number`). Так разные монеты с разным URL не перезаписываются одним продуктом.

### Что было сломано и как исправили

- **Проблема**: скрипт `update-perth-from-canonical-json.js` сопоставлял все Perth-записи **только по `catalog_number`**. У многих разных монет в БД оказался один и тот же `catalog_number`, поэтому им всем подставлялись одно название и одни картинки (например Kookaburra 2026).
- **Исправление**:
  - Сопоставление **сначала по `source_url`**: обновляем запись только каноником с тем же URL страницы Perth.
  - По `catalog_number` обновление **только если в БД ровно одна запись** с этим номером (без source_url). Если записей несколько — обновление **не выполняется**, в консоль выводится предупреждение.
  - В **import-perth-mint-to-db.js**: при поиске по `catalog_number` если найдено больше одной записи — обновление пропускается (чтобы не перезаписать случайную монету).
- **Восстановление уже перезаписанных данных**:  
  `node scripts/fix-perth-overwritten-coins.js` (при необходимости `--dry` для проверки) — для записей с перезаписанным заголовком сопоставление по metal + diameter_mm + thickness_mm + length_mm + width_mm; один каноник — одна запись. Затем: `node scripts/export-coins-to-json.js` и `npm run build`.

Повторная массовая перезапись предотвращена: по `catalog_number` скрипты обновляют только при уникальной записи; однозначное соответствие «одна запись = один продукт» даёт **source_url**.

Подробный порядок синхронизации Perth: `scripts/PERTH_SYNC_README.md`. Полный обзор: `docs/PROJECT_OVERVIEW.md`.

---

## Безопасное заполнение каталога (на будущее)

- **Однозначная привязка**: у каждой записи в БД по возможности должен быть **source_url** (ссылка на страницу продукта). Тогда обновление и импорт не перезапишут разные монеты одним продуктом.
- **Perth**: обновление по **catalog_number** выполняется только если в БД **одна** запись с этим номером; при нескольких — скрипты пропускают и предупреждают. Подробнее: `docs/PROJECT_OVERVIEW.md` (раздел «Синхронизация Perth Mint»).
- **Дубликаты монет**: совпадение title + catalog_number может быть из‑за перезаписи, а не реального дубликата. Проверять комплексно: сравнивать **source_url**, вес, диаметр, металл и при необходимости изображения — удалять только если все ключевые поля совпадают. Скрипты: `check-duplicate-coins-safe.js` (проверка), `remove-duplicate-coins.js` (удаляет только такие безопасные дубликаты).

---

## Документация

| Файл | Содержание |
|------|------------|
| **docs/PROJECT_OVERVIEW.md** | Обзор проекта, архитектура, крон, металлы, каталог, Perth, защита от перезаписи |
| **scripts/PERTH_SYNC_README.md** | Полный цикл синхронизации Perth (дедуплы, fetch, импорт, проверка) |
| **docs/ЧТО_СДЕЛАТЬ_ПЕРЕД_ЗАПУСКОМ.md** | .env, Supabase, первый запуск |
| **docs/IMAGES_STRATEGY.md** | Изображения монет и дворов |
| **docs/DB_CONNECTION.md** | Подключение к БД |

---

## Основные скрипты

| Скрипт | Назначение |
|--------|------------|
| `node scripts/export-coins-to-json.js` | Выгрузка монет из БД в `public/data/coins.json` и `public/data/coins/*.json` |
| `node scripts/import-perth-mint-to-db.js` | Импорт Perth из `data/perth-mint-*.json` (по source_url, при отсутствии по catalog_number) |
| `node scripts/update-perth-from-canonical-json.js` | Обновление Perth-записей из каноников (по source_url; по catalog_number только если в БД одна запись) |
| `node scripts/fix-perth-overwritten-coins.js` | Восстановление Perth после ошибочной перезаписи (по спекам; опция `--dry`) |
| `node scripts/fetch-perth-mint-coin.js` | Скачивание/обновление данных с сайта Perth Mint |
| `npm run metal-prices:cron` | Крон цен металлов (ЦБ, запись в БД и JSON) |

Полный список и контекст — в `docs/PROJECT_OVERVIEW.md` и в комментариях в начале каждого скрипта.
