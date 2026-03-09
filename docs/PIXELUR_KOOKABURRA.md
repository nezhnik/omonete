# Pixelur.com — гайд по серии Kookaburra (Perth Mint)

Источник: [Guide to the Australian Kookaburra by Perth Mint Australia](https://www.pixelur.com/Kookaburra.html)

## Что на сайте

Сайт собрал серию Kookaburra в виде гайда: разделы (подсерии) и под каждым — **изображения** (jpg), на которых, судя по названиям файлов, таблицы или инфографика с монетами. В HTML **нет** текстовых таблиц с годом/тиражом/названием — только заголовки секций и ссылки на картинки.

## Что можем взять в БД / в проект

### 1. Структура подсерий (для поля `series` или справочника)

Готовый список подсерий Kookaburra — можно использовать как справочник названий серий при импорте/сверке Perth Mint:

| Подсерия |
|----------|
| Regular (1 Oz Silver) — 37 pcs |
| Privy (1 Oz Silver) |
| 1996 - 1998 European Countries Privy Mark Collection (1 Oz Silver) |
| 1999-2000 Themes / Landmarks (1 Oz Silver) |
| 1999 European Currencies (1 Oz Silver) |
| 1999 - 2001 U.S State Quarters (1 Oz Silver) |
| 2000 Millennium Calendar (1 Oz Silver) |
| 2005 Zodiac Signs (1 Oz Silver) |
| 2009 P20 Anniversary Mint Mark Collection (1 Oz Silver) |
| 2012 - Date Lunar Collection (1 Oz Silver) |
| 2012 - Fabulous 15 (F15) (1 Oz Silver) |
| Regular (2 Oz Silver) |
| 1 Kilo Silver - for Investor |
| Krause |

**Использование:** при добавлении или обновлении монет Kookaburra можно сопоставлять их с этой структурой (по году, весу, типу привилея) и задавать единообразное `series` в БД.

### 2. Картинки с сайта

Изображения (например `https://www.pixelur.com/31.jpg`) — чужие материалы; для каталога монет (фото аверс/реверс) их использовать не стоит. Подходят только как референс структуры серии.

### 3. Год, тираж, название по монетам

В HTML этих данных нет; они, скорее всего, на картинках. Для поштучных данных нужен другой источник: **Perth Mint** (официальный каталог), **Colnect** (см. `docs/COLNECT_PERTH_MINT_CATALOG.md`), Numista или ручной ввод с изображений pixelur.

## Итог

| Что нужно | Откуда брать |
|-----------|--------------|
| Названия подсерий Kookaburra | Pixelur — список выше (скопирован из заголовков страницы) |
| Год, тираж, название по каждой монете | Perth Mint, Colnect, или вручную с картинок Pixelur |
| Фото монет для каталога | Perth Mint (как сейчас), не Pixelur |

При желании можно завести в проекте справочник подсерий Kookaburra (JSON или таблица) на основе этого списка и использовать его при импорте Perth Mint.
