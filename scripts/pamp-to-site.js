#!/usr/bin/env node
/**
 * После парсинга PAMP: залить спарсенные JSON в БД и обновить файлы каталога (public/data).
 * Один шаг вместо ручного pamp:import + pamp:import:minted-bars + data:export:incremental.
 *
 * Требует: .env с DATABASE_URL, заранее заполненные data/pamp-collectible-*.json и/или data/pamp-minted-bar-*.json.
 * Полный цикл «с сайта до JSON»: npm run pamp:sync | npm run pamp:sync:minted-bars
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

function hasCollectibleJson() {
  if (!fs.existsSync(DATA_DIR)) return false;
  return fs.readdirSync(DATA_DIR).some(
    (f) =>
      f.startsWith("pamp-collectible-") && f.endsWith(".json") && !f.includes("listing-products")
  );
}

function hasMintedJson() {
  if (!fs.existsSync(DATA_DIR)) return false;
  return fs.readdirSync(DATA_DIR).some((f) => f.startsWith("pamp-minted-bar-") && f.endsWith(".json"));
}

function run(scriptRel, extraArgs = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, scriptRel), ...extraArgs], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!hasCollectibleJson() && !hasMintedJson()) {
  console.error("Нет JSON для импорта в data/. Сначала спарсите:");
  console.error("  npm run pamp:sync              — collectibles (листинг + fetch + это же делает импорт и экспорт)");
  console.error("  npm run pamp:sync:minted-bars  — minted bars");
  console.error("Или только импорт+каталог, если JSON уже есть: npm run pamp:to-site");
  process.exit(1);
}

if (hasCollectibleJson()) {
  console.log("→ Импорт PAMP collectibles в БД…");
  run("scripts/import-pamp-to-db.js");
}
if (hasMintedJson()) {
  console.log("→ Импорт PAMP minted bars в БД…");
  run("scripts/import-pamp-to-db.js", ["--minted-bars"]);
}

console.log("→ Экспорт монет в public/data (инкрементально)…");
run("scripts/export-coins-to-json.js", ["--incremental"]);

console.log("");
console.log("Готово: позиции в public/data. Локально смотрите в dev; для сайта на хостинге: npm run build и выгрузите out/.");
