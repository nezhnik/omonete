# Royal Mint — стабильный пайплайн (как Perth)

## В чём была разница с Perth

- У RM **несколько типов PDP**: invest/bullion, `/shop/commemorative`, `/shop/limited-editions`, **trial-of-the-pyx**, **coin-sets**, **monarch**, **world**.
- Старый код переписывал часть `/shop/...` в `invest/bullion/...` → **404** (slug не bullion).
- Картинки лежат в разных путях CDN: `_ecommerce/.../launches/`, **`__rebrand/.../_historic-coins/`**, **`.../trial-of-the-pyx/images/`** — фильтр только по `/launches/` отрезал «свои» фото.

Исправлено в:

- `scripts/royal-mint-listing-collect.js` — `rewriteShopPdpToInvestBullion` не трогает trial / coin-sets / monarch / world.
- `scripts/fetch-royal-mint-coin-test.js` — отбор изображений для shop historic + trial packshots; **для `/invest/bullion/` приоритет `globalassets/bullion/images/products/...` с совпадением slug** (иначе в «товарные» попадал чужой Britannia из карусели); классификация `blister-back` / `blister-front`; `-obv-` / `-rev-`; если RM отдал только reverse — дублируем в obverse для превью.
- `scripts/fetch-royal-mint-seed-queue.js` — `--refresh-images` ловит пустой obv/rev, плейсхолдеры и рассинхрон `raw.classified` vs `coin`.

## Параллельность (быстрее)

По умолчанию **`--concurrency 2`** (или **`ROYAL_MINT_FETCH_CONCURRENCY=2`**): два процесса Node + Chromium. Дальше — с убывающей отдачей (RAM, CPU, лимиты сайта).

- Строго по одной: `--concurrency 1`
- Чуть быстрее (на свой риск): `--concurrency 3` … `4`

## Команды

| Шаг | Команда |
|-----|---------|
| Список URL из HTML/строк в seed | `npm run royal-mint:listing:seed` |
| Список из `royal-mint-urls.txt` | `npm run royal-mint:fetch-list` |
| Только проблемные по seed (404 / нет JSON) | `npm run royal-mint:fetch-seed-queue` |
| Перескачать картинки там, где `image_obverse` пустой | `npm run royal-mint:refresh-seed-images` |
| Полный перепарс всех seed URL | `npm run royal-mint:reparse-seed` |
| Аудит 404 в title в `data/royal-mint-*.json` | `npm run royal-mint:404-audit` |
| Отчёт: seed без obv/rev (плейсхолдер / пусто) | `npm run royal-mint:report-missing-images` → TSV: `node scripts/report-royal-mint-seed-missing-images.js --tsv > data/royal-mint-seed-missing-images.tsv` |
| В БД | `npm run royal-mint:import` |
| В БД + удалить зомби с «404» в title | `npm run royal-mint:import:purge404` |
| В `public/data` | `npm run data:export` или `data:export:incremental` |

### Импорт в БД (как Perth: ключ — `source_url`)

- В `coins.source_url` пишется **канонический** URL PDP: **без** `?query` и `#hash`, **без** завершающего `/`.
- Поиск существующей строки: совпадение с каноном **или** со «старым» URL (с query) **или** с тем же путём после отрезания `?` в SQL — чтобы **обновить** старую запись, а не создать дубликат.
- Перед импортом из папки `data/` **дедуп** JSON по каноническому `source_url` (один файл на URL).
- По умолчанию **нет** fallback по `catalog_number` (он давал «новую» строку при смене URL). Для миграций: `node scripts/import-royal-mint-to-db.js --match-catalog`.
- `--purge-404`: одноразово удалить строки Royal Mint, у которых в `title` / `title_en` фигурирует текст 404 (после бэкапа БД).

Файлы:

- Старты + вставка HTML: `scripts/royal-mint-seed-urls.txt`
- Итоговый список PDP: `scripts/royal-mint-urls.txt`

## Рекомендуемый порядок после правок парсера

```bash
npm run royal-mint:fetch-seed-queue:dry
npm run royal-mint:fetch-seed-queue
npm run royal-mint:refresh-seed-images
npm run royal-mint:import
npm run data:export
```

Dry-run показывает, сколько URL попадёт в очередь.

## Мёртвые URL на стороне RM

Если invest-страница отдаёт **HTTP 404**, товара может не быть в линейке — ищите **рабочий PDP** (часто `/shop/.../trial-of-the-pyx/...` для trial) или уберите строку из `royal-mint-urls.txt` и удалите JSON.
