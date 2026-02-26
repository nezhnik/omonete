/**
 * Загружает характеристики монет с сайта ЦБ (блок commemor-coin_info_characteristics)
 * и обновляет в БД: quality, diameter_mm, thickness_mm, length_mm, width_mm, weight_g, mint.
 * В weight_g заносим только граммы (содержание чистого металла); унции пересчитываются при экспорте.
 * Вес берётся из «Содержание химически чистого металла не менее, г» или «Масса металла, гр.».
 * Монетный двор — из блока «Авторы» (commemor-coin_content): «Чеканка: Московский монетный двор (ММД).»
 * Длина, мм и Ширина, мм — для прямоугольных монет (вместо диаметра).
 *
 * Запуск: node scripts/fetch-cbr-characteristics.js [--all] [--fill-weight-only] [--fill-mint-only] [--rectangular-only] [--cat-prefix=5617] [N]
 *   N — число монет. По умолчанию 20. --all — все.
 *   --fill-weight-only — только монеты без веса.
 *   --fill-mint-only — только монеты без mint (парсим монетный двор).
 *   --rectangular-only — только прямоугольные монеты (из rectangular-coins.json), загружаем длину и ширину.
 *   --cat-prefix=5617 — только монеты с catalog_number LIKE '5617%'.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const path = require("path");
const fs = require("fs");
const { formatSpaceBeforeParen } = require("./format-coin-characteristics.js");

const CBR_SHOW_COINS =
  "https://www.cbr.ru/cash_circulation/memorable_coins/coins_base/ShowCoins/?cat_num=";
const numArg = process.argv.find((a) => /^\d+$/.test(a));
const fillWeightOnly = process.argv.includes("--fill-weight-only");
const fillMintOnly = process.argv.includes("--fill-mint-only");
const rectangularOnly = process.argv.includes("--rectangular-only");
const catPrefixArg = process.argv.find((a) => a.startsWith("--cat-prefix="));
const catPrefix = catPrefixArg ? catPrefixArg.split("=")[1] : null;
const LIMIT = process.argv.includes("--all") ? 100000 : (numArg ? parseInt(numArg, 10) : 20);
const DELAY_MS = 400;

function getRectangularCatalogBases() {
  try {
    const p = path.join(__dirname, "..", "rectangular-coins.json");
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Парсит монетный двор из страницы ЦБ.
 * 1. Блок «Авторы» (commemor-coin_content)
 * 2. При отсутствии — поиск по всей странице (в т.ч. «Чеканка» внизу в историко-тематической справке)
 * Формат 1: «Чеканка: Московский монетный двор (ММД).»
 * Формат 2: перечисление без «Чеканка» — «Московский монетный двор (ММД) Ленинградский монетный двор (ЛМД).»
 */
function parseMintFromAuthors(html) {
  const blockStart = html.indexOf("commemor-coin_content");
  const searchStart = blockStart !== -1 ? blockStart : 0;
  const authorsIdx = html.indexOf("Авторы", searchStart);
  const blockEnd = authorsIdx !== -1 ? authorsIdx + 3000 : searchStart + 15000;
  let block = html.slice(authorsIdx !== -1 ? authorsIdx : searchStart, Math.min(blockEnd, html.length));
  const оформлениеIdx = block.indexOf("Оформление");
  if (оформлениеIdx !== -1) block = block.slice(0, оформлениеIdx);

  let m = block.match(/Чеканка:\s*([^.]+?)(?:\.|$)/);
  if (m) return m[1].trim() || null;

  const mintMatches = block.matchAll(/([А-Яа-яё\s\-–]+монетный двор\s*\([А-Яа-я]+\))/g);
  const mints = [...mintMatches].map((x) => x[1].trim()).filter(Boolean);
  if (mints.length > 0) return mints.join(", ");

  m = html.match(/Чеканка:\s*([^.]+?)(?:\.|$)/);
  if (m) return m[1].trim() || null;

  const fullMintMatches = html.matchAll(/([А-Яа-яё\s\-–]+монетный двор\s*\([А-Яа-я]+\))/g);
  const fullMints = [...fullMintMatches].map((x) => x[1].trim()).filter(Boolean);
  if (fullMints.length > 0) return [...new Set(fullMints)].join(", ");
  return null;
}

/** Разбивает mint на полное (без скобок) и короткое (только аббревиатуры). */
function splitMint(mint) {
  if (!mint || typeof mint !== "string") return { full: null, short: null };
  const trimmed = mint.trim();
  if (!trimmed) return { full: null, short: null };
  const shortMatches = [...trimmed.matchAll(/\(([А-Яа-я,\sи]+)\)/g)];
  const shortParts = shortMatches.map((m) => m[1].replace(/\s+/g, " ").trim());
  const short = shortParts.length > 0 ? shortParts.join(", ") : null;
  const full = trimmed.replace(/\s*\([А-Яа-я,\sи]+\)/g, "").replace(/\s+/g, " ").trim() || null;
  return { full, short };
}

/** Парсит HTML страницы ЦБ, извлекает пары label -> value из блока commemor-coin_info_characteristics */
function parseCharacteristics(html) {
  const out = {};
  const blockStart = html.indexOf("commemor-coin_info_characteristics");
  if (blockStart === -1) return out;

  const block = html.slice(blockStart, blockStart + 8000);
  const re =
    /characteristic_denomenation[^>]*>([^<]+)<\/div>\s*<div[^>]*characteristic_value[^>]*>([^<]+)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const label = m[1].trim();
    const value = m[2].trim();
    out[label] = value;
  }
  return out;
}

async function fetchPage(catNum) {
  const url = CBR_SHOW_COINS + encodeURIComponent(catNum);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; omonete/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL (ожидается mysql://user:pass@host:port/db)");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  // Проверяем наличие колонок
  const [cols] = await conn.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'coins' AND COLUMN_NAME IN ('quality','diameter_mm','thickness_mm','length_mm','width_mm')`,
    [database]
  );
  const colNames = cols.map((c) => c.COLUMN_NAME);
  const hasCols = colNames.includes("quality") && colNames.includes("diameter_mm") && colNames.includes("thickness_mm");
  const hasLengthWidth = colNames.includes("length_mm") && colNames.includes("width_mm");
  if (!hasCols) {
    console.error(
      "Добавьте колонки в БД: quality, diameter_mm, thickness_mm. Выполните node scripts/ensure-coin-characteristics-columns.js"
    );
    await conn.end();
    process.exit(1);
  }
  if (rectangularOnly && !hasLengthWidth) {
    console.error("Для --rectangular-only нужны колонки length_mm, width_mm. Запустите node scripts/ensure-coin-characteristics-columns.js");
    await conn.end();
    process.exit(1);
  }

  const whereWeight = fillWeightOnly
    ? " AND (weight_g IS NULL OR TRIM(COALESCE(weight_g, '')) = '')"
    : "";
  const whereMint = fillMintOnly
    ? " AND (mint IS NULL OR TRIM(COALESCE(mint, '')) = '' OR mint = '—')"
    : "";
  const whereCatPrefix = catPrefix ? " AND catalog_number LIKE ?" : "";
  let whereRectangular = "";
  let queryParams = catPrefix ? [catPrefix + "%"] : [LIMIT];
  if (rectangularOnly) {
    const rectBases = getRectangularCatalogBases();
    if (rectBases.length === 0) {
      console.error("rectangular-coins.json пуст. Запустите node scripts/export-rectangular-from-xlsx.js");
      await conn.end();
      process.exit(1);
    }
    const conds = rectBases.map(() => "(catalog_number = ? OR catalog_number LIKE ?)");
    whereRectangular = ` AND (${conds.join(" OR ")})`;
    queryParams = rectBases.flatMap((b) => [b, b + "-%"]);
  }
  const limitClause = catPrefix || rectangularOnly ? "" : " LIMIT ?";
  if (!catPrefix && !rectangularOnly) queryParams.push(LIMIT);
  const [rows] = await conn.execute(
    `SELECT id, catalog_number, title FROM coins 
     WHERE (country = 'Россия' OR country IS NULL) AND catalog_number IS NOT NULL AND TRIM(catalog_number) != ''${whereWeight}${whereMint}${whereCatPrefix}${whereRectangular}
     ORDER BY id ASC${limitClause}`,
    queryParams
  );

  console.log(
    catPrefix ? `Режим: только catalog_number LIKE '${catPrefix}%'. ` : "",
    fillWeightOnly ? "Режим: только монеты без веса (weight_g пустой). " : "",
    fillMintOnly ? "Режим: только монеты без mint. " : "",
    "Монет к обработке:",
    rows.length
  );
  let ok = 0;
  let err = 0;

  for (const row of rows) {
    const cat = String(row.catalog_number).trim();
    await delay(DELAY_MS);
    const html = await fetchPage(cat);
    if (!html) {
      console.log("  [skip]", cat, row.title?.slice(0, 40), "— не удалось загрузить");
      err++;
      continue;
    }

    const ch = parseCharacteristics(html);
    const mint = parseMintFromAuthors(html);
    const quality = ch["Качество"] || null;
    const diameterMm = formatSpaceBeforeParen(ch["Диаметр, мм"] || "") || null;
    const lengthMm = formatSpaceBeforeParen(ch["Длина, мм"] || "") || null;
    const widthMm = formatSpaceBeforeParen(ch["Ширина, мм"] || "") || null;
    const thicknessMm = formatSpaceBeforeParen(ch["Толщина, мм"] || "") || null;
    const mintageStr = ch["Тираж, шт."] || ch["Тираж, шт"] || null;
    // Число для сортировки/фильтров; для отображения «до X» сохраняем в mintage_display
    let mintageVal = null;
    if (mintageStr) {
      const numStr = String(mintageStr).replace(/\s/g, "").replace(/\D/g, "");
      const parsed = parseInt(numStr, 10);
      if (!Number.isNaN(parsed)) mintageVal = parsed;
    }
    const mintageDisplay = mintageStr && /до\s/i.test(String(mintageStr).trim()) ? String(mintageStr).trim() : null;

    // Содержание чистого металла (г) — пишем в weight_g; унции пересчитываются при экспорте
    const massStr = (
      ch["Содержание химически чистого металла не менее, г"] ||
      ch["Содержание химически чистого металла не менее, гр."] ||
      ch["Масса металла, гр."] ||
      ch["Масса металла"] ||
      ""
    ).trim();
    let weightG = null;
    if (massStr) {
      const cleaned = massStr.replace(/\s*\([^)]*\).*$/, "").trim(); // «155,50 (±0,85)» -> «155,50»
      const twoWeights = cleaned.match(/^(\d+[,.]\d+)\s*[-—]\s*(\d+[,.]\d+)$/); // «124,40 - 84,60» (золото / серебро)
      if (twoWeights) weightG = twoWeights[1] + " / " + twoWeights[2];
      else if (/^\d+([,.]\d+)?$/.test(cleaned.replace(",", "."))) weightG = cleaned;
    }

    const hasChars = quality || diameterMm || thicknessMm || lengthMm || widthMm || mintageVal !== null || mintageDisplay || weightG;
    const hasMint = !!mint;
    if (rectangularOnly) {
      if (!lengthMm && !widthMm) {
        console.log("  [skip]", cat, "— Длина/Ширина не найдены на ЦБ");
        err++;
        continue;
      }
      try {
        await conn.execute(
          `UPDATE coins SET length_mm = ?, width_mm = ? WHERE id = ?`,
          [lengthMm || null, widthMm || null, row.id]
        );
        ok++;
        console.log("  [ok]", cat, "| Длина:", lengthMm || "—", "| Ширина:", widthMm || "—");
      } catch (e) {
        if (e.code === "ER_BAD_FIELD_ERROR" && /length_mm|width_mm/.test(e.message)) {
          console.error("  [err]", cat, "— колонки length_mm/width_mm отсутствуют. Запустите node scripts/ensure-coin-characteristics-columns.js");
        } else throw e;
        err++;
      }
      continue;
    }
    if (fillMintOnly) {
      if (!mint) {
        console.log("  [skip]", cat, "— mint не найден в блоке Авторы");
        err++;
        continue;
      }
      const { full: mintFull, short: mintShort } = splitMint(mint);
      try {
        await conn.execute(`UPDATE coins SET mint = ?, mint_short = ? WHERE id = ?`, [mintFull, mintShort, row.id]);
      } catch (e) {
        if (e.code === "ER_BAD_FIELD_ERROR" && /mint_short/.test(e.message)) {
          await conn.execute(`UPDATE coins SET mint = ? WHERE id = ?`, [mintFull, row.id]);
        } else throw e;
      }
      ok++;
      console.log("  [ok]", cat, "| Монетный двор:", mintFull, mintShort ? `(${mintShort})` : "");
      continue;
    }
    if (!hasChars && !hasMint) {
      console.log("  [skip]", cat, "— характеристики и mint не найдены в HTML");
      err++;
      continue;
    }

    if (hasChars) {
      const updateMint = mint != null;
      const { full: mintFull, short: mintShort } = updateMint ? splitMint(mint) : { full: null, short: null };
      const setMint = updateMint ? ", mint = ?, mint_short = ?" : "";
      const setLengthWidth = hasLengthWidth ? ", length_mm = ?, width_mm = ?" : "";
      const params = [quality, diameterMm, thicknessMm, mintageVal, mintageDisplay, weightG];
      if (hasLengthWidth) params.push(lengthMm || null, widthMm || null);
      if (updateMint) {
        params.push(mintFull);
        params.push(mintShort);
      }
      params.push(row.id);
      try {
        await conn.execute(
          `UPDATE coins SET quality = ?, diameter_mm = ?, thickness_mm = ?, mintage = ?, mintage_display = ?, weight_g = COALESCE(?, weight_g)${setLengthWidth}${setMint} WHERE id = ?`,
          params
        );
      } catch (e) {
        if (e.code === "ER_BAD_FIELD_ERROR" && /length_mm|width_mm/.test(e.message)) {
          const paramsNoLW = [quality, diameterMm, thicknessMm, mintageVal, mintageDisplay, weightG];
          if (updateMint) paramsNoLW.push(mintFull, mintShort);
          paramsNoLW.push(row.id);
          await conn.execute(
            `UPDATE coins SET quality = ?, diameter_mm = ?, thickness_mm = ?, mintage = ?, mintage_display = ?, weight_g = COALESCE(?, weight_g)${setMint} WHERE id = ?`,
            paramsNoLW
          );
        } else if (e.code === "ER_BAD_FIELD_ERROR" && /mint_short/.test(e.message)) {
          const setMintLegacy = updateMint ? ", mint = ?" : "";
          const paramsLegacy = [quality, diameterMm, thicknessMm, mintageVal, mintageDisplay, weightG];
          if (hasLengthWidth) paramsLegacy.push(lengthMm || null, widthMm || null);
          if (updateMint) paramsLegacy.push(mintFull);
          paramsLegacy.push(row.id);
          await conn.execute(
            `UPDATE coins SET quality = ?, diameter_mm = ?, thickness_mm = ?, mintage = ?, mintage_display = ?, weight_g = COALESCE(?, weight_g)${hasLengthWidth ? ", length_mm = ?, width_mm = ?" : ""}${setMintLegacy} WHERE id = ?`,
            paramsLegacy
          );
        } else if (e.code === "ER_BAD_FIELD_ERROR" && /mint/.test(e.message)) {
          const p = [quality, diameterMm, thicknessMm, mintageVal, mintageDisplay, weightG];
          if (hasLengthWidth) p.push(lengthMm || null, widthMm || null);
          p.push(row.id);
          await conn.execute(
            `UPDATE coins SET quality = ?, diameter_mm = ?, thickness_mm = ?, mintage = ?, mintage_display = ?, weight_g = COALESCE(?, weight_g)${hasLengthWidth ? ", length_mm = ?, width_mm = ?" : ""} WHERE id = ?`,
            p
          );
        } else if (e.code === "ER_BAD_FIELD_ERROR" && /mintage_display/.test(e.message)) {
          await conn.execute(
            `UPDATE coins SET quality = ?, diameter_mm = ?, thickness_mm = ?, mintage = ?, weight_g = COALESCE(?, weight_g)${hasLengthWidth ? ", length_mm = ?, width_mm = ?" : ""} WHERE id = ?`,
            [quality, diameterMm, thicknessMm, mintageVal, weightG, ...(hasLengthWidth ? [lengthMm || null, widthMm || null] : []), row.id]
          );
        } else if (e.code === "ER_BAD_FIELD_ERROR" && /weight_g/.test(e.message)) {
          await conn.execute(
            `UPDATE coins SET quality = ?, diameter_mm = ?, thickness_mm = ?, mintage = ?, mintage_display = ?${hasLengthWidth ? ", length_mm = ?, width_mm = ?" : ""} WHERE id = ?`,
            [quality, diameterMm, thicknessMm, mintageVal, mintageDisplay, ...(hasLengthWidth ? [lengthMm || null, widthMm || null] : []), row.id]
          );
        } else {
          throw e;
        }
      }
    }
    ok++;
    console.log("  [ok]", cat, "| Монетный двор:", mint || "—", "| Качество:", quality || "—", "| Диаметр:", diameterMm || "—", "| Толщина:", thicknessMm || "—", "| Масса:", weightG || "—", "| Тираж:", mintageDisplay || (mintageVal != null ? mintageVal : "—"));
  }

  console.log("Готово. Обновлено:", ok, "Ошибок/пропусков:", err);
  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
