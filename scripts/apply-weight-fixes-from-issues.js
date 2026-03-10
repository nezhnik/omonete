/**
 * Применяет правки весов к БД на основе weight-issues.csv.
 *
 * Формат строк weight-issues.csv:
 * url;title;weight_g;weight_oz
 * "https://omonete.ru/coins/4215/";"...";"1g → 1000g";"1 кгoz → 32.15oz"
 *
 * Стратегия:
 * - Всегда правим weight_g, если в ячейке есть "→" и правое значение отличается.
 * - Для weight_oz:
 *   - НЕ трогаем дроби (1/10, 1/4, 1/2, 1/25 и т.п.) — оставляем как есть.
 *   - НЕ трогаем килограммы ("1 кг", "2 кг" и т.п.) — текстовый вес для UI.
 *   - Автоматически правим только простые случаи "1oz → 5oz", "1oz → 10oz":
 *     тогда в БД ставим "5" или "10" (число унций).
 *
 * Всё остальное (сложные кейсы вроде 2 кг с weight_oz = 1) оставляем для ручной проверки.
 *
 * Запуск:
 *   node scripts/apply-weight-fixes-from-issues.js
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const CSV_PATH = path.join(__dirname, "..", "weight-issues.csv");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function parseIdFromUrl(url) {
  const m = url.match(/\/coins\/(\d+)\//);
  return m ? parseInt(m[1], 10) : null;
}

function extractRightG(cell) {
  if (!cell) return null;
  const m = cell.match(/→\s*([\d.,]+)g/);
  if (!m) return null;
  return m[1]; // строка "1000" или "3.11" и т.п.
}

function extractOzChange(cell) {
  if (!cell) return null;
  const currMatch = cell.match(/"?(.*?)oz/);
  const recMatch = cell.match(/→\s*([\d.,]+)oz/);
  if (!currMatch || !recMatch) return null;
  const curr = currMatch[1].trim();
  const rec = recMatch[1].trim();
  return { curr, rec };
}

async function main() {
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const lines = text.split(/\r?\n/);
  if (!lines.length) {
    console.log("weight-issues.csv пустой, делать нечего.");
    return;
  }

  const header = lines[0];
  const dataLines = lines.slice(1);

  const updates = [];

  for (const line of dataLines) {
    if (!line.trim()) continue;
    // Пропускаем групповые строки вида "0.1oz";"";"";""
    if (/^"\d+(\.\d+)?oz";"";"";""$/.test(line)) continue;

    const parts = line.split(";");
    if (parts.length < 4) continue;

    const rawUrl = parts[0].replace(/^"|"$/g, "");
    const id = parseIdFromUrl(rawUrl);
    if (!id) continue;

    const weightGCell = parts[2].replace(/^"|"$/g, "");
    const weightOzCell = parts[3].replace(/^"|"$/g, "");

    const newG = extractRightG(weightGCell);
    let newOz = null;

    // Решение по унциям:
    // 1) дроби (1/10, 1/4, 1/2, 1/25, 1/100 и т.п.) не трогаем
    if (/\/\d+/.test(weightOzCell)) {
      newOz = null;
    } else if (/кг/.test(weightOzCell)) {
      // 2) килограммы не трогаем
      newOz = null;
    } else if (weightOzCell.includes("→")) {
      // 3) простые случаи "1oz → 5oz" / "1oz → 10oz"
      const change = extractOzChange(weightOzCell);
      if (change) {
        const recNum = parseFloat(change.rec.replace(",", "."));
        const currNum = parseFloat(change.curr.replace(",", "."));
        if (Number.isFinite(recNum) && Number.isFinite(currNum)) {
          // Не меняем, если разницы нет
          if (Math.abs(recNum - currNum) > 0.01 && (recNum === 2 || recNum === 5 || recNum === 10)) {
            newOz = String(recNum);
          }
        }
      }
    }

    if (newG == null && newOz == null) continue;

    const patch = { id };
    if (newG != null) patch.weight_g = newG;
    if (newOz != null) patch.weight_oz = newOz;
    updates.push(patch);
  }

  if (!updates.length) {
    console.log("Нет автоматических правок для применения.");
    return;
  }

  console.log("К правке в БД (автоматически):", updates.length);

  const conn = await mysql.createConnection(getConfig());

  for (const u of updates) {
    const sets = [];
    const vals = [];
    if (u.weight_g != null) {
      sets.push("weight_g = ?");
      vals.push(u.weight_g);
    }
    if (u.weight_oz != null) {
      sets.push("weight_oz = ?");
      vals.push(u.weight_oz);
    }
    if (!sets.length) continue;
    vals.push(u.id);
    await conn.execute(`UPDATE coins SET ${sets.join(", ")} WHERE id = ?`, vals);
    console.log("UPDATE coins SET", sets.join(", "), "WHERE id =", u.id, "=>", vals);
  }

  await conn.end();
  console.log("Готово. Теперь перезапусти scripts/check-weights-consistency.js, чтобы обновить weight-issues.csv.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

