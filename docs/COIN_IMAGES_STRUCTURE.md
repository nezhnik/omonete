# Структура изображений монет

Изображения монет лежат в `public/image/coins/` и разделены по папкам:

## Папки

| Папка | Назначение |
|-------|------------|
| `ru/` | Российские монеты (ЦБ РФ, каталог: 3213-XXXX, 5109-XXXX, 5111-XXXX и т.д.) |
| `foreign/` | Иностранные монеты (США, Канада, Австралия и др.) |

## Пути в БД

В колонках `image_obverse` и `image_reverse` хранятся полные пути:

- Российские: `/image/coins/ru/5111-0178-26.webp`, `/image/coins/ru/5111-0178-26r.webp`
- Иностранные: `/image/coins/foreign/US-ASE-2021-BU.webp` или внешние URL (например, ucoin CDN)

## Скрипты

- **download-dzi-coins-by-base.js**, **download-dzi-coins.js** — качают с ЦБ РФ → `ru/`
- **download-and-optimize-coins.js**, **download-cbr-images.js** — скачивание изображений ЦБ → `ru/`
- **chervonets-images-to-webp.js** — конвертирует PNG червонцев → `ru/`
- **set-chervonets-image-paths.js** — прописывает пути червонцев в БД → `ru/`
- **check-missing-coin-images.js** — проверка наличия файлов в `ru/`
- **trim-coin-images.js** — обрезка белых полей в `ru/`
- **migrate-coins-images-to-folders.js** — миграция: перемещает файлы в `ru/` и обновляет БД

## Добавление новых изображений

**Российские:** положить в `public/image/coins/ru/`, имена по `catalog_number` (например `5111-0178-26.webp`, `5111-0178-26r.webp`).

**Иностранные:** положить в `public/image/coins/foreign/` или использовать внешние URL (ucoin, ЦБ др. стран).
