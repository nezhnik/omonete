/**
 * Проверка data/austrian-mint-*.json на ошибки классификации:
 *   1) один и тот же URL у obverse и reverse;
 *   2) obverse и reverse — разные «продукты» (имя файла после снятия _VS_/_RS_ не совпадает);
 *      (блистер без _vs_/_rs_ не сравниваем по стеблю — пропуск);
 *   3) box с _VS_, но стебель не совпадает с reverse.
 *
 * Запуск: node scripts/audit-austrian-mint-classified.js
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function thumbFileKey(u) {
  try {
    const url = new URL(String(u));
    const seg = url.pathname.split("/").filter(Boolean).pop() || "";
    return seg.toLowerCase().split("?")[0];
  } catch {
    return String(u || "")
      .toLowerCase()
      .split("?")[0];
  }
}

/** Убираем префикс-хеш из имён вида ac96946abc09-2024_5E_... */
function stripLeadingHash(f) {
  return f.replace(/^[a-f0-9]{12}-/i, "");
}

/** Стебель продукта: часть имени до _VS_ / _RS_ (NbAg_HGH_VS_2D_N, …). */
function productStemFromAnyCoinSide(u) {
  if (!u) return null;
  let f = stripLeadingHash(decodeURIComponent(thumbFileKey(u)));
  f = f.replace(/\.png\.webp$/i, "").replace(/\.webp$/i, "");
  const lower = f.toLowerCase();
  const vsi = lower.search(/_vs_/i);
  const rsi = lower.search(/_rs_/i);
  let cut = lower.length;
  if (vsi >= 0) cut = Math.min(cut, vsi);
  if (rsi >= 0) cut = Math.min(cut, rsi);
  return lower.slice(0, cut).trim() || null;
}

/** Одна монета с вариантами имён (Farbe/Rosa/Orange) на разных сторонах. */
function stemsCompatible(so, sr) {
  if (!so || !sr) return true;
  if (so === sr) return true;
  const norm = (s) =>
    s
      .replace(/_ag_farbe_/gi, "_ag_")
      .replace(/_ag_rosa_/gi, "_ag_")
      .replace(/_ag_orange_/gi, "_ag_");
  return norm(so) === norm(sr);
}

/** Наборы: на карточке разные монеты — стебли намеренно разные. */
function skipStemCheckForFilename(f) {
  return /seven-flower|spring-surprises|new-year-coin-set|coin-set-including/i.test(f);
}

function norm(u) {
  if (!u || typeof u !== "string") return "";
  try {
    const x = new URL(u.trim());
    x.hash = "";
    return x.toString();
  } catch {
    return u.trim();
  }
}

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter(
      (f) =>
        f.startsWith("austrian-mint-") &&
        f.endsWith(".json") &&
        !f.includes("listing-products")
    )
    .sort();

  const dup = [];
  const stemMismatch = [];
  const boxMismatch = [];

  for (const f of files) {
    const p = path.join(DATA_DIR, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    const c = raw.classified || {};
    const ob = c.obverse;
    const rev = c.reverse;
    const box = c.box;

    if (ob && rev && norm(ob) === norm(rev)) {
      dup.push({ file: f, source_url: raw.source_url });
    }

    const kOb = thumbFileKey(ob);
    const kRev = thumbFileKey(rev);
    const obIsCoinFace = /_vs_|_rs_/i.test(kOb);
    const revIsCoinFace = /_rs_|_vs_/i.test(kRev);

    if (
      ob &&
      rev &&
      obIsCoinFace &&
      revIsCoinFace &&
      /_rs_/i.test(kRev) &&
      !skipStemCheckForFilename(f)
    ) {
      const so = productStemFromAnyCoinSide(ob);
      const sr = productStemFromAnyCoinSide(rev);
      if (so && sr && so !== sr && !stemsCompatible(so, sr)) {
        stemMismatch.push({
          file: f,
          source_url: raw.source_url,
          stemObverse: so,
          stemReverse: sr,
        });
      }
    }

    if (box && rev && /_vs_/i.test(thumbFileKey(box)) && /_rs_/i.test(kRev)) {
      const sb = productStemFromAnyCoinSide(box);
      const sr = productStemFromAnyCoinSide(rev);
      if (sb && sr && sb !== sr) {
        boxMismatch.push({ file: f, source_url: raw.source_url });
      }
    }
  }

  console.log("=== Münze Österreich: аудит classified ===\n");
  console.log("JSON файлов:", files.length);
  console.log("\n1) obverse === reverse (один URL):", dup.length);
  dup.forEach((x) => console.log("   ", x.file, "\n      ", x.source_url));

  console.log(
    "\n2) obverse и reverse с _VS_/_RS_, но разный стебель имени (чужая монета, набор или вариант имени):",
    stemMismatch.length
  );
  stemMismatch.forEach((x) =>
    console.log(
      "   ",
      x.file,
      "\n      ",
      x.source_url,
      "\n      stemObv:",
      x.stemObverse,
      "\n      stemRev:",
      x.stemReverse
    )
  );

  console.log("\n3) box с _VS_, стебель ≠ reverse:", boxMismatch.length);
  boxMismatch.forEach((x) => console.log("   ", x.file, "\n      ", x.source_url));

  const bad = dup.length + stemMismatch.length + boxMismatch.length;
  console.log("\n--- Итого подозрительных:", bad, "---");
  process.exit(bad > 0 ? 1 : 0);
}

main();
