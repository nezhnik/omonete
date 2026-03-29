/**
 * Пишет weight_g и weight_oz в MySQL из public/data/coins/<id>.json
 * для явно перечисленных id (ручные правки веса на сайте).
 *
 *   node scripts/sync-coin-weights-from-json-to-db.js
 *   node scripts/sync-coin-weights-from-json-to-db.js --dry-run
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const TROY = 31.1034768;

/** Id монет, у которых в JSON выровняли вес относительно каталога / названия */
const COIN_IDS = [
  "4230",
  "4582",
  "4583",
  "4636",
  "4650",
  "4653",
  "4681",
  "5577",
  "5615",
  "5670",
  "5684",
  "5699",
  "5715",
  "5801",
  "5802",
  "5836",
  "6556",
  "6577",
  "6618",
  "7615",
];

const COINS_DIR = path.join(__dirname, "..", "public", "data", "coins");

function parseG(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Значение weight_oz для БД: как в JSON или эвристика по граммам */
function weightOzForDb(coin, g) {
  const raw = coin.weightOz ?? coin.weightOzDisplay;
  if (raw != null && String(raw).trim()) {
    const s = String(raw).trim();
    if (/oz/i.test(s)) return s.replace(/\s+/g, " ");
    if (/^\d+\s*\/\s*\d/.test(s)) return /oz/i.test(s) ? s : `${s} oz`;
    if (/^[\d.,]+$/.test(s)) return `${String(s).replace(",", ".")} oz`;
    return s;
  }
  if (g == null || !Number.isFinite(g)) return null;
  const ratios = [
    [0.1, "1/10 oz"],
    [0.125, "1/8 oz"],
    [0.25, "1/4 oz"],
    [0.5, "1/2 oz"],
    [1, "1 oz"],
    [2, "2 oz"],
    [5, "5 oz"],
    [10, "10 oz"],
  ];
  const n = g / TROY;
  let best = null;
  let bestD = Infinity;
  for (const [r, label] of ratios) {
    const d = Math.abs(n - r);
    if (d < bestD) {
      bestD = d;
      best = label;
    }
  }
  if (best && bestD < 0.08) return best;
  if (Math.abs(g - 1000) < 2) return "32.15 oz";
  return `${Math.round(n * 1000) / 1000} oz`;
}

function parseDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  const m = url && url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Нужен DATABASE_URL вида mysql://user:pass@host:port/db");
  const [, user, password, host, port, database] = m;
  return {
    host,
    port: Number(port),
    user,
    password,
    database,
    connectTimeout: 20000,
  };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const cfg = parseDatabaseUrl();
  const conn = await mysql.createConnection(cfg);

  let updated = 0;
  let missing = 0;

  for (const id of COIN_IDS) {
    const fp = path.join(COINS_DIR, `${id}.json`);
    if (!fs.existsSync(fp)) {
      console.warn(`Нет файла ${fp}`);
      missing++;
      continue;
    }
    let j;
    try {
      j = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch (e) {
      console.warn(`Плохой JSON ${id}:`, e.message);
      missing++;
      continue;
    }
    const c = j.coin;
    if (!c) {
      missing++;
      continue;
    }
    const g = parseG(c.weightG);
    const oz = weightOzForDb(c, g);
    if (g == null) {
      console.warn(`id ${id}: нет weightG в JSON`);
      missing++;
      continue;
    }

    const [[row]] = await conn.execute(`SELECT id, weight_g, weight_oz, title FROM coins WHERE id = ? LIMIT 1`, [id]);
    if (!row) {
      console.warn(`id ${id}: нет строки в БД`);
      missing++;
      continue;
    }

    const sameG = parseG(row.weight_g) != null && Math.abs(parseG(row.weight_g) - g) < 0.001;
    const sameOz =
      (row.weight_oz == null && oz == null) ||
      (row.weight_oz != null &&
        oz != null &&
        String(row.weight_oz).trim() === String(oz).trim());

    if (sameG && sameOz) {
      console.log(`id ${id}: уже совпадает (${g} / ${oz ?? "null"})`);
      continue;
    }

    console.log(
      `id ${id}: БД ${row.weight_g} / ${row.weight_oz} → JSON→БД ${g} / ${oz ?? "null"} | ${String(row.title || "").slice(0, 55)}`
    );
    if (!dry) {
      await conn.execute(`UPDATE coins SET weight_g = ?, weight_oz = ? WHERE id = ?`, [g, oz, id]);
    }
    updated++;
  }

  await conn.end();
  console.log(dry ? `\nDry-run: было бы обновлено ${updated}` : `\nГотово: обновлено ${updated}, пропусков/ошибок ${missing}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
