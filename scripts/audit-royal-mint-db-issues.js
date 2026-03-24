/**
 * Монеты The Royal Mint в БД с типичными проблемами после парсинга/импорта.
 *
 *   node scripts/audit-royal-mint-db-issues.js
 *   node scripts/audit-royal-mint-db-issues.js --json   → data/royal-mint-db-issues.json
 *
 * Всегда пишет data/royal-mint-problem-urls.md — ссылки source_url по группам проблем.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const PLACEHOLDER = "/image/coin-placeholder.png";

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function isPlaceholderPath(p) {
  if (!p || typeof p !== "string") return true;
  const s = p.trim().toLowerCase();
  return s === PLACEHOLDER || /coin-placeholder|placeholder\.png/i.test(s);
}

function normSourceUrl(u) {
  if (u == null || typeof u !== "string") return "";
  const s = u.trim();
  return s && /^https?:\/\//i.test(s) ? s : "";
}

/**
 * @param {{ heading: string, items: { id: unknown, catalog_number?: unknown, title?: unknown, source_url?: string }[] }[]} groups
 */
function writeProblemUrlsMarkdown(outPath, groups) {
  const lines = [
    "# The Royal Mint — проблемные монеты (ссылки на PDP)",
    "",
    `Сгенерировано: ${new Date().toISOString()} (\`node scripts/audit-royal-mint-db-issues.js\`)`,
    "",
    "В БД в колонке `source_url` — канонический URL страницы товара (без query). Если ссылки нет, строка помечена.",
    "",
  ];
  let n = 1;
  for (const g of groups) {
    if (!g.items || g.items.length === 0) continue;
    lines.push(`## ${n}. ${g.heading} (${g.items.length})`, "");
    for (const it of g.items) {
      const title = String(it.title || "(без названия)").replace(/\r?\n/g, " ").trim();
      const cat = it.catalog_number != null ? String(it.catalog_number).trim() : "";
      const id = it.id != null ? String(it.id) : "";
      const url = normSourceUrl(it.source_url);
      if (url) {
        lines.push(`- [${title}](${url}) — \`${cat || "—"}\` — id ${id || "—"}`);
      } else {
        lines.push(`- ${title} — \`${cat || "—"}\` — id ${id || "—"} — **нет source_url в БД**`);
      }
    }
    lines.push("");
    n++;
  }
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

async function main() {
  const jsonOut = process.argv.includes("--json");
  const conn = await mysql.createConnection(getConfig());
  let rows;
  try {
    const [r] = await conn.execute(
      `SELECT id, catalog_number, title, image_obverse, image_reverse, image_urls,
              image_blister_obverse, image_blister_reverse, source_url, mint, mint_short
       FROM coins
       WHERE catalog_number LIKE 'GB-ROYAL-%'
          OR (source_url IS NOT NULL AND source_url LIKE '%royalmint.com%')
          OR mint LIKE '%Royal Mint%'
          OR mint_short LIKE '%Royal Mint%'`
    );
    rows = r;
  } catch (e) {
    if (e.code === "ER_BAD_FIELD_ERROR" && /source_url/.test(e.message)) {
      const [r] = await conn.execute(
        `SELECT id, catalog_number, title, image_obverse, image_reverse, image_urls,
                image_blister_obverse, image_blister_reverse, mint, mint_short
         FROM coins
         WHERE catalog_number LIKE 'GB-ROYAL-%'
            OR mint LIKE '%Royal Mint%'
            OR mint_short LIKE '%Royal Mint%'`
      );
      rows = r;
    } else throw e;
  }
  await conn.end();

  const badTitle = [];
  const missingBothCoinSides = [];
  const noExportableImage = [];
  const onlyOneCoinSide = [];

  for (const r of rows) {
    const title = String(r.title || "").trim();
    if (/404\s+page\s+not\s+found/i.test(title) || /^welcome to the royal mint$/i.test(title)) {
      badTitle.push({
        id: r.id,
        catalog_number: r.catalog_number,
        title,
        source_url: r.source_url != null ? String(r.source_url).trim() : "",
      });
      continue;
    }

    const ob = r.image_obverse && String(r.image_obverse).trim();
    const rev = r.image_reverse && String(r.image_reverse).trim();
    const bo = r.image_blister_obverse && String(r.image_blister_obverse).trim();
    const br = r.image_blister_reverse && String(r.image_blister_reverse).trim();
    const hasBlisterPair = !!(bo && br);
    let imageUrls = r.image_urls;
    if (typeof imageUrls === "string") {
      try {
        imageUrls = JSON.parse(imageUrls);
      } catch {
        imageUrls = [];
      }
    }
    const hasImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0;

    if (!ob && !rev) {
      missingBothCoinSides.push({
        id: r.id,
        catalog_number: r.catalog_number,
        title: r.title,
        blister_obverse: !!bo,
        blister_reverse: !!br,
        source_url: r.source_url != null ? String(r.source_url).trim() : "",
      });
    } else if (!ob || !rev) {
      onlyOneCoinSide.push({
        id: r.id,
        catalog_number: r.catalog_number,
        title: r.title,
        has_obverse: !!ob,
        has_reverse: !!rev,
        blister_obverse: !!bo,
        blister_reverse: !!br,
        source_url: r.source_url != null ? String(r.source_url).trim() : "",
      });
    }

    const hasRealObv = ob && !isPlaceholderPath(ob);
    const hasRealRev = rev && !isPlaceholderPath(rev);
    const exportable =
      hasBlisterPair ||
      (hasRealObv && hasRealRev) ||
      (hasRealObv || hasRealRev) ||
      hasImageUrls;
    if (!exportable) {
      noExportableImage.push({
        id: r.id,
        catalog_number: r.catalog_number,
        title: r.title,
        source_url: r.source_url != null ? String(r.source_url).trim() : "",
      });
    }
  }

  const summary = {
    totalRoyalMintRows: rows.length,
    badTitle404OrWelcome: badTitle.length,
    missingBothCoinSides: missingBothCoinSides.length,
    onlyOneCoinSide: onlyOneCoinSide.length,
    noExportableImage: noExportableImage.length,
  };

  console.log("=== Аудит The Royal Mint в БД ===\n");
  console.log("Всего строк (GB-ROYAL / royalmint / mint):", summary.totalRoyalMintRows);
  console.log("Плохой заголовок (404 / Welcome…):", summary.badTitle404OrWelcome);
  console.log("Нет ни аверса, ни реверса в колонках obv/rev:", summary.missingBothCoinSides);
  console.log("Только одна сторона монеты (obv или rev):", summary.onlyOneCoinSide);
  console.log("Нет экспортируемой картинки (ни пары блистеров, ни сторон, ни image_urls):", summary.noExportableImage);

  const printSample = (label, arr, n = 15) => {
    if (arr.length === 0) return;
    console.log("\n—", label, "(первые", Math.min(n, arr.length), "из", arr.length, ") —");
    for (const x of arr.slice(0, n)) {
      console.log(`  id=${x.id} ${x.catalog_number || ""} | ${String(x.title || "").slice(0, 70)}`);
    }
  };
  printSample("Плохой title", badTitle);
  printSample("Нет obv и rev", missingBothCoinSides);
  printSample("Только одна сторона", onlyOneCoinSide);
  printSample("Нет экспортируемого изображения", noExportableImage);

  const mdPath = path.join(__dirname, "..", "data", "royal-mint-problem-urls.md");
  writeProblemUrlsMarkdown(mdPath, [
    { heading: "Плохой заголовок (404 PAGE NOT FOUND или «Welcome to The Royal Mint»)", items: badTitle },
    {
      heading: "Нет ни image_obverse, ни image_reverse (в т.ч. только блистер или пусто)",
      items: missingBothCoinSides,
    },
    { heading: "Только одна сторона монеты в колонках (obverse или reverse)", items: onlyOneCoinSide },
    {
      heading:
        "Нет экспортируемой картинки (ни пары блистеров, ни нормальных obv/rev, ни массива image_urls)",
      items: noExportableImage,
    },
  ]);
  console.log("\n✓ Ссылки по группам:", mdPath);

  if (jsonOut) {
    const outPath = path.join(__dirname, "..", "data", "royal-mint-db-issues.json");
    fs.writeFileSync(
      outPath,
      JSON.stringify({ summary, badTitle, missingBothCoinSides, onlyOneCoinSide, noExportableImage }, null, 2)
    );
    console.log("✓ JSON:", outPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
