/**
 * Временно убирает app/api из проекта перед next build (output: export),
 * чтобы сборка не падала на force-dynamic. После сборки возвращает api обратно.
 * Использование: node scripts/move-api-for-export.js off  |  node scripts/move-api-for-export.js on
 */
const fs = require("fs");
const path = require("path");

const appDir = path.join(__dirname, "..", "app");
const apiDir = path.join(appDir, "api");
const backupDir = path.join(__dirname, "..", ".api-backup-for-export");

const mode = process.argv[2];
if (mode === "off") {
  if (fs.existsSync(apiDir)) {
    if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true });
    fs.renameSync(apiDir, backupDir);
    console.log("✓ app/api временно перемещён в .api-backup-for-export");
  }
} else if (mode === "on") {
  if (fs.existsSync(backupDir)) {
    if (fs.existsSync(apiDir)) fs.rmSync(apiDir, { recursive: true });
    fs.renameSync(backupDir, apiDir);
    console.log("✓ app/api восстановлен");
  }
} else {
  console.error("Использование: node move-api-for-export.js off | on");
  process.exit(1);
}
