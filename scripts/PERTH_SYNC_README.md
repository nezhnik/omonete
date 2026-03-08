# Синхронизация с сайтом Perth Mint: один цикл без дублей

Цель: все монеты Perth в каталоге соответствуют сайту Perth (характеристики, названия, картинки, номинал, страна), без дублей.

**Правило, чтобы перезапись не повторилась**:  
1) Сначала **импорт** (шаг 4), чтобы у записей в БД был правильный `source_url`.  
2) Потом **update-perth** (шаг 4b). Скрипт `update-perth-from-canonical-json.js` сопоставляет записи **сначала по source_url**, при отсутствии URL — по catalog_number; так разные монеты не перезаписываются одним продуктом.  
Если перезапись уже произошла (у многих монет одно название и одни картинки) — сначала запустите `node scripts/fix-perth-overwritten-coins.js`, затем цикл ниже. Подробнее: README.md, docs/PROJECT_OVERVIEW.md.

## Порядок действий (один раз или при очередной синхронизации)

### Шаг 1. Удалить дубли среди JSON
Оставляем один файл на продукт (по `catalog_number` + `title`), удаляем остальные (короткие slug / без source_url).

```bash
node scripts/find-perth-json-duplicates.js --delete
```

### Шаг 2. Обновить список URL и прогресс
В прогресс и в `scripts/perth-mint-urls.txt` пишем только канонические URL (по одному на оставшийся JSON). Так при перезапросе не воссоздадутся дубли.

```bash
node scripts/sync-perth-canonical-after-dedup.js
```

### Шаг 3. Перезабрать данные с сайта Perth
Каждая страница запрашивается заново, JSON перезаписываются актуальными данными с сайта (спеки, номинал, страна, картинки).

```bash
node scripts/fetch-perth-mint-coin.js --refresh
```

(Может занять много времени — одна страница на продукт.)

### Шаг 4. Импорт в БД
Совпадение по `source_url`, при отсутствии — по `catalog_number`. Одна запись на продукт (UPDATE или INSERT).

```bash
node scripts/import-perth-mint-to-db.js
```

### Шаг 4b. Обновление из каноников (опционально)
Подтянуть из JSON в БД title, картинки, series, country и т.д. Сопоставление **сначала по source_url**, при отсутствии — по `catalog_number` (так не перезаписываются чужие монеты).

```bash
node scripts/update-perth-from-canonical-json.js
```

### Шаг 5. Удалить дубли в БД
Для каждого `catalog_number` + `title` оставляем одну запись (с `source_url` или с меньшим `id`), остальные удаляем.

```bash
node scripts/remove-perth-db-duplicates.js --do
```

### Шаг 6. Подтянуть номинал из JSON
Для записей Perth с пустым `face_value` подставляем значение из соответствующего JSON.

```bash
node scripts/fill-perth-face-value-from-json.js --do
```

### Шаг 7. Проверка
Сравнение JSON и БД: дубли, отсутствующие записи, пустые номиналы.

```bash
node scripts/validate-perth-data.js
```

После этого: экспорт данных и сборка (например `npm run data:export` и `npm run build`), чтобы каталог на сайте обновился.
