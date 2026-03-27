/**
 * Вес для PAMP: в названии товара часто указан фактический вес (1 oz, 5g, 1/2 g…),
 * а в поле Weight карточки на сайте иногда ошибочно стоит «1 g» или «1,5 g».
 * Парсинг из названия идёт первым, затем — из объединения характеристик и названия.
 */

const OZ_G = 31.1034768;

function roundTo(value, digits) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function formatOz(ozValue) {
  if (!Number.isFinite(ozValue) || ozValue <= 0) return null;
  return `${roundTo(ozValue, 4)} oz`;
}

/**
 * Явный вес только из названия (без поля Weight).
 */
function parseWeightFromTitle(titleStr) {
  if (!titleStr) return null;
  const t = String(titleStr).replace(/\u00a0/g, " ");

  const fracOz = t.match(/\b(\d+)\s*\/\s*(\d+)\s*oz\b/i);
  if (fracOz) {
    const a = Number(fracOz[1]);
    const b = Number(fracOz[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) {
      const oz = a / b;
      return { weightG: roundTo(oz * OZ_G, 2), weightOz: formatOz(oz) };
    }
  }

  // «2x1oz», «3 x 1oz» — в каталоге вес обычно на одну монету (здесь второе число — унции).
  const multOz = t.match(/\b(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*oz\b/i);
  if (multOz) {
    const perOz = Number(String(multOz[2]).replace(",", "."));
    if (Number.isFinite(perOz) && perOz > 0) {
      return { weightG: roundTo(perOz * OZ_G, 2), weightOz: formatOz(perOz) };
    }
  }

  const decOz = t.match(/\b(\d+(?:[.,]\d+)?)\s*oz\b/i);
  if (decOz) {
    const oz = Number(String(decOz[1]).replace(",", "."));
    if (Number.isFinite(oz) && oz > 0) return { weightG: roundTo(oz * OZ_G, 2), weightOz: formatOz(oz) };
  }

  const fracG = t.match(/\b(\d+)\s*\/\s*(\d+)\s*g\b/i);
  if (fracG) {
    const a = Number(fracG[1]);
    const b = Number(fracG[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) {
      const g = a / b;
      return { weightG: roundTo(g, 2), weightOz: formatOz(g / OZ_G) };
    }
  }

  const decG = t.match(/\b(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (decG) {
    const g = Number(String(decG[1]).replace(",", "."));
    if (Number.isFinite(g) && g > 0) return { weightG: roundTo(g, 2), weightOz: formatOz(g / OZ_G) };
  }

  const kgM = t.match(/\b(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (kgM) {
    const kg = Number(String(kgM[1]).replace(",", "."));
    if (Number.isFinite(kg) && kg > 0) {
      return { weightG: roundTo(kg * 1000, 2), weightOz: formatOz(kg * 32.1507466) };
    }
  }

  return null;
}

function parseNumberLike(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(",", ".").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseFractionLike(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(",", ".").trim();
  const m = s.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

function derivePampWeight(specs, title) {
  const titleStr = String(title || "").trim();
  const fromTitle = parseWeightFromTitle(titleStr);
  if (fromTitle) return fromTitle;

  const wSpec = specs.Weight != null ? String(specs.Weight).trim().replace(",", ".") : "";
  const src = `${wSpec} ${title || ""}`.trim();
  if (!src) return { weightG: null, weightOz: null };
  const lower = src.toLowerCase();
  const n = parseFractionLike(src) ?? parseNumberLike(src);
  if (!Number.isFinite(n) || n <= 0) return { weightG: null, weightOz: null };
  // «1oz» без пробела: между цифрой и «o» нет \b, поэтому нужен паттерн \d…oz
  if (/\d+(?:[.,]\d+)?\s*oz\b|ounce|ounces|унц/i.test(lower)) return { weightG: roundTo(n * OZ_G, 2), weightOz: formatOz(n) };
  if (/\bkg\b|kilo|кил/i.test(lower)) return { weightG: roundTo(n * 1000, 2), weightOz: formatOz(n * 32.1507466) };
  if (/\bg\b|gram|grams|гр|грам/i.test(lower)) return { weightG: roundTo(n, 2), weightOz: formatOz(n / OZ_G) };
  return { weightG: null, weightOz: null };
}

module.exports = { derivePampWeight, parseWeightFromTitle, formatOz, roundTo };
