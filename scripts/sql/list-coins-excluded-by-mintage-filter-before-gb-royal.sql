-- Монеты, которые НЕ попадали в каталог по старому правилу export-coins-to-json.js
-- (до добавления исключения catalog_number LIKE 'GB-ROYAL-%').
--
-- Условие «исключения из каталога» было:
--   НЕТ числового тиража: mintage IS NULL или 0
--   И НЕТ исключения для иностранных: не (страна ≠ Россия и mintage_display непустой)
--
-- Такие строки есть в таблице coins, но раньше не попадали в public/data/coins.json.
-- Часть из них — Royal Mint bullion с GB-ROYAL-*; после исправления экспорта они УЖЕ попадают в каталог.
--
-- Запуск (пример):
--   mysql -u USER -p DB_NAME < scripts/sql/list-coins-excluded-by-mintage-filter-before-gb-royal.sql
-- или сохранить в файл:
--   mysql ... -e "source scripts/sql/..." > data/coins-excluded-by-mintage.tsv

SELECT
  id,
  title,
  country,
  catalog_number,
  mintage,
  mintage_display,
  mint,
  mint_short,
  source_url,
  CASE
    WHEN catalog_number LIKE 'GB-ROYAL-%' THEN 'теперь в каталоге (исключение GB-ROYAL)'
    ELSE 'по-прежнему вне каталога, пока не заполнен mintage/mintage_display или нет другого исключения'
  END AS catalog_status_after_fix
FROM coins
WHERE
  (mintage IS NULL OR mintage = 0)
  AND NOT (
    country IS NOT NULL
    AND TRIM(country) NOT LIKE 'Россия%'
    AND mintage_display IS NOT NULL
    AND TRIM(mintage_display) <> ''
  )
ORDER BY
  catalog_number LIKE 'GB-ROYAL-%' DESC,
  country,
  id;
