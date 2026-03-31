# Royal Canadian Mint (mint.ca) — листинг и аудит против БД

Каталог: [Silver](https://www.mint.ca/en/shop/categories/silver), [Gold](https://www.mint.ca/en/shop/categories/gold), [International Coins](https://www.mint.ca/en/shop/categories/international-coins), [Circulation & Base Metals](https://www.mint.ca/en/shop/categories/circulation).

## Листинг

- Контейнер: `.js-product-list.products.row`.
- **Рекламные вставки** (полная ширина, не карточка монеты): прямые дочерние элементы с классами **`block` + `containerblock`** (и варианты с `col-lg-12` и т.д.) — **не парсим как товар** (внутри может быть «BUY NOW» на реальную монету; ту же монету обычно видно в обычной карточке).
- Страницы листинга: **`?productPage=2`**, `3`, … В HTML накапливаются ссылки на карточки (не только те 6, что видны в сетке).
- Ссылки на PDP собираем только под **`/en/shop/coins/`** (категории и служебные URL отбрасываются).

Скрипт: `scripts/fetch-rcm-mint-listing.js`.

```bash
node scripts/fetch-rcm-mint-listing.js
npm run rcm:listing
```

Проверка без записи файлов (только первая категория):

```bash
node scripts/fetch-rcm-mint-listing.js --dry-run
```

Результат:

- `data/rcm-mint-listing-urls.txt` — по одному URL на строку;
- `data/rcm-mint-listing-products.json` — снимок по категориям.

## Аудит относительно MySQL

Скрипт: `scripts/rcm-mint-audit-vs-db.js` (Playwright + `DATABASE_URL`).

```bash
npm run data:export:incremental   # по желанию, актуальные JSON не обязательны
npm run rcm:audit
```

Опции:

- `--limit=30` — только первые N URL (тест);
- `--match-similarity=0.93` — порог «похожести» названия для шага fuzzy (по умолчанию **0.93**); `--match-similarity=off` или `0` — только URL + точное название;
- `--fuzzy-ignore-weight` — при fuzzy не требовать совпадения веса, если вес есть и на сайте, и в БД (если флаг не передан, при двух весах они должны быть близки, как при сравнении diff);
- `--verbose-all` — в jsonl попадают и полные совпадения (`kind: "ok"`);
- `--urls-file=путь` — свой список URL.

Выход: **`data/rcm-mint-audit-diff.jsonl`** (одна JSON-строка на запись):

| `kind` | Смысл |
|--------|--------|
| `new_on_site` | В выборке кандидатов из БД не нашли пару ни по одному из шагов ниже. |
| `diff` | Монета найдена; в `diffs[]` перечислены поля: `db` / `site`. |
| `fuzzy_ambiguous` | По названию подошли несколько строк с почти одинаковым score — нужно выбрать вручную по `candidates`. |
| `error` | Ошибка загрузки/разбора страницы. |

Сопоставление (порядок фиксированный):

1. Канонический URL mint.ca в `source_url` (если вы уже сохраняли ссылку).
2. **Product Number** на сайте (`sku` в отчёте) ↔ поля `catalog_number` / `catalog_suffix` в БД (если заполнены).
3. **Точное** совпадение нормализованного названия: сначала с `title_en`, затем с `title`.
4. **Fuzzy:** порог `titleSimilarity01`; если в БД есть непустой `title_en`, нечёткое сравнение только с ним (англ. с англ.), иначе с `title`. Год/вес при наличии с обеих сторон — как раньше.

По умолчанию кандидаты — **все строки** таблицы `coins` (чтобы не создавать дубль, если ту же монету завели с другого сайта). Флаг `--rcm-candidates-only` сужает выборку до mint.ca / RCM.

С сайта в блоке **Specifications** читаются: Product Number, Mintage, Weight (g), Composition, Diameter, Face Value, Finish. Год дополнительно берётся из пути `/coins/YYYY/`.

## Как «дозабрать» характеристики и не путаться с файлом

Сейчас скрипт **ничего не пишет в БД** — только отчёт. Рекомендуемый порядок:

1. Пройти `rcm:audit`, открыть `rcm-mint-audit-diff.jsonl`.
2. Для строк **`diff`**: вручную или отдельным скриптом обновить БД (`weight_g`, `mintage`, …), если доверяете сайту.
3. Для **`new_on_site`**: решить, нужен ли импорт новой монеты (отдельный импортёр пока не сделан — можно добавить по аналогии с `import-royal-mint-to-db.js`).
4. После правок БД: `npm run data:export:incremental` и при необходимости снова `rcm:audit` — совпавшие строки из отчёта «исчезнут» сами (перезапуск перезаписывает jsonl).

Идея «спарсили → если пусто у нас — записать в БД и удалить строку из файла» в одном шаге **не автоматизирована**: сначала осознанное обновление БД, потом повторный аудит даёт чистый diff.

## Связанные файлы

- `scripts/rcm-mint-lib.js` — канонизация URL, нормализация title, извлечение ссылок с листинга.
- Общие правила весов и экспорта: `docs/WEIGHT_GUIDE.md`.
