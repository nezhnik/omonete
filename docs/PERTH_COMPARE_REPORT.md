# Сравнение current vs Perth (data/perth-compare)

Проверка выполнена после исправления фильтра по папке продукта (только картинки этого продукта, без "you may also like").

## Итог по монетам

| id   | Монета (current) | Perth slug | Папка  | Кол-во current | Кол-во perth | Соответствие |
|------|------------------|------------|--------|----------------|--------------|--------------|
| 4429 | Four Guardians Lan 2024 | chinese-myths-legends-four-guardians-lan-2024... | 24t06bad | 4 | 5 | Ок (одна монета) |
| 4432 | Red Dragon and Koi 2023 | chinese-myths-and-legends-red-dragon-and-koi-2023... | 23q64aad | 4 | 3 | Ок |
| 4541 | Phoenix 2022 Coloured | phoenix-2022-1oz-silver-coloured... | 22m55bad | 4 | 3 | Ок |
| 4542 | Phoenix 2022 Vivid | phoenix-2022-1oz-silver-vivid... | 22m55cad | 4 | 3 | Ок |
| 4424 | Double Phoenix 2025 Vivid | chinese-myths-legends-double-phoenix-2025-1oz-silver-vivid... | 25w46bad | 4 | 4 | Ок |
| 4757 | Double Phoenix 2025 Fire | chinese-myths-legends-double-phoenix-2025-1oz-silver-fire... | 25w46aad | 4 | 4 | Ок |
| 5762 | WWII 75th 2020 1/10oz | end-of-wwii-75th-anniversary-2020-1-10-oz... | 20h50ead | 4 | 3 | Ок |

Дублей по монетам нет: в каждой папке perth только картинки того продукта, чей source_url у этой монеты в БД.

## Что было исправлено

- **4429**: раньше в perth попадали картинки других продуктов (Yot Horse, Snake, Koala и т.д.), т.к. в канонике в начале списка шли URL с разными папками. В скрипте включена фильтрация по папке продукта (как в redownload-perth-images-from-raw.js): берётся самая частая папка в первых 15 URL, скачиваются только URL с этой папкой. После перезапуска в 4429/perth только Four Guardians Lan (24t06bad).

## Рекомендации по визуальному сравнению

1. **Порядок картинок**: у нас в current — obv, box, cert, rev (по imageUrlRoles). В perth — порядок из галереи Perth (reverse/straight-on, incard, obverse). Для сравнения реверса/аверса сопоставлять по смыслу (rev ↔ reverse/straighton, obv ↔ obverse).
2. **4541 и 4542**: в публичном JSON у обеих указан один и тот же catalogSuffix «25u68zaa» — это ошибка в данных (разные продукты). На сравнение по source_url это не влияет; при необходимости поправить catalog_suffix в БД по каноникам.
3. **4424 и 4757**: два разных продукта (Vivid и Fire/red-and-gold), папки 25w46bad и 25w46aad — всё верно.

## Как перезапустить сравнение

```bash
node scripts/compare-perth-images.js
```

Список id в скрипте: `IDS = ["4429", "4432", "4542", "4541", "5762", "4424", "4757"]`. Чтобы добавить другие монеты Perth, дописать id в массив и убедиться, что в БД у них заполнен source_url (perthmint.com).
