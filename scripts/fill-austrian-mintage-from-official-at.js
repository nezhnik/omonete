/**
 * Дозаполнение тиража для монет Münze Österreich в БД из официальной таблицы «Auflage»
 * на https://www.muenzeoesterreich.at/produkte/... (ссылка берётся со страницы .com).
 *
 * Источники:
 *   1) muenzeoesterreich.com/en/products/… → href на muenzeoesterreich.at/produkte/…
 *   2) HTML .at: пары Auflage (Normalprägung|Polierte Platte|Handgehoben) → число
 *
 * Если на странице варианта нет строк Auflage — перебираются URL-варианты (-hgh → -pp, -pp → -np).
 * Наборы без Auflage: см. data/austrian-mintage-overrides.json (подставляется mintage_display).
 *
 *   node scripts/fill-austrian-mintage-from-official-at.js           — сухой прогон
 *   node scripts/fill-austrian-mintage-from-official-at.js --apply    — UPDATE в БД
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const OVERRIDES_PATH = path.join(__dirname, "..", "data", "austrian-mintage-overrides.json");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "de-AT,de;q=0.9,en;q=0.8" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Первый линк на немецкую карточку товара .at (не корень домена). */
function extractAtProduktUrl(comHtml) {
  const re = /href="(https:\/\/www\.muenzeoesterreich\.at\/produkte\/[^"]+)"/gi;
  let m;
  while ((m = re.exec(comHtml)) !== null) {
    const u = m[1];
    if (!/\/produkte\/[^/]+\/?$/i.test(u.replace(/\/$/, ""))) continue;
    if (u.replace(/\/$/, "").endsWith("muenzeoesterreich.at")) continue;
    return u;
  }
  return null;
}

function parseAuflageMap(html) {
  const map = {};
  const re = /<td class="label">Auflage \(([^)]+)\)<\/td>\s*<td class="content">\s*([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const key = m[1].trim();
    const raw = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    map[key] = raw;
  }
  return map;
}

/** Нем. 130.000 или 30.000 или «130.000 Kupfer» */
function parseGermanInt(s) {
  const t = String(s || "")
    .replace(/−/g, "-")
    .trim();
  if (!t || t === "-" || /^n\/a$/i.test(t)) return null;
  const digits = t.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function inferQualityFromTitle(title) {
  const t = String(title || "");
  if (/\bCoin P\b|\bCoin P$|\sP$/i.test(t) || /\bProof\b/i.test(t)) return "Proof";
  if (/\bSU\b|Special Uncirculated/i.test(t)) return "Special Uncirculated";
  if (/\bUnc\.|Uncirculated|Unc\b/i.test(t)) return "Uncirculated";
  return "";
}

function pickMintageFromMap(map, qualityRaw, metalRaw, title) {
  const q = String(qualityRaw || inferQualityFromTitle(title) || "").toLowerCase();
  const metal = String(metalRaw || "");
  const isGold = /золото|gold|\bAu\b/i.test(metal);
  const isCopper = /медь|copper|\bCu\b/i.test(metal) || /\bcopper\b/i.test(title);

  if (q.includes("proof") || /\bCoin P\b/i.test(title)) {
    const v = map["Polierte Platte"];
    const n = parseGermanInt(v);
    if (n) return { n, label: "Polierte Platte", raw: v };
  }
  if (q.includes("special uncirculated") || /\bSU\b/i.test(title)) {
    const v = map["Handgehoben"];
    const n = parseGermanInt(v);
    if (n) return { n, label: "Handgehoben", raw: v };
  }
  if (q.includes("uncirculated") || q.includes("unc.") || /\bUnc\b/i.test(title)) {
    const v = map["Normalprägung"];
    const n = parseGermanInt(v);
    if (n && (isCopper || (!isGold && n))) return { n, label: "Normalprägung", raw: v };
  }
  return null;
}

function variantUrls(primary) {
  const u = new URL(primary);
  const pathParts = u.pathname.replace(/\/$/, "").split("/");
  const seg = pathParts[pathParts.length - 1] || "";
  const out = new Set([u.href.replace(/\/$/, "")]);
  const pushSeg = (newSeg) => {
    const p = [...pathParts];
    p[p.length - 1] = newSeg;
    const nu = new URL(u.origin + p.join("/") + "/");
    out.add(nu.href.replace(/\/$/, ""));
  };
  if (/-hgh$/i.test(seg)) pushSeg(seg.replace(/-hgh$/i, "-pp"));
  if (/-pp$/i.test(seg)) pushSeg(seg.replace(/-pp$/i, "-np"));
  if (/silbermuenze-/i.test(seg)) {
    const k = seg.replace(/silbermuenze-/i, "kupfermuenze-").replace(/-hgh$/i, "-np").replace(/-pp$/i, "-np");
    if (k !== seg) pushSeg(k);
  }
  return [...out];
}

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function resolveOne(row, overrides) {
  const idStr = String(row.id);
  if (overrides[idStr]) {
    const o = overrides[idStr];
    return {
      id: row.id,
      source: "overrides-json",
      mintage: o.mintage != null ? Number(o.mintage) : null,
      mintage_display: o.mintage_display || null,
      note: o.note || null,
    };
  }

  const url = String(row.source_url || "").trim();
  if (!url || !/muenzeoesterreich\.com/i.test(url)) {
    return { id: row.id, source: "skip", error: "no .com url" };
  }

  let comHtml;
  try {
    comHtml = await fetchText(url);
  } catch (e) {
    return { id: row.id, source: "error", error: String(e.message || e) };
  }

  const atPrimary = extractAtProduktUrl(comHtml);
  if (!atPrimary) {
    return { id: row.id, source: "error", error: "no .at produkte link" };
  }

  const urls = variantUrls(atPrimary);
  let map = {};
  let usedUrl = null;
  for (const u of urls) {
    try {
      const html = await fetchText(u);
      map = parseAuflageMap(html);
      if (Object.keys(map).length > 0) {
        usedUrl = u;
        break;
      }
    } catch {
      /* try next */
    }
    await sleep(400);
  }

  if (Object.keys(map).length === 0) {
    return {
      id: row.id,
      source: "no-auflage-table",
      atPrimary,
      hint: "Добавьте запись в data/austrian-mintage-overrides.json",
    };
  }

  const picked = pickMintageFromMap(map, row.quality, row.metal, row.title);
  if (!picked) {
    return {
      id: row.id,
      source: "unmapped-quality",
      usedUrl,
      map,
      quality: row.quality,
      metal: row.metal,
    };
  }

  const disp = `${picked.n.toLocaleString("en-US")} (Münze Österreich: Auflage ${picked.label}${picked.raw && picked.raw !== String(picked.n) ? ` — ${picked.raw}` : ""})`;
  return {
    id: row.id,
    source: "muenzeoesterreich.at",
    usedUrl,
    mintage: picked.n,
    mintage_display: disp,
    note: `Источник: ${usedUrl} (таблица Auflage)`,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const cfg = getConfig();
  const conn = await mysql.createConnection(cfg);
  const overrides = loadOverrides();

  const [rows] = await conn.execute(
    `SELECT id, title, source_url, quality, metal, mintage, mintage_display
     FROM coins
     WHERE country = 'Австрия'
       AND source_url LIKE '%muenzeoesterreich%'
       AND (mintage IS NULL OR mintage = 0)
       AND (mintage_display IS NULL OR TRIM(mintage_display) = '')`
  );

  console.log("Кандидатов в БД:", rows.length);
  const results = [];
  for (const row of rows) {
    const r = await resolveOne(row, overrides);
    results.push(r);
    console.log(
      apply ? "…" : "",
      row.id,
      row.title.slice(0, 52),
      "→",
      r.mintage != null ? r.mintage : r.source + (r.error ? `: ${r.error}` : "")
    );
    await sleep(650);
  }

  const ok = results.filter((r) => r.mintage != null || (r.mintage_display && String(r.mintage_display).trim()));
  const needOverride = results.filter((r) => r.source === "no-auflage-table" || r.source === "unmapped-quality");

  console.log("\n--- Итог ---");
  console.log("С данными для записи (число и/или текст):", ok.length);
  console.log("Нужны overrides / ручная проверка:", needOverride.length);
  needOverride.forEach((r) => console.log(" ", r.id, r.source, r.map ? JSON.stringify(r.map) : r.hint || ""));

  if (apply) {
    let n = 0;
    for (const r of ok) {
      if (r.source === "overrides-json" || r.source === "muenzeoesterreich.at") {
        await conn.execute(
          `UPDATE coins SET mintage = ?, mintage_display = ? WHERE id = ?`,
          [r.mintage != null ? r.mintage : null, r.mintage_display || null, r.id]
        );
        n++;
      }
    }
    console.log("\n✓ UPDATE выполнен для", n, "строк");
  } else {
    console.log("\nСухой прогон. Для записи в БД: node scripts/fill-austrian-mintage-from-official-at.js --apply");
  }

  const out = path.join(__dirname, "..", "data", "austrian-mintage-fill-report.json");
  fs.writeFileSync(
    out,
    JSON.stringify({ generatedAt: new Date().toISOString(), apply, results }, null, 2)
  );
  console.log("Отчёт:", out);

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
