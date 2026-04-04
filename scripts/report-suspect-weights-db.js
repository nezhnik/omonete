/**
 * Отчёт: монеты с подозрительным weight_g (типичные баги парсинга, экстремумы).
 * Запуск: node scripts/report-suspect-weights-db.js
 * Вывод: reports/suspect-weights-db.md
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const OZT = 31.1034768;

function parseLeadingYear(title) {
  const m = String(title || "").match(/^((?:19|20)\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function parseLatinOzFromCol(woz) {
  const s = String(woz || "").trim();
  if (/унц|гр\.|грам|кг\b/i.test(s) && !/\boz\b/i.test(s)) return null;
  const m = s.match(/([\d.]+)\s*oz\b/i);
  return m ? parseFloat(m[1]) : null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  const [rows] = await conn.execute(`
    SELECT id, title, weight_g, weight_oz, source_url, mint_short
    FROM coins
    WHERE weight_g IS NOT NULL AND TRIM(weight_g) != ''
  `);
  await conn.end();

  const byYearKilo = [];
  const byYearOz = [];
  const huge = [];
  const ozMismatch = [];
  const plainOzAmbiguous = [];
  const titleKiloVsTinyG = [];

  for (const r of rows) {
    const g = parseFloat(String(r.weight_g).replace(",", "."));
    if (!Number.isFinite(g)) continue;
    const title = r.title || "";
    const year = parseLeadingYear(title);

    if (g > 25000) {
      huge.push({
        id: r.id,
        g,
        weight_oz: r.weight_oz,
        title,
        why: "weight_g > 25 kg",
      });
    }

    if (year != null && year >= 1980 && year <= 2105) {
      if (Math.abs(g - year * 1000) < 25) {
        byYearKilo.push({ id: r.id, g, year, title, why: `≈ ${year}×1000 г (часто баг «год + Kilo»)` });
      }
      if (Math.abs(g - year * OZT) < 25) {
        byYearOz.push({ id: r.id, g, year, title, why: `≈ ${year} тр. унций в граммах` });
      }
    }

    const oz = parseLatinOzFromCol(r.weight_oz);
    if (oz != null && oz > 0 && oz < 8000) {
      const exp = oz * OZT;
      if (Math.abs(g - exp) / exp > 0.1 && Math.abs(g - exp) > 20) {
        ozMismatch.push({
          id: r.id,
          g,
          weight_oz: r.weight_oz,
          expectG: exp.toFixed(2),
          title,
        });
      }
    }

    const w = String(r.weight_oz || "").trim();
    if (w && /^[\d.]+$/.test(w)) {
      const n = parseFloat(w);
      if (n > 50 && n < 50000) {
        plainOzAmbiguous.push({ id: r.id, g, weight_oz: w, title });
      }
    }

    const tlow = title.toLowerCase();
    if (
      g < 500 &&
      /\b(2|5|10)\s*kilo\b|\b\d+\s*kilo\b|10\s*kg/i.test(tlow) &&
      !/1\/|one tenth|fraction/i.test(tlow)
    ) {
      titleKiloVsTinyG.push({ id: r.id, g, weight_oz: r.weight_oz, title });
    }
  }

  const lines = [];
  lines.push("# Подозрительный вес в БД (авто-отчёт)", "");
  lines.push(
    "Эвристики: **год×1000**, **год×31,1 г** (как у старых багов Germania), **>25 кг**, **голое число в weight_oz**, **лат. oz не к weight_g**.",
    ""
  );

  function sect(name, arr, fmt) {
    lines.push(`## ${name} (${arr.length})`, "");
    if (!arr.length) {
      lines.push("— нет —", "");
      return;
    }
    arr.forEach((x) => lines.push(fmt(x)));
    lines.push("");
  }

  sect("weight_g ≈ год × 1000", byYearKilo, (x) =>
    `- **${x.id}** | ${x.g} g | ${String(x.title).slice(0, 72)} | ${x.why}`
  );
  sect("weight_g ≈ год в тр. унциях (граммы)", byYearOz, (x) =>
    `- **${x.id}** | ${x.g} g | ${String(x.title).slice(0, 72)} | ${x.why}`
  );
  sect("Очень большой weight_g (>25 кг)", huge, (x) =>
    `- **${x.id}** | ${x.g} g | weight_oz: ${x.weight_oz || "—"} | ${String(x.title).slice(0, 65)}`
  );
  sect("weight_oz — только число (крупное), без единиц", plainOzAmbiguous, (x) =>
    `- **${x.id}** | ${x.g} g | weight_oz=\`${x.weight_oz}\` | ${String(x.title).slice(0, 70)}`
  );

  sect(
    "В названии Kilo / кг, а weight_g < 500 (проверить)",
    titleKiloVsTinyG,
    (x) =>
      `- **${x.id}** | ${x.g} g | ${x.weight_oz || "—"} | ${String(x.title).slice(0, 72)}`
  );

  const ozCap = 150;
  sect(
    `Лат. oz в weight_oz расходится с weight_g (>10%, первые ${ozCap})`,
    ozMismatch.slice(0, ozCap),
    (x) =>
      `- **${x.id}** | БД ${x.g} g, по oz ожид. ~${x.expectG} g | ${x.weight_oz} | ${String(x.title).slice(0, 55)}`
  );
  if (ozMismatch.length > ozCap) {
    lines.push(`… всего ${ozMismatch.length} расхождений (часть может быть из‑за дробей/полей).`, "");
  }

  const out = path.join(__dirname, "..", "reports", "suspect-weights-db.md");
  fs.writeFileSync(out, lines.join("\n"), "utf8");
  console.log("OK:", out);
  console.log({
    byYearKilo: byYearKilo.length,
    byYearOz: byYearOz.length,
    huge: huge.length,
    plainNum: plainOzAmbiguous.length,
    ozMismatch: ozMismatch.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
