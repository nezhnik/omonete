/**
 * Проверка весов всех монет:
 * - согласованность weight_g и weight_oz (через 31.1035 г за унцию);
 * - соответствие веса подсказкам в названии и путях картинок (1oz, 1kg, 10oz, 2oz, 5oz).
 *
 * Результат: CSV-файл `weight-issues.csv` в корне проекта
 * со списком монет, где есть несоответствия, и предложенными исправлениями.
 *
 * Запуск:
 *   node scripts/check-weights-consistency.js
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const OUT_CSV = path.join(__dirname, "..", "weight-issues.csv");
const OZ_IN_GRAM = 31.1035;

const CANONICAL = {
  "1oz": { g: 31.1, oz: 1 },
  "2oz": { g: 62.2, oz: 2 },
  "5oz": { g: 155.5, oz: 5 },
  "10oz": { g: 311, oz: 10 },
  "1kg": { g: 1000, oz: 32.15 },
};

function parseDbNumber(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Для проверки физического соотношения g vs oz*31.1035 мы не хотим
// интерпретировать строки вида "1/4 унции", "1 кг" и т.п. как числа.
// Поэтому дробные и текстовые значения возвращаем как null.
function parseDbOzNumber(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/[\/]/.test(s)) return null;
  if (/[кК]г/.test(s) || /унц/i.test(s)) return null;
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

// Читаем docs/WEIGHT_GUIDE.md и строим карту
//   тип веса ("1/4 унции", "1 кг" и т.п.) → { g, oz, isKg }
function loadWeightGuide() {
  const guidePath = path.join(__dirname, "..", "docs", "WEIGHT_GUIDE.md");
  const map = {};
  try {
    const text = fs.readFileSync(guidePath, "utf8");
    const lines = text.split(/\r?\n/);
    let inTable = false;
    for (const line of lines) {
      if (line.startsWith("## 2.")) {
        inTable = true;
        continue;
      }
      if (!inTable) continue;
      if (!line.startsWith("|")) continue;
      if (line.startsWith("| Тип веса") || line.startsWith("|----------------")) continue;
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.length < 2) continue;
      const type = cells[0];
      const gramsStr = cells[1].replace(",", ".").replace(/\s/g, "");
      const g = parseFloat(gramsStr);
      if (!type || Number.isNaN(g)) continue;
      const isKg = /кг/.test(type.toLowerCase());
      const oz = g / OZ_IN_GRAM;
      map[type] = { g, oz, isKg };
      // Для дробных типов вроде "1/4 унции" добавляем короткий ключ "1/4"
      const fracMatch = type.match(/^(\d+\/\d+)/);
      if (fracMatch) {
        const shortKey = fracMatch[1];
        if (!map[shortKey]) map[shortKey] = { g, oz, isKg };
      }
    }
  } catch {
    // если файла нет или формат изменился — просто не используем карту
  }
  return map;
}

/** Из названия монеты пытаемся вытащить класс веса для ЦЕЛЫХ унций/кг.
 *  Важно: не должны ловить дроби вроде 1/4oz.
 */
function weightClassFromTitle(title) {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/\b1\s*(kilo|kilogram|kilogramme)\b/.test(t) || /\b1\s*кг\b/.test(t) || /\b1\s*килограмм\b/.test(t) || /\b1kg\b/.test(t)) {
    return "1kg";
  }
  // целые унции: следим, чтобы перед числом не было дроби вида "1/"
  if (/(?<!\/)\b10\s*oz\b/.test(t) || /(?<!\/)\b10\s*унц/.test(t)) return "10oz";
  if (/(?<!\/)\b5\s*oz\b/.test(t) || /(?<!\/)\b5\s*унц/.test(t)) return "5oz";
  if (/(?<!\/)\b2\s*oz\b/.test(t) || /(?<!\/)\b2\s*унц/.test(t)) return "2oz";
  // Для 1 oz требуем пробел или начало строки перед "1", чтобы не ловить "1/4oz"
  if (/(^|\s)1\s*oz\b/.test(t) || /\b1\s*унц/.test(t)) return "1oz";
  return null;
}

/** Из имени файла картинки (obv/rev) вытаскиваем класс веса.
 *  Чтобы не ловить ложные срабатывания (как 2oz внутри "1-2oz"),
 *  используем только очевидный признак 1kg. Остальное определяем по названию.
 */
function weightClassFromImage(imgPath) {
  if (!imgPath) return null;
  const s = path.basename(String(imgPath)).toLowerCase();
  if (s.includes("1kg") || s.includes("1-kilo") || s.includes("1-kilogram")) return "1kg";
  return null;
}

/** Берём наиболее надёжную подсказку веса:
 *  - в первую очередь из НАЗВАНИЯ монеты (там чаще всего написано 1oz / 2oz / 5oz / 10oz / 1kg);
 *  - если в названии класс не определён, пробуем по имени файла.
 */
function inferWeightClass(row) {
  const fromTitle = weightClassFromTitle(row.title || "");
  if (fromTitle) return fromTitle;

  const fromObv = weightClassFromImage(row.image_obverse);
  const fromRev = weightClassFromImage(row.image_reverse);
  const set = new Set([fromObv, fromRev].filter(Boolean));
  if (set.size === 1) return [...set][0];
  // если несколько разных подсказок или ни одной — считаем, что класса нет
  return null;
}

// Пытаемся вытащить дробный вес (1/2, 1/4, 1/10 и т.п.) из названия монеты
// и сопоставить его с записью в WEIGHT_GUIDE.md (ключи "1/2", "1/4" и т.д.).
function guideFromTitleFraction(title, weightGuide) {
  if (!title) return null;
  const t = String(title);
  const m = t.match(/(\d+\/\d+)\s*(oz|унц)/i);
  if (!m) return null;
  const frac = m[1]; // например "1/2"
  return weightGuide[frac] || null;
}

function parseFractionOz(rawOz) {
  if (!rawOz) return null;
  const m = String(rawOz).match(/(\d+)\/(\d+)/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const den = parseFloat(m[2]);
  if (!den || Number.isNaN(num) || Number.isNaN(den)) return null;
  return num / den;
}

/** Проверяем согласованность weight_g и weight_oz как физических единиц */
function checkRelation(wg, wo) {
  if (wg == null || wo == null) return { ok: true, diff: null };
  const expectedG = wo * OZ_IN_GRAM;
  const diff = Math.abs(wg - expectedG);
  // допуск 0.6 г: округления до 31.1, 62.2 и т.п.
  return { ok: diff <= 0.6, diff: Number(diff.toFixed(3)) };
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, country, series, metal, weight_g, weight_oz,
            image_obverse, image_reverse
     FROM coins
     WHERE country IS NOT NULL AND TRIM(country) <> '' AND country NOT LIKE 'Россия%'
     ORDER BY id`
  );
  await conn.end();

  const weightGuide = loadWeightGuide();
  const issues = [];

  for (const r of rows) {
    const rawG = r.weight_g != null ? String(r.weight_g).trim() : "";
    const wg = parseDbNumber(rawG);
    const rawOz = r.weight_oz != null ? String(r.weight_oz).trim() : "";
    const wo = parseDbOzNumber(rawOz);
    const relation = checkRelation(wg, wo);
    const hintClassFromTitle = inferWeightClass(r);
    const fromTitleCanonical = hintClassFromTitle ? CANONICAL[hintClassFromTitle] : null;
    const guideEntry =
      (rawOz && weightGuide[rawOz] ? weightGuide[rawOz] : null) ||
      guideFromTitleFraction(r.title || "", weightGuide);
    const fromGuideCanonical = guideEntry && !guideEntry.isKg ? { g: guideEntry.g, oz: guideEntry.oz } : null;
    const canonical = fromTitleCanonical || fromGuideCanonical;
    const canonicalLabel = fromTitleCanonical ? hintClassFromTitle : guideEntry && !guideEntry.isKg ? rawOz : "";

    let mismatch = false;
    let reason = [];

    if (!relation.ok) {
      mismatch = true;
      reason.push(`несоответствие g/oz (|g - oz*31.1035| = ${relation.diff})`);
    }

    if (canonical) {
      if (wg != null && Math.abs(wg - canonical.g) > 0.6) {
        mismatch = true;
        reason.push(`weight_g не совпадает с ${canonicalLabel || "эталонным весом"}`);
      }
      if (wo != null && Math.abs(wo - canonical.oz) > 0.06) {
        mismatch = true;
        reason.push(`weight_oz не совпадает с ${canonicalLabel || "эталонным весом"}`);
      }
    }

    // Дополнительная проверка по WEIGHT_GUIDE.md:
    // если там есть запись под таким weight_oz (включая дроби и "1 кг"),
    // сверяем только граммы с эталоном.
    if (guideEntry && wg != null) {
      const tol = guideEntry.isKg ? 5 : 0.3;
      if (Math.abs(wg - guideEntry.g) > tol) {
        mismatch = true;
        reason.push(`weight_g не совпадает с эталоном из WEIGHT_GUIDE.md (${guideEntry.g} г)`);
      }
    }

    if (!mismatch) continue;

    const recG =
      canonical && canonical.g != null
        ? canonical.g
        : guideEntry && guideEntry.g != null
        ? guideEntry.g
        : wg;
    let recOz;
    // Для дробных записей ("1/2", "1/10" и т.п.) оз оставляем строкой как есть,
    // чтобы в характеристиках не превращать 1/4 в 0.25 и т.д.
    const hasFractionOz = /\/\d+/.test(rawOz);
    if (hasFractionOz) {
      recOz = "";
    } else {
      recOz =
        canonical && canonical.oz != null
          ? canonical.oz
          : wo != null && wg == null
          ? Number((wg / OZ_IN_GRAM).toFixed(3))
          : wo;
    }

    // для группировки по текущему весу в унциях:
    const fracOz = parseFractionOz(rawOz);
    const currentOzForSort = wo != null ? wo : fracOz;

    issues.push({
      id: r.id,
      catalog_number: r.catalog_number || "",
      country: r.country || "",
      series: r.series || "",
      title: (r.title || "").replace(/"/g, '""'),
      raw_weight_g: rawG,
      raw_weight_oz: rawOz,
      weight_g: wg != null ? wg : null,
      weight_oz: wo != null ? wo : null,
      oz_sort: currentOzForSort,
      hint_class: hintClassFromTitle || "",
      recommended_g: recG != null ? recG : "",
      recommended_oz: recOz != null ? recOz : "",
      reason: reason.join("; ") || (canonical ? "заполнить вес по подсказке" : "проверить вручную"),
    });
  }

  // Сортировка по текущему весу в унциях (чтобы группы 0.1/0.25/0.5/1/2/5 и т.д. шли блоками)
  issues.sort((a, b) => {
    const ao = a.oz_sort != null ? a.oz_sort : -1;
    const bo = b.oz_sort != null ? b.oz_sort : -1;
    if (ao !== bo) return ao - bo;
    return a.id - b.id;
  });

  // Упрощённый CSV: ссылка, название, вес в граммах и унциях с подсказкой исправления.
  // weight_g: "<current>g" или "<current>g → <recommended>g"
  // weight_oz: "<current>oz" или "<current>oz → <recommended>oz"
  const header = ["url", "title", "weight_g", "weight_oz"].join(";");

  function fmtNumber(n) {
    if (n == null || n === "") return "";
    const num = typeof n === "number" ? n : parseFloat(String(n).replace(",", "."));
    if (!Number.isFinite(num)) return String(n);
    const rounded = Math.round(num * 1000) / 1000;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.?0+$/, "");
  }

  function formatG(currentRaw, recommended) {
    const curr = (currentRaw || "").trim();
    const recStr = recommended !== "" && recommended != null ? fmtNumber(recommended) + "g" : "";
    if (!recStr) {
      return curr ? curr + "g" : "";
    }
    if (!curr) {
      return "→ " + recStr;
    }
    const currNum = parseDbNumber(curr);
    const recNum = typeof recommended === "number" ? recommended : parseDbNumber(recommended);
    if (currNum != null && recNum != null && Math.abs(currNum - recNum) < 0.01) {
      return curr + "g";
    }
    return curr + "g → " + recStr;
  }

  const lines = [header];
  let lastGroup = null;
  for (const it of issues) {
    const ozForGroup = it.oz_sort != null ? it.oz_sort : null;
    let groupLabel;
    if (ozForGroup == null) {
      groupLabel = "other";
    } else {
      groupLabel = fmtNumber(ozForGroup) + "oz";
    }
    if (groupLabel !== lastGroup) {
      if (lastGroup !== null) {
        lines.push(""); // пустая строка между группами
      }
      lines.push(`"${groupLabel}";"";"";""`);
      lastGroup = groupLabel;
    }
    const currOzRaw = (it.raw_weight_oz || "").trim();
    let ozCell = "";
    if (/\/\d+/.test(currOzRaw)) {
      // дробные унции — оставляем как есть, без "→ 0.25oz"
      ozCell = currOzRaw + "oz";
    } else {
      const recOzStr = it.recommended_oz !== "" && it.recommended_oz != null ? fmtNumber(it.recommended_oz) + "oz" : "";
      if (!recOzStr) {
        ozCell = currOzRaw ? currOzRaw + "oz" : "";
      } else if (!currOzRaw) {
        ozCell = "→ " + recOzStr;
      } else {
        const currNum = parseDbNumber(currOzRaw);
        const recNum = typeof it.recommended_oz === "number" ? it.recommended_oz : parseDbNumber(it.recommended_oz);
        if (currNum != null && recNum != null && Math.abs(currNum - recNum) < 0.01) {
          ozCell = currOzRaw + "oz";
        } else {
          ozCell = currOzRaw + "oz → " + recOzStr;
        }
      }
    }

    const row = [
      `"https://omonete.ru/coins/${it.id}/"`,
      `"${it.title}"`,
      `"${formatG(it.raw_weight_g, it.recommended_g)}"`,
      `"${ozCell}"`,
    ].join(";");
    lines.push(row);
  }

  fs.writeFileSync(OUT_CSV, lines.join("\n"), "utf8");
  console.log("Всего монет:", rows.length);
  console.log("Проблемных монет:", issues.length);
  console.log("Файл с отчётом:", OUT_CSV);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

