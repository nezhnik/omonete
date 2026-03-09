# Kookaburra: источники данных и импорт в БД

## Pixelur — дополнительный источник (privy, подсерии)

Источник: [Guide to the Australian Kookaburra by Perth Mint](https://www.pixelur.com/Kookaburra.html) — человек собрал все серии Kookaburra с разбивкой по подсериям.

## Что на странице

- В HTML **нет таблиц** — все данные (год, тираж и т.д.) находятся **в картинках** (например `31.jpg`, `32.jpg`, `51.jpg`). Каждая картинка — по сути скрин/скан таблицы.
- Разделы (подсерии):
  - Regular (1 Oz Silver) (37 pcs)
  - Privy (1 Oz Silver)
  - 1996–1998 European Countries Privy Mark Collection (1 Oz Silver)
  - 1999–2000 Themes / Landmarks (1 Oz Silver)
  - 1999 European Currencies (1 Oz Silver)
  - 1999–2001 U.S State Quarters (1 Oz Silver)
  - 2000 Millennium Calendar (1 Oz Silver)
  - 2005 Zodiac Signs (1 Oz Silver)
  - 2009 P20 Anniversary Mint Mark Collection (1 Oz Silver)
  - 2012–Date Lunar Collection (1 Oz Silver)
  - 2012 Fabulous 15 (F15) (1 Oz Silver)
  - Regular (2 Oz Silver)
  - 1 Kilo Silver - for Investor
  - Krause

## Как получить табличный вариант «как в БД»

1. **Формат** — тот же, что у ASE/Perth: JSON с массивом `coins`, каждая запись с полями `title`, `title_en`, `series`, `country`, `face_value`, `mint`, `metal`, `mintage`, `weight_g`, `release_date`, `catalog_number` и т.д. (см. `data/kookaburra-pixelur.json`).
2. **Заполнение данных** из картинок возможно двумя путями:
   - **Вручную:** открыть изображения на Pixelur, перенести год/тираж/название в JSON (или в CSV, затем сконвертировать в JSON).
   - **OCR:** скачать картинки, прогнать через Tesseract (или другой OCR), распарсить текст в таблицу и собрать JSON. Можно добавить отдельный скрипт (скачивание изображений + вызов OCR + парсинг строк).
3. **Импорт в БД** — скрипт `scripts/import-kookaburra-pixelur-to-db.js` читает `data/kookaburra-pixelur.json` и вставляет записи в `coins` (по `catalog_number` не дублирует). Дефолты: страна Австралия, двор The Perth Mint, серия Australian Kookaburra (или подсерия из JSON).

## Файлы

| Файл | Назначение |
|------|------------|
| `data/kookaburra-pixelur.json` | Privy, подсерии — заполнять вручную из картинок или OCR. |
| `scripts/import-kookaburra-pixelur-to-db.js` | Импорт из Pixelur JSON в `coins`. |
| `scripts/download-pixelur-kookaburra-images.js` | Скачивает все изображения с pixelur.com/Kookaburra.html в `public/image/coins/kookaburra-pixelur/`. Запуск: `npm run kookaburra:pixelur-download`. |

## Рекомендация

Сначала заполнить несколько монет вручную (например, Regular 1 Oz по годам), проверить импорт, затем при необходимости сделать скрипт скачивания картинок с Pixelur + OCR для массового извлечения.
