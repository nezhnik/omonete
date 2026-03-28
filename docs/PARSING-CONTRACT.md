# Контракт парсинга внешних монет (omonete-app)

Один документ: **что должно попадать из сайта дилера в JSON и в БД**, как устроены разные пайплайны и где есть пробелы. При добавлении нового источника или правке парсера — сверяться с этим файлом и обновлять таблицу статуса.

---

## 1. Целевая модель: поля картинок в `coins`

Имеет смысл заполнять все релевантные колонки, если на PDP есть отдельные снимки.

| Колонка БД | Смысл |
|------------|--------|
| `image_obverse` | Аверс монеты (лицевая сторона), путь в `/image/coins/...` после импорта |
| `image_reverse` | Реверс монеты |
| `image_blister_obverse` | Вид блистера/капсулы со стороны, где чаще виден аверс (или «перед» упаковки) |
| `image_blister_reverse` | Обратная сторона блистера / второй ракурс упаковки монеты в блистере |
| `image_packaging` | Общий вид упаковки (конверт, слип, оверсайз-фото «в упаковке», если отдельно от блистера) |
| `image_box` | Коробка / подарочный футляр |
| `image_certificate` | Сертификат, COA, лист с номером тиража |

**Правило:** если на сайте в галерее есть уникальный URL под тип снимка — парсер должен классифицировать его и импортёр — записать в БД. Пустые поля допустимы, если на PDP действительно нет такого кадра.

---

## 2. Единый фрагмент JSON: `classified` (предпочтительно)

Для новых и выровненных парсеров используем объект **`classified`** с ключами:

```json
{
  "classified": {
    "obverse": "https://... или /image/...",
    "reverse": null,
    "blister_obverse": null,
    "blister_reverse": null,
    "packaging": null,
    "box": null,
    "certificate": null
  }
}
```

- Значения на этапе **fetch** обычно **абсолютные URL** с сайта дилера; импорт скачивает и кладёт **локальные пути** (кроме PAMP, где часть путей уже локальна после materialize).
- Дополнительно допустимы вспомогательные поля в корне JSON (`imageUrls`, `classified_source_urls` и т.д.) — см. конкретный источник.

**Исключение:** Royal Mint сейчас кладёт пути картинок **внутрь `coin.*`** (см. ниже) — это исторический формат; при рефакторинге RM лучше привести к `classified` + тонкий слой совместимости в импорте.

---

## 3. Матрица источников: fetch → JSON → import → БД

Статусы: **да** — заполняется end-to-end; **частично** — только в JSON или только obv/rev; **нет** — поле в БД есть, но пайплайн не пишет.

| Источник | Fetch (скрипты) | Файлы JSON | Import | obv/rev | блистер | packaging | box | cert |
|----------|-----------------|------------|--------|---------|---------|-----------|-----|------|
| **PAMP** | `fetch-pamp-product.js`, `fetch-pamp-all.js`, materialize-скрипты | `data/pamp-*.json` | `import-pamp-to-db.js` | да | да | да | да | да |
| **Mennica** | `fetch-mennica-product.js`, `fetch-mennica-all.js` | `data/mennica-*.json` | `import-mennica-to-db.js` | да | да* | да* | да* | да* |
| **Germania (монеты)** | `fetch-germania-mint-coin.js` | `data/germania-mint-*.json` | `import-germania-mint-to-db.js` | да | **нет** | **нет** | **нет** | **нет** |
| **Royal Mint** | `fetch-royal-mint-coin-test.js` и вспомогательные | `data/royal-mint-*.json` | `import-royal-mint-to-db.js` | да (в `coin`) | по данным `coin` | по данным `coin` | по данным `coin` | по данным `coin` |
| **Perth Mint** | отдельные fetch-скрипты Perth | `data/perth-mint-*.json` | `import-perth-mint-to-db.js` | да (в `coin`) | по данным `coin` | по данным `coin` | по данным `coin` | по данным `coin` |
| **Münze Österreich** | `fetch-austrian-mint-product.js`, `fetch-austrian-mint-all.js` | `data/austrian-mint-*.json` | `import-austrian-mint-to-db.js` | да* | да* | да* | да* | нет |

### Заметки по реализации

- **Mennica:** эвристики по имени файла в URL галереи: `obverse` / `reverse` — монета (учитывать суффикс `_` после токена в имени файла, иначе WooCommerce-имена вида `COIN_obverse_.png` не матчились бы и стороны путались); `cert` / `certificate` / `coa` — сертификат; `box` — коробка; `package` / `packaging` / `etui` / `sleeve` / `wrapper` — упаковка; `blister` / `capsule` / `kapsul` — блистер (первый URL → `blister_reverse`, второй → `blister_obverse`). Если отдельной упаковки нет, `packaging` подставляется из первого кадра блистера. Звёздочка в таблице (*): поле заполняется только если имя файла в URL попадает под шаблон.
- **PAMP:** эталон по полноте `classified` и эвристикам имён файлов (блистер, коробка, сертификат).
- **Germania:** в JSON только `classified.obverse` / `reverse`; `image_box` / `image_certificate` в импорте всегда `null`, хотя `imageUrls` может содержать больше ссылок из галереи.
- **Royal Mint / Perth:** ориентир — объект **`coin`** в JSON; имена полей совпадают с колонками БД (`image_obverse`, …).
- **Münze Österreich:** листинг `.article-list` → `austrian-mint:listing` → `data/austrian-mint-listing-products.json`. PDP: аккордеон Description / Specifications; галерея `.gallery-wrapper .thumbs` — уникальные `img` по имени файла, URL с `product_preview` нормализуются в `product_full`. Стороны монеты: токены `_VS_` / `_RS_` в пути файла → `obverse` / `reverse`; `Etui` → `box`; обложка блистера `TITEL-3D_Blister` → `packaging`; кадры `Innenseite` / `Rueckseite-3D_Blister` → `blister_reverse` / `blister_obverse` (первые два). Если `_VS_`/`_RS_` нет — fallback: первые три уникальных кадра без «упаковочных» имён → reverse, obverse, box. Звёздочка (*): как у Mennica — только если сработали шаблоны / fallback.

---

## 4. Что парсить помимо картинок (минимальный общий набор)

Для каждой карточки товара, попадающей в каталог:

- Стабильный идентификатор страницы: **`source_url`** (канонический PDP без мусора в query, где это принято для источника).
- **Название**, по возможности EN + RU (как принято для источника).
- **Характеристики** в нормализуемом виде: металл, проба, вес, диаметр, тираж, качество, номинал, год/дата выпуска — из таблиц атрибутов / вкладок, с маппингом в импорте.
- **Серия / коллекция** (если есть на сайте или в листинге).

Конкретные ключи `specs` и поля `coin` зависят от сайта — их фиксируем в комментариях у соответствующих `fetch-*.js` / `import-*.js`.

---

## 5. npm-скрипты (ориентир)

| Задача | Команда |
|--------|---------|
| Mennica: листинг | `npm run mennica:listing` |
| Mennica: все PDP | `npm run mennica:fetch:all` |
| Mennica: только без JSON | `npm run mennica:fetch:missing` |
| Mennica: перепарсить дубли obv/rev в JSON | `npm run mennica:fetch:fix-duplicate-images` |
| Mennica: в БД | `npm run mennica:import` |
| Mennica: перекачать все картинки по URL из JSON (без rm; при сбое старый файл на диске сохраняется) | `npm run mennica:import:force-images` |
| Mennica: отчёт JSON vs БД по картинкам | `npm run mennica:report-images` |
| Mennica: план удаления obv/rev webp (dry-run) / удаление | `npm run mennica:refresh:webp -- --same-hash` / то же с `--apply` и опционально `--backup` |
| Mennica: выровнять `classified` по токенам в имени файла (obv/rev swap, добор box из `imageUrls`) | `npm run mennica:fix:classified` (dry-run), затем `npm run mennica:fix:classified:apply` |
| Mennica: **поменять местами пиксели** в парах `*-obv.webp` ↔ `*-rev.webp` на диске (БД/JSON не менять) | `npm run mennica:swap:obv-rev-files` (план), затем то же с `-- --apply` |
| Полный цикл Mennica (после листинга) | `npm run mennica:sync` |
| Münze Österreich: листинг (4 категории collector coins) | `npm run austrian-mint:listing` |
| Münze Österreich: один PDP | `npm run austrian-mint:fetch -- "https://www.muenzeoesterreich.com/en/products/..."` |
| Münze Österreich: все PDP из листинга | `npm run austrian-mint:fetch:all` |
| Münze Österreich: только без JSON | `npm run austrian-mint:fetch:missing` |
| Münze Österreich: импорт в БД | `npm run austrian-mint:import` |
| Münze Österreich: импорт с перекачкой картинок | `npm run austrian-mint:import:force-images` |
| Münze Österreich: листинг + fetch + import + export | `npm run austrian-mint:sync` |

Остальные источники — см. `package.json` (`pamp:*`, `germania:*`, скрипты Royal/Perth по имени).

---

## 6. Чеклист: новый дилер или крупная правка парсера

1. Добавить строку в **матрицу §3** и указать статусы по колонкам картинок.
2. Реализовать **`classified`** (или явно задокументировать отличный формат, как у RM `coin`).
3. Импорт: читать те же ключи и вызывать общий путь локализации изображений, если это URL с внешнего сайта.
4. Добавить **отчётный скрипт** или расширить существующий (как `report-mennica-images-status.js`): «в JSON есть URL, в БД NULL», «дубль obv/rev», «404».
5. Обновить этот файл, если меняется контракт.

---

## 7. История намерений (чтобы не повторять разговоры)

- Один раз описали **полный** набор смыслов картинок (§1).
- Разные дилеры реализованы в разное время: **PAMP** и **Mennica** тянут расширенный `classified` в JSON и импорт; **Germania** пока только аверс/реверс монеты.
- Дальнейшая цель: выровнять **Germania** под тот же контракт §1–§2, **не ломая** уже сохранённые пути в БД без необходимости.

---

## 8. Дубли и перепутанные картинки (Mennica): типы проблем и что уже работало

Ниже — **как отличить ситуацию** и **какой инструмент применить**, без угадывания. Парсер **не смотрит** на `alt`/`title` у `<img>` на сайте Mennica — только на **URL** (`data-large_image` / `src`).

### 8.1. Типы проблем

| Симптом | Вероятная причина |
|---------|-------------------|
| В каталоге **два разных пути** (`…-obv.webp` и `…-rev.webp`), а **картинка одна и та же** | Раньше в БД был **один URL** на обе стороны; импорт записал **одинаковые байты** в два файла. Потом JSON исправили, но **`import-mennica-to-db.js` не перекачивает**, если файл уже есть. |
| В JSON **один канонический URL** на `obverse` и `reverse` (часто разные размеры WooCommerce → один PNG) | Старый парсер брал `imgs[0]`/`imgs[1]` из галереи. **Исправлено** в `fetch-mennica-product.js` (уникальные URL + токены в имени файла). Точечный перезапуск: `mennica:fetch:fix-duplicate-images`. |
| В `classified.obverse` лежит файл с **`reverse` в имени** и наоборот (например `Reverse_The_Scream…` в слоте obverse) | Именование файлов на стороне дилера или старый fallback по порядку галереи. |
| Оба файла в галерее содержат в имени только **`reverse`** (редко) | Ошибка контента Mennica; **автоматически не различить** аверс/реверс по имени — оставляем **порядок кадров** как на сайте. |
| Нет **коробки** / сертификата в данных | В URL нет токенов `box`, `cert`, … или кадр не попал в `classified`. После правки парсера — добор из `imageUrls`: `fix-mennica-classified-labels.js`. |

### 8.2. Варианты решения (по возрастанию «жёсткости»)

1. **`npm run mennica:fix:classified`** → при необходимости **`mennica:fix:classified:apply`** — поправить **только JSON** под токены в пути (`swap` obv/rev, заполнить `box` из `imageUrls`). Скрипт: `scripts/fix-mennica-classified-labels.js`, утилиты: `scripts/mennica-image-url-utils.js`.
2. **`npm run mennica:import:force-images`** — **перекачать webp** по актуальным URL из JSON **без `rm`**: запись через временный файл; при сбое сети/sharp **старый файл на диске сохраняется**. Основной безопасный способ обновить пиксели после правки JSON или БД.
3. **`npm run mennica:refresh:webp -- --same-hash`** (по умолчанию **dry-run**) → с **`--apply`** [и опционально **`--backup`**] — удалить пары obv/rev, у которых **разные URL в JSON**, но **одинаковый SHA256** на диске; затем обычный `mennica:import`. Нужен редко, если принципиально сначала стереть файлы.
4. **`npm run mennica:fetch:fix-duplicate-images`** или **`mennica:fetch:all`** — заново снять PDP, если в JSON **дубль URL** или нет нужных картинок на странице.

После импорта: **`npm run data:export:incremental`** (или полный `data:export`, если нужно обновить все детальные JSON).

### 8.3. Что уже сделали и сработало (фиксация опыта)

- **WooCommerce / размеры:** уникальный порядок URL + нормализация канона (`-600x600` и т.д.), выбор obv/rev по **`obverse` / `reverse` в пути** — убрало массовый дубль «два реверса».
- **Имена вида `COIN_obverse_.png`:** токен с учётом **`_` после слова** (`urlHasFaceToken` в `fetch-mennica-product.js`) — иначе `\b` в RegExp не срабатывал и стороны брались **по порядку галереи** (ошибка на Easter Egg и др.).
- **`classified` для упаковки:** `box`, `cert`, блистер и т.д. + импорт в колонки БД.
- **Перепутанные слоты по имени файла:** пример **Edvard Munch Scream** — в JSON obverse/reverse **поменяны местами** относительно токенов `Obverse_…` / `Reverse_…`; исправление через **`fix-mennica-classified-labels.js --apply`** (swap).
- **Одинаковые webp при разных путях:** диагностика **SHA256** пары `mennica-*-obv.webp` / `rev.webp`; массовое удаление только с **`--apply`** в `refresh-mennica-foreign-webp.js`; затем **`mennica:import:force-images`** — успешно обновило **190** позиций без ручного удаления.
- **Прямоугольная монета в UI:** id в **`rectangular-coin-ids.json`** (например Atlas Maior **7030**) — флаг `rectangular` при экспорте.
- **Слитки Mennica Polska (`PL-MENNICA-GOLD-BAR-*`):** на PDP это **блистер CertiCard** — в каталоге без круглой маски. В экспорте и **`lib/coinApiShape.ts`** задаём **`rectangular: true`** по префиксу каталожного номера (если в БД нет пары `image_blister_*`, иначе сработал бы общий признак блистера).

### 8.4. Что автоматом не решаем

- **Визуально две одинаковые картинки при разных URL** на стороне дилера — без ручного списка или отдельного детекта по хэшу пикселей.
- **Семантика «где аверс»**, если в именах файлов **нет** ни `obverse`, ни `reverse` — только эвристики сайта или ручная правка.

### 8.5. Обмен сторон на диске: «в названии» obv/rev без правки JSON и БД

Иногда после импорта **пути** в БД уже соответствуют канону имён (`…/mennica-{slug}-obv.webp` и `…-rev.webp`), но **визуально** в каталоге аверс и реверс показываются наоборот: байты в файле `*-obv.webp` на самом деле от «другой» стороны. Тогда править `classified` в JSON **не обязательно** — достаточно **поменять местами содержимое двух файлов** на диске.

| | **JSON / `classified` (`fix-mennica-classified`)** | **Файлы на диске (`swap-mennica-obv-rev-webp-files`)** |
|---|------------------------------------------------------|--------------------------------------------------------|
| Что меняется | URL в `data/mennica-*.json` (слоты obverse/reverse) | Только байты в `public/image/coins/foreign/mennica-*-obv.webp` ↔ `*-rev.webp` |
| БД после шага | Нужен повторный **`mennica:import`** (и часто **`force-images`**) | **Не трогаем** — пути в колонках те же |
| **`data:export:incremental`** | Обычно нужен после импорта | **Не нужен** — в экспорте те же URL |

**Механика (как у PAMP):** тройной `rename` — временное имя → обмен двух файлов. Имена файлов (`-obv` / `-rev` в basename) **не переименовываются по отдельности**; меняется **содержимое**, привязанное к этим именам.

**Скрипт:** `scripts/swap-mennica-obv-rev-webp-files.js`.

**Команды:**

```bash
npm run mennica:swap:obv-rev-files          # dry-run: список пар без записи на диск
npm run mennica:swap:obv-rev-files -- --apply
# только перечисленные id (SKIP_COIN_IDS для них не действует):
node scripts/swap-mennica-obv-rev-webp-files.js --only-ids=7100,7101 --apply
```

**Охват по БД:** строки `coins` с `source_url` на `inwestycje.mennica.com.pl`, для которых `image_obverse` / `image_reverse` указывают на пару **одного slug**: `mennica-{slug}-obv.webp` и `mennica-{slug}-rev.webp` (регистр имени файла не важен). **Не обрабатываются:**

- каталожные номера **`PL-MENNICA-GOLD-BAR-*`** (слитки);
- пары, в basename которых есть **`blister`** (блистер отдельно от основной пары монеты);
- id из **`SKIP_COIN_IDS`** внутри скрипта — монеты, где стороны **уже совпадают** с задумкой редактора и менять файлы нельзя.

**Повторный `--apply`** по тем же монетам **снова поменяет местами** (откат визуально).

**Когда выбирать другой инструмент:** если ошибка в **URL в JSON** (токены `obverse`/`reverse` в пути перепутаны) — §8.2 п.1 **`mennica:fix:classified`** и импорт; если один URL на обе стороны — refetch или `force-images` по §8.2.

---

Последнее обновление контракта: §8.5 — обмен obv/rev **только файлами** (`swap-mennica-obv-rev-webp-files.js`); §5 — npm `mennica:swap:obv-rev-files`. Сверка также с `pamp-swap-obv-rev-webp-files.js` (тот же принцип для PAMP).
