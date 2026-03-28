# Тираж при парсинге иностранных монет

## Проблема

В `scripts/export-coins-to-json.js` в публичный каталог попадают монеты, у которых есть **числовой** `mintage` или непустой **`mintage_display`** (для страны ≠ Россия). Если после парсинга оба поля пустые, монета **пропадала из каталога**, хотя карточка уже была в БД.

Так терялись, например, 43 позиции Münze Österreich без блока Mintage на сайте.

## Решение

1. **`scripts/parsing-mintage-constants.js`**  
   - Константа **`Тираж не указан`** (`MINTAGE_UNKNOWN_DISPLAY`).  
   - **`finalizeMintageForDb(mintage, mintageDisplay, country)`** — для страны ≠ Россия, если нет числа и нет текста тиража, в БД пишется эта строка в `mintage_display`.  
   - **`coinNeedsMintageResearch(row)`** — нет числового тиража и (`mintage_display` пустой или равен «Тираж не указан»).  
   - **`logImportMintageSummary(label, rows)`** — в конце импорта в лог: сколько позиций без числового тиража.

2. **Импорты** (Mennica, Austrian Mint, Germania, PAMP, Royal Mint, Perth и др.) должны вызывать `finalizeMintageForDb` перед `INSERT`/`UPDATE` для иностранных строк.

3. **После импорта** смотрите строку вида:  
   `[тираж] <источник>: без числового тиража … — N из M`  
   и при необходимости ищите тираж на сайте дилера / каталогах.

4. **Каталог на сайте**: фильтр «Тираж не указан» и признак на карточке для позиций с `mintageNeedsResearch` в экспортируемом `coins.json`.

5. **Разовое выравнивание старых строк БД**:  
   `npm run data:backfill:mintage-unknown-display` (заполняет пустой `mintage_display` у уже импортированных иностранных монет без числового тиража).

6. **Список «сколько и каких» в БД** (та же логика, что `coinNeedsMintageResearch`):  
   `npm run coins:report-missing-mintage` — сводка по странам и дворам, построчный список в консоль, файл `data/coins-missing-mintage-report.json`. Флаг `--no-list` — только сводка и JSON; `--probe` — эвристика по HTML Royal/Perth (медленно).
