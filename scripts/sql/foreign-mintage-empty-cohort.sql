-- Когорта «иностранные без тиража» — те же условия, что в
-- scripts/backfill-foreign-mintage-empty-cohort.js
--
-- Использование: mysql -u ... -p database < scripts/sql/foreign-mintage-empty-cohort.sql
-- или выполнить выбранные блоки в клиенте.

-- ─── 1) Строгая когорта: нет числа И пустой mintage_display ───
SELECT COUNT(*) AS foreign_empty_mintage_and_display
FROM coins
WHERE TRIM(IFNULL(country, '')) NOT LIKE 'Россия%'
  AND (mintage IS NULL OR mintage = 0)
  AND (mintage_display IS NULL OR TRIM(mintage_display) = '');

-- ─── 2) Расширенная когорта: нужен поиск (в т.ч. «Тираж не указан») ───
-- Совпадает с фильтром coinNeedsMintageResearch в parsing-mintage-constants.js
SELECT COUNT(*) AS foreign_needs_mintage_research
FROM coins
WHERE TRIM(IFNULL(country, '')) NOT LIKE 'Россия%'
  AND (mintage IS NULL OR mintage = 0)
  AND (
    mintage_display IS NULL
    OR TRIM(mintage_display) = ''
    OR TRIM(mintage_display) = 'Тираж не указан'
  );

-- ─── 3) Разбивка строгой когорты по префиксу catalog_number ───
SELECT
  CASE
    WHEN catalog_number LIKE 'GB-ROYAL-%' THEN 'GB-ROYAL'
    WHEN catalog_number LIKE 'CH-PAMP-%' THEN 'CH-PAMP'
    WHEN catalog_number LIKE 'PL-MENNICA-GOLD-BAR-%' THEN 'PL-MENNICA-GOLD-BAR'
    WHEN catalog_number LIKE 'DE-GERMANIA-%' THEN 'DE-GERMANIA'
    WHEN catalog_number LIKE 'AU-PERTH-%' THEN 'AU-PERTH'
    WHEN catalog_number LIKE 'AT-%' THEN 'AT-*'
    ELSE 'OTHER'
  END AS catalog_bucket,
  COUNT(*) AS n
FROM coins
WHERE TRIM(IFNULL(country, '')) NOT LIKE 'Россия%'
  AND (mintage IS NULL OR mintage = 0)
  AND (mintage_display IS NULL OR TRIM(mintage_display) = '')
GROUP BY catalog_bucket
ORDER BY n DESC;

-- ─── 4) Выгрузка строк для ручной работы (первые 500 по id) ───
SELECT id, title, title_en, country, catalog_number, mint, source_url, mintage, mintage_display
FROM coins
WHERE TRIM(IFNULL(country, '')) NOT LIKE 'Россия%'
  AND (mintage IS NULL OR mintage = 0)
  AND (mintage_display IS NULL OR TRIM(mintage_display) = '')
ORDER BY id
LIMIT 500;
