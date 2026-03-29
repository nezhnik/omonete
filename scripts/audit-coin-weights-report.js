/**
 * Аудит веса монет по public/data/coins/*.json → reports/coin-weight-audit.csv
 * Группы дворов в одном файле: перед каждой группой строка-разделитель (issue_type=SECTION).
 * Без правок БД. UTF-8 + BOM для Excel.
 *
 * Типы issue_type (кратко):
 *   weightG_не_совпадает_с_граммами_в_weightLabel — число weightG vs «X,X грамм» в подписи
 *   weightLabel_противоречие_доля_oz_и_граммы — в одной подписи доля унции и граммы не бьются с 31,1034768
 *   weightG_не_совпадает_с_weightOz_тройская_унция — в полях есть латинское «… oz»
 *   title_1oz_vs_weightG / title_Noz_vs_weightG — название vs weightG
 *   подозрение_31_2г_вместо_31_1_для_1oz
 *   weightG_слишком_мало_при_1_унция_в_подписи — типично чужая подпись «1 унция»
 *
 *   node scripts/audit-coin-weights-report.js
 *   NEXT_PUBLIC_SITE_URL=https://example.com node scripts/audit-coin-weights-report.js
 */
const fs = require("fs");
const path = require("path");

const TROY_OZ_G = 31.1034768;
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  "https://omonete.ru"
).replace(/\/+$/, "");

const COINS_DIR = path.join(__dirname, "..", "public", "data", "coins");
const OUT_DIR = path.join(__dirname, "..", "reports");
const OUT_CSV = path.join(OUT_DIR, "coin-weight-audit.csv"); // UTF-8, запятая, поля в кавычках при необходимости
const LEGACY_BY_MINT_DIR = path.join(OUT_DIR, "coin-weight-audit-by-mint");

function coinUrl(id) {
  return `${SITE_URL}/coins/${id}/`;
}

function parseNum(s) {
  if (s == null || s === "") return NaN;
  const t = String(s).trim().replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Граммы из подписи «… · 31,1 грамм» */
function parseGramsFromLabel(label) {
  if (!label || typeof label !== "string") return null;
  const m = label.match(/(\d+[.,]\d+)\s*грамм/i);
  if (m) return parseFloat(m[1].replace(",", "."));
  const m2 = label.match(/(\d+)\s*грамм/i);
  if (m2) return parseFloat(m2[1]);
  return null;
}

/** Доля тройской унции из подписи (1, 0.5, 0.25, …) */
function parseTroyFractionFromLabel(label) {
  if (!label || typeof label !== "string") return null;
  const s = label.toLowerCase();
  if (/\b1\/10\s+унц/i.test(s)) return 0.1;
  if (/\b1\/8\s+унц/i.test(s)) return 0.125;
  if (/\b1\/4\s+унц/i.test(s)) return 0.25;
  if (/\b1\/2\s+унц/i.test(s)) return 0.5;
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*унц/i);
  if (m) return parseFloat(m[1].replace(",", "."));
  const m2 = s.match(/·\s*(\d+(?:[.,]\d+)?)\s*унц/i);
  if (m2) return parseFloat(m2[1].replace(",", "."));
  return null;
}

/** Примерный разбор weightOz / weightOzDisplay (только если явно «oz» — тройская маркетинговая унция) */
function parseOzFromCoin(c) {
  const raw = c.weightOz ?? c.weightOzDisplay ?? "";
  const s = String(raw).toLowerCase().trim();
  if (!s || !/\boz\b/i.test(s)) return null;
  if (/\b1\/10\b/.test(s) || /\b0\.1\b/.test(s)) return 0.1;
  if (/\b1\/8\b/.test(s)) return 0.125;
  if (/\b1\/4\b/.test(s)) return 0.25;
  if (/\b1\/2\b/.test(s) || /\b0\.5\b/.test(s)) return 0.5;
  // «1/31.1 oz», «1/100 oz» — доля унции; иначе общий regex схватит «31.1 oz» / «100 oz»
  const mOneSlash = s.match(/\b1\s*\/\s*(\d+(?:[.,]\d+)?)\s*oz\b/i);
  if (mOneSlash) {
    const denom = parseFloat(mOneSlash[1].replace(",", "."));
    if (Number.isFinite(denom) && denom > 0) return 1 / denom;
  }
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*oz/);
  if (m) return parseFloat(m[1].replace(",", "."));
  if (s === "1" && /oz/i.test(String(c.weightOzDisplay || ""))) return 1;
  return null;
}

function roundG(g, dec = 2) {
  const p = 10 ** dec;
  return Math.round(g * p) / p;
}

function suggestGramsFromTroyFraction(frac) {
  return roundG(frac * TROY_OZ_G, 2);
}

function csvEscape(cell) {
  const s = String(cell ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cols) {
  return cols.map(csvEscape).join(",") + "\n";
}

function groupBannerTitle(mintName, mintShort, mintCountry) {
  if (mintShort) return `━━ ${mintName} (${mintShort}) · ${mintCountry} ━━`;
  return `━━ ${mintName} · ${mintCountry} ━━`;
}

function main() {
  const files = fs.readdirSync(COINS_DIR).filter((f) => f.endsWith(".json"));
  const header = [
    "id",
    "url",
    "title",
    "mint_name",
    "mint_short",
    "mint_country",
    "issue_type",
    "current_weightG",
    "current_weightOz",
    "current_weightLabel",
    "suggested_weightG",
    "suggested_weightOz_display",
    "notes",
  ];

  /** @type {{ cols: string[], mintName: string, mintShort: string, mintCountry: string, id: string }[]} */
  const records = [];
  const seen = new Set();

  for (const f of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(COINS_DIR, f), "utf8"));
    } catch {
      continue;
    }
    const c = j.coin;
    if (!c || c.id == null) continue;
    const id = String(c.id).trim();
    const title = (c.title || "").replace(/\s+/g, " ").trim();
    const country = (c.mintCountry || "").trim();
    const mintName = (c.mintName || "").replace(/\s+/g, " ").trim() || "—";
    const mintShort = (c.mintShort || "").replace(/\s+/g, " ").trim();
    const wg = parseNum(c.weightG);
    const label = (c.weightLabel || "").trim();
    const woz = c.weightOz != null ? String(c.weightOz).trim() : "";
    const wozDisp = c.weightOzDisplay != null ? String(c.weightOzDisplay).trim() : "";
    const labelG = parseGramsFromLabel(label);
    const labelFrac = parseTroyFractionFromLabel(label);
    const ozFromCoin = parseOzFromCoin(c);

    const push = (issueType, suggestedG, suggestedOzDisp, notes) => {
      const k = `${id}|${issueType}|${suggestedG}|${notes.slice(0, 40)}`;
      if (seen.has(k)) return;
      seen.add(k);
      records.push({
        mintName,
        mintShort,
        mintCountry: country,
        id,
        cols: [
          id,
          coinUrl(id),
          title,
          mintName,
          mintShort,
          country,
          issueType,
          Number.isFinite(wg) ? String(wg) : "",
          woz || wozDisp || "",
          label,
          suggestedG != null && Number.isFinite(suggestedG) ? String(suggestedG) : "",
          suggestedOzDisp || "",
          notes,
        ],
      });
    };

    // 1) weightG vs граммы в weightLabel
    if (labelG != null && Number.isFinite(wg) && Math.abs(labelG - wg) > 0.12) {
      push(
        "weightG_не_совпадает_с_граммами_в_weightLabel",
        labelG,
        labelFrac != null ? `${labelFrac} oz (из подписи)` : "",
        `В подписи ${labelG} г, в weightG ${wg}. Предложение: выровнять weightG под подпись (или исправить подпись под фактический вес монеты).`
      );
    }

    // 2) Внутренняя согласованность подписи: доля унции vs граммы в той же строке
    if (labelFrac != null && labelG != null) {
      const expectedG = suggestGramsFromTroyFraction(labelFrac);
      if (Math.abs(labelG - expectedG) > 0.25) {
        push(
          "weightLabel_противоречие_доля_oz_и_граммы",
          expectedG,
        String(labelFrac),
          `Для ${labelFrac} тр. унции ожидается ~${expectedG} г (31,1034768×доля), в подписи указано ${labelG} г. Проверить подпись или источник.`
        );
      }
    }

    // 3) weightOz / display vs weightG (тройская унция)
    if (ozFromCoin != null && Number.isFinite(wg)) {
      const exp = suggestGramsFromTroyFraction(ozFromCoin);
      if (Math.abs(wg - exp) > 0.2 && wg < 500) {
        push(
          "weightG_не_совпадает_с_weightOz_тройская_унция",
          exp,
          String(ozFromCoin),
          `По weightOz≈${ozFromCoin} oz ожидается ~${exp} г (тройская), сейчас weightG=${wg}.`
        );
      }
    }

    // 4) Заголовок «1 oz» (и варианты) при драгметалле — вес не около 31,1 г
    const titleLower = `${title} ${c.seriesName || ""}`.toLowerCase();
    const ozTitle =
      /\b1\s*oz\b/i.test(titleLower) ||
      /\b1oz\b/i.test(titleLower) ||
      /\bone ounce\b/i.test(titleLower);
    const precious =
      /золото|серебро|платин|паллад|gold|silver|platinum|palladium/i.test(c.metal || "") ||
      /\b(au|ag|pt|pd)\b/i.test((c.metalCodes || []).join(" "));
    if (ozTitle && precious && Number.isFinite(wg) && wg < 80) {
      if (!/\bset\b|two-coin|three|four|кг|\bkg\b|kilo|tube|pack of|collection of \d+/i.test(titleLower)) {
        const exp = suggestGramsFromTroyFraction(1);
        if (Math.abs(wg - exp) > 0.25) {
          push(
            "title_1oz_vs_weightG",
            exp,
            "1",
            `В названии полная унция, вес ${wg} г сильно отличается от тройской 1 oz (~${exp} г). Возможно, ошибка в title (часто 1/10 или 1/2 oz) или в weightG.`
          );
        }
      }
    }

    // 5) Целое «N oz» в title (N=2…10) vs вес — не путать с «1/10 oz» (после /), «1.5 oz» (не брать 5 из десятичной)
    const mOz = titleLower.match(/(?:^|[^\d/.])(\d+)\s*oz\b/i);
    if (mOz && precious && Number.isFinite(wg)) {
      const n = parseInt(mOz[1], 10);
      if (n >= 2 && n <= 10 && !/set|collection/i.test(titleLower)) {
        const exp = suggestGramsFromTroyFraction(n);
        if (Math.abs(wg - exp) > 0.35 * n) {
          push(
            "title_Noz_vs_weightG",
            exp,
            String(n),
            `В названии ~${n} oz, ожидается ~${exp} г, weightG=${wg}. Проверить набор/одна монета.`
          );
        }
      }
    }

    // 6) Подозрительное округление 31.2 при эталоне 1 oz в подписи или title
    if (Number.isFinite(wg) && Math.abs(wg - 31.2) < 0.05) {
      const mentionsOz =
        ozTitle ||
        /унци|troy|тройск/i.test(label + title) ||
        /31[,.]1/.test(label);
      if (mentionsOz && wg > 31.15) {
        push(
          "подозрение_31_2г_вместо_31_1_для_1oz",
          suggestGramsFromTroyFraction(1),
          "1",
          `Частая опечатка: 31.2 г вместо ~31.1 г для 1 тр. унции. Уточнить по каталогу монетного двора.`
        );
      }
    }

    // 7) Очень малый weightG при наличии драгметалла и номинала «унция» в подписи
    if (labelFrac === 1 && labelG != null && Number.isFinite(wg) && wg < 20) {
      push(
        "weightG_слишком_мало_при_1_унция_в_подписи",
        labelG,
        "1",
        `Подпись про 1 унцию (${labelG} г), а weightG=${wg}. Вероятно подтянута чужая подпись (часто соверен).`
      );
    }
  }

  records.sort((a, b) => {
    const m = a.mintName.localeCompare(b.mintName, "ru");
    if (m !== 0) return m;
    const c = a.mintCountry.localeCompare(b.mintCountry, "ru");
    if (c !== 0) return c;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });

  const lines = [row(header)];
  let prevGroupKey = null;
  for (const r of records) {
    const gk = `${r.mintName}\u0000${r.mintCountry}`;
    if (gk !== prevGroupKey) {
      prevGroupKey = gk;
      lines.push(
        row([
          "",
          "",
          groupBannerTitle(r.mintName, r.mintShort, r.mintCountry),
          r.mintName,
          r.mintShort,
          r.mintCountry,
          "SECTION",
          "",
          "",
          "",
          "",
          "",
          "",
        ])
      );
    }
    lines.push(row(r.cols));
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(LEGACY_BY_MINT_DIR)) {
    fs.rmSync(LEGACY_BY_MINT_DIR, { recursive: true });
  }
  const bom = "\ufeff";
  fs.writeFileSync(OUT_CSV, bom + lines.join(""), "utf8");
  console.log("Строк с замечаниями (без заголовка и без SECTION):", records.length);
  console.log("Файл:", OUT_CSV);
}

main();
