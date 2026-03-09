#!/bin/bash
# Полный цикл: серии из breadcrumb + картинки + импорт
cd "$(dirname "$0")/.."

echo "=== 1. fix-perth-series: обновляем серии из breadcrumb ==="
node scripts/fix-perth-series-from-page.js --from-urls

echo ""
echo "=== 2. redownload-perth-images: недостающие картинки (аверс, реверс, коробка, сертификат) ==="
node scripts/redownload-perth-images-from-raw.js --only-missing

echo ""
echo "=== 3. import: обновляем БД ==="
node scripts/import-perth-mint-to-db.js --all-by-source-url

echo ""
echo "Готово."
