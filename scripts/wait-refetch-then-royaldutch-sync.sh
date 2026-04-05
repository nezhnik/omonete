#!/usr/bin/env bash
# Ждёт завершения fetch-royaldutch-all.js (если запущен), затем импорт → синхронизация JSON с БД → экспорт.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOG="${ROOT}/reports/royaldutch-night-pipeline.log"
mkdir -p "${ROOT}/reports"
exec >>"$LOG" 2>&1

echo "=== $(date) wait-refetch-then-sync старт ==="
while pgrep -f "fetch-royaldutch-all\.js" >/dev/null 2>&1; do
  echo "$(date) жду окончания fetch-royaldutch-all…"
  sleep 90
done
echo "$(date) fetch не запущен или уже завершён — npm royaldutch:import"
npm run royaldutch:import
echo "$(date) data:sync-source-json-images"
npm run data:sync-source-json-images
echo "$(date) data:export"
npm run data:export
echo "=== $(date) всё готово (импорт + синк + экспорт) ==="
