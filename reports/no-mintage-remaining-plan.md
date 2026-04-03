# Монеты без экспорта из‑за тиража (после правки Scottsdale)

Дата отчёта: после `npm run data:export` и снимка `export-snapshot-2026-04-01_00-39-51.json`.

## Цифры

| Показатель | Значение |
|------------|----------|
| Строк в БД (`coins`) | 5305 |
| Попадает в публичный каталог (`public/data/coins.json`) | **4774** |
| Не попадает: всего | 531 |
| из них **`NO_MINTAGE`** (нет числового тиража и нет подходящего текста для «неограничен») | **528** |
| из них **`EXCLUDED_ID`** (жёстко исключены в экспорте) | **3** |

Scottsdale Mint: **0** записей в статусе `NO_MINTAGE` (три позиции исправлены: `8512`, `8518`, `8565` — выставлено `mintage_display = «Не ограничен»`; у `8518` исправлен битый `source_url` с `__trashed` на актуальную страницу *Patriotic Bald Eagle*).

## Распределение 528 записей по монетным дворам (mint)

1. **The Perth Mint** — 290  
2. **Royal Dutch Mint** — 62  
3. **Monnaie de Paris** — 56  
4. **Germania Mint** — 53  
5. **Herdenkingsmunten** — 19  
6. **Royal Canadian Mint** — 17  
7. **Swissmint** — 14  
8. **The Royal Mint** — 12  
9. **Mennica Polska** — 3  
10. **Монетный двор США** — 2  

## Что с ними делать дальше

Общее правило экспорта: в каталог попадают монеты с **ненулевым числовым `mintage`** или иностранные с **непустым `mintage_display`** (в т.ч. «Не ограничен»), плюс исключения по каталогу (Royal Mint GB-ROYAL-*, PAMP CH-PAMP-*, слитки Менницы и т.д. — см. `scripts/export-coins-to-json.js`).

### 1. The Perth Mint (290)

- Часть — уже разобрана в `reports/not-found-36-mintage-research.json` / `.csv` (официальный автопроход не нашёл цифру в HTML).  
- **Действия:** добить тиражи из отчёта → `UPDATE` в БД; для наборов без лимита — осмысленный `mintage_display` (как в CSV).  
- У части нет `source_url` — ручной поиск (Numista, OCC, справочники) или ворклист `reports/no-source-59-perth-worklist.md`, если актуален.

### 2. Royal Dutch Mint (62), Swissmint (14), Herdenkingsmunten (19)

- **Действия:** убедиться, что парсер тянет таблицу характеристик; при необходимости точечный реимпорт из `data/*`; для остатка — ручной ввод с 2–3 источниками.

### 3. Monnaie de Paris (56), Germania (53), RCM (17), Royal Mint (12), Mennica (3), US Mint (2)

- **Действия:** официальный сайт / каталог → Numista → крупный дилер; занести `mintage` или `mintage_display`.

### 4. Три записи `EXCLUDED_ID`

- Это не про тираж: смотреть константу исключений в `export-coins-to-json.js` и решать, снимать ли ID с исключения.

## Практический порядок работы

1. Сверять `reports/export-diff-latest.md` после каждого массового импорта.  
2. Группами по mint (см. таблицу выше): заполнить `mintage` или `mintage_display`.  
3. `npm run data:export` → проверить, что `by_reason.NO_MINTAGE` уменьшается.  

При необходимости можно снова выгрузить полный список `NO_MINTAGE` из последнего JSON снимка в `reports/export-snapshots/` фильтром `is_exported === false && exclude_reason === "NO_MINTAGE"`.
