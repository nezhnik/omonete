-- Удалить монеты из каталога (MySQL), чтобы они не вернулись при следующем экспорте.
-- После выполнения: node scripts/export-coins-to-json.js (или npm run build).
-- IDs 5998 Corporate Personalised Medallions, 6000 Sovereigns (листинг Perth).

DELETE FROM coins WHERE id IN (5998, 6000);
