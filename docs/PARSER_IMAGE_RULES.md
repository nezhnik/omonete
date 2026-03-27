# Правила картинок парсеров и rollback

Документ фиксирует текущую логику ролей изображений, приоритеты в каталоге и безопасный откат.

## Текущая логика ролей картинок

- `image_obverse` / `image_reverse` — только стороны монеты.
- `image_blister_obverse` / `image_blister_reverse` — только парные блистерные кадры (если есть оба).
- `image_packaging` — карточная/блистерная упаковка (`in-card`, `incard`, `in-blister`, `secure-pack`).
- `image_box` — коробка/кейс (`box`, `in-case`, `incase`, `in-capsule` и т.п.).
- `image_certificate` — отдельные сертификат/outer/shipper кадры.
- Для Perth `straight-on` трактуется как `reverse` (если нет более точного `reverse`).

## Приоритеты в каталоге

1. Если есть пара `blister_obverse + blister_reverse` — они идут первыми.
2. Иначе используются `reverse/obverse` (порядок первой картинки зависит от `coin-display-config.json`).
3. Затем добавляются `packaging`, `box` и `certificate` (если есть и файлы существуют).
4. Если валидных картинок нет — только тогда placeholder.

## Что считаем регрессией

- В `public/data/coins/<id>.json` стоит путь `/image/...`, но файла в `public/image/...` нет (404).
- В БД есть `image_obverse` и `image_reverse`, а в `public/data` у монеты `imageUrl` = placeholder.
- `incard/in-card` ошибочно теряются или попадают в `box/certificate` вместо `packaging` (для Perth).

## Rollback за 2 минуты

1. Откат кода/JSON/путей картинок:
   - `git reset --hard HEAD` (только для локальных незакоммиченных правок), или
   - `git revert <commit_sha>` (безопасный откат уже закоммиченного изменения).
2. Пересобрать данные из БД:
   - `npm run data:export`
3. Проверить проблемные монеты (`/coins/<id>/`) и отсутствие 404 по картинкам.
4. Пересобрать статику:
   - `npm run build`

## Безопасный порядок изменений парсеров

1. Меняем правила классификации в скрипте.
2. Парсим 1-2 тестовые монеты.
3. Импорт в БД + `npm run data:export`.
4. Проверяем роли картинок и наличие файлов.
5. Только после этого массовый запуск.

