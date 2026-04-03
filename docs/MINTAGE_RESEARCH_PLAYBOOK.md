# Справочник: как искать тиражи (официальные сайты и источники)

Единая памятка для ручного и полуавтоматического поиска тиража. Раньше процесс был размазан по нескольким файлам (`PARSING-MINTAGE.md`, `missing-from-4555-mintage-workflow.md`, `missing-from-4555-coins-grouped.md`, `FOREIGN_COINS_CATALOG_SOURCES.md`). Здесь — **одна точка входа** и ссылки на детали.

---

## 1. Текущая очередь в проекте

| Что | Где |
|-----|-----|
| Монеты без нормального тиража **в экспортируемом каталоге** (сейчас ~559) | `reports/mintage-export-gap-research.md` + JSON `reports/mintage-export-gap-research.json` |
| Пересобрать список из БД | `npm run coins:generate-mintage-export-gap-research` |
| Сводка цифр (экспорт, когорта official-pass) | `npm run coins:report-mintage-dashboard` → `reports/mintage-dashboard.json` |
| Старая когорта «missing 4555» (394 id), автопроход по `source_url` | `reports/missing-from-4555-official-mintage-pass.json`, таблица-легенда `reports/missing-from-4555-mintage-workflow.md` |
| Ручная верификация с колонками Source A/B/C | `reports/missing-from-4555-coins-grouped.md` |

Правила «что считается дырой» и зачем «Тираж не указан»: **`docs/PARSING-MINTAGE.md`**.

---

## 2. Порядок работы (как для когорты 394)

1. **Первичный источник — официальный сайт**  
   Открыть **`source_url`** из строки очереди (в `mintage-export-gap-research.md` колонка уже есть). Искать на странице: *mintage*, *limited mintage*, *maximum mintage*, *edition limit*, *Auflage*, *tirage*, *issue limit* (зависит от двора и вёрстки).

2. **Если на официальной странице пусто или сомнительно**  
   - Второй независимый источник: пресс-релиз двора, PDF годового отчёта, каталог коллекционного дилера с указанием лимита.  
   - Справочные каталоги (с осторожностью): **Numista**, **Colnect**, **uCoin** — удобно для кросс-проверки; при расхождении с официалом приоритет у официального сайта или у двух согласованных независимых источников.  
   - Обзор типов источников: **`docs/FOREIGN_COINS_CATALOG_SOURCES.md`**.

3. **Зафиксировать в таблице**  
   В `mintage-export-gap-research.md`: колонки **Source A** (ссылка), **mintage_candidate** (число или пояснение), **status** (`pending` → `verified` / `single_source` / `no_mintage_source`).  
   Для строгой схемы с очередью в JSON: **`data/secondary-mintage-research-queue.json`** + поля `verifiedMintage` / `verifiedMintageDisplay` и `status: "ready_for_db"` (см. комментарий в файле).

4. **Перенос в БД**  
   - Очередь: `npm run coins:apply-secondary-mintage-queue:apply`  
   - Заливка из `missing-from-4555-official-mintage-pass.json`: `npm run coins:apply-official-mintage-pass:apply`  
   - Из `missing-from-4555-coins-grouped.md`: `npm run coins:apply-mintage-from-grouped-md:apply` (только строки с готовым статусом; см. комментарий в скрипте)  
   - Прямой SQL / отдельные батчи (Kookaburra и т.д.) — по уже существующим скриптам в `scripts/`.

5. **Обновить статический каталог**  
   `npm run data:export`  
   Перед выкладкой сайта: `npm run build` (или ваш обычный деплой).

---

## 3. Где искать по монетным дворам (типовые точки)

Ниже — ориентиры для **текущей** очереди 559 (сводка по дворам в шапке `mintage-export-gap-research.md`). Детали пайплайнов импорта смотрите в named docs по двору.

### The Royal Mint (UK)

- **Официально:** карточка товара по `source_url` (разные шаблоны: limited editions, gifts, britannia, invest/bullion и т.д.).  
- **Про URL и парсинг:** `docs/ROYAL_MINT_PIPELINE.md`.  
- **Дополнительно:** поиск по названию года + номинала на сайте; для trial / Pyx — отдельные разделы (см. тот же документ).

### PAMP / CH-PAMP-*

- Официальный сайт PAMP / продуктовая страница; часть тиражей только в описании или PDF.  
- Импортные скрипты и история полей — в репозитории (`import-pamp`, `pamp-backfill-mintage-from-description.js` и т.д.).

### Mennica Polska

- `inwestycje.mennica.com.pl` / карточки продуктов.  
- Слитки с префиксом каталога `PL-MENNICA-GOLD-BAR-*` в экспорт попадают и без числа — тираж может быть только в тексте «неограничен» и т.п.

### Monnaie de Paris

- `monnaiedeparis.fr` — страница выпуска; поля тиража в спецификациях.  
- Имеет смысл сверяться с французским/английским вариантом страницы.

### The Perth Mint (для будущих очередей)

- `perthmint.com` — PDP; автоснятие в **`missing-from-4555-official-mintage-pass.json`**.  
- Документы по парсингу и спискам: `docs/PERTH_MINT_FULL_SYNC.md`, `docs/COLNECT_PERTH_MINT_CATALOG.md`.  
- **Внимание:** у наборов возможны ошибки склейки чисел в автопарсере (пример: id **4284**) — только ручная проверка.

### Другие дворы

- **Austria:** `scripts/fill-austrian-mintage-from-official-at.js`, `docs` по Austrian Mint при необходимости.  
- **Germania:** сайт `germaniamint.com`.  
- **Royal Dutch Mint:** `royaldutchmint.com` (карточка как у Magento).

---

## 4. Скрипты и отчёты (шпаргалка)

| Задача | Команда / файл |
|--------|----------------|
| Список «дыр» для ручной работы | `npm run coins:generate-mintage-export-gap-research` |
| Дашборд цифр | `npm run coins:report-mintage-dashboard` |
| Заливка из official-pass JSON | `npm run coins:apply-official-mintage-pass` / `:apply` |
| Заливка из secondary queue | `npm run coins:apply-secondary-mintage-queue:apply` |
| Заливка из grouped md | `npm run coins:apply-mintage-from-grouped-md:apply` |
| Отчёт по БД без тиража (шире экспорта) | `npm run coins:report-missing-mintage` (см. `PARSING-MINTAGE.md`) |
| Экспорт JSON для сайта | `npm run data:export` |

---

## 5. Критерии качества (кратко)

- **verified:** официальный сайт + ещё один независимый источник с тем же числом (или один официальный документ PDF/пресс-релиз с явным лимитом).  
- **single_source:** только официальная PDP или один признанный источник — допустимо, но пометить уверенность в заметке.  
- **no_mintage_source:** официально лимит не публикуется — в БД лучше осмысленный `mintage_display` (не оставлять вечно «Тираж не указан» без пояснения), `mintage` NULL.

После согласования значений обязательно **БД → `data:export`**, иначе сайт не увидит изменений.

---

## 6. Связанные документы

- `docs/PARSING-MINTAGE.md` — логика БД и экспорта  
- `docs/COINS_WITHOUT_MINTAGE_CATALOG_FILTER.md` — кто попадает в каталог без числа  
- `docs/FOREIGN_COINS_CATALOG_SOURCES.md` — откуда в целом берут каталоги  
- `reports/missing-from-4555-mintage-workflow.md` — пример легенды `found_official_only` / `needs_source`  
- `reports/not-found-36-mintage-research.json` — ручные рекомендации по позициям, где автопарсер Perth не нашёл цифру  

При появлении нового «большого» двора добавляйте подраздел в §3 и ссылку на скрипт импорта — этот файл держим как **оглавление практики по тиражам**.
