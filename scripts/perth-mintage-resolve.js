/**
 * Единая логика тиража Perth Mint по полям страницы (Maximum Mintage, Mintage, Issue Limit).
 * Используется в fetch-perth-mint-coin.js и в reapply-perth-mintage-from-json.js.
 */

/** Тираж из строки с несколькими колонками: максимум из чисел в сегментах. Unlimited → только mintage_display. */
function mintageFromJoinedSpec(raw) {
  if (!raw || !String(raw).trim()) return { mintage: null, mintage_display: null };
  const t = String(raw).replace(/\s+/g, " ").trim();
  if (/unlimited/i.test(t)) return { mintage: null, mintage_display: t };
  let best = 0;
  for (const seg of t.split("|")) {
    const p = seg.trim();
    if (!p || /^[\-–—]+$/u.test(p)) continue;
    const n = parseInt(p.replace(/,/g, "").replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > best) best = n;
  }
  if (best > 0) return { mintage: best, mintage_display: null };
  return { mintage: null, mintage_display: t || null };
}

/** В БД только значение ячейки; в UI подпись «Тираж, шт.» добавляется отдельно. */
const MINTAGE_DISPLAY_UNLIMITED_RU = "Неограничен";

function issueLimitToNumber(raw) {
  if (!raw || !String(raw).trim()) return null;
  const t = String(raw).replace(/\s+/g, " ").trim();
  let best = 0;
  for (const seg of t.split("|")) {
    const p = seg.trim();
    if (!p || /^[\-–—]+$/u.test(p)) continue;
    const n = parseInt(p.replace(/,/g, "").replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > best) best = n;
  }
  if (best > 0) return best;
  const n2 = parseInt(t.replace(/,/g, "").replace(/\D/g, ""), 10);
  return Number.isFinite(n2) && n2 > 0 ? n2 : null;
}

function buildGetSpec(specs) {
  return (...keys) => {
    for (const k of keys) {
      const v = specs[k];
      if (v != null && String(v).trim()) return String(v).replace(/\s+/g, " ").trim();
    }
    return "";
  };
}

function resolvePerthMintage(specs) {
  const getSpec = buildGetSpec(specs || {});
  const maxRaw = getSpec("Maximum Mintage", "Maximum mintage");
  const mintageBlockRaw = getSpec("Mintage");
  const issueRaw = getSpec("Issue Limit", "Issue limit");

  const fromMax = mintageFromJoinedSpec(maxRaw);
  if (fromMax.mintage != null && fromMax.mintage > 0) {
    return { mintage: fromMax.mintage, mintage_display: fromMax.mintage_display };
  }

  const issueNum = issueLimitToNumber(issueRaw);
  if (issueNum != null && issueNum > 0) {
    return { mintage: issueNum, mintage_display: null };
  }

  const fromMintageBlock = mintageFromJoinedSpec(mintageBlockRaw);
  if (fromMintageBlock.mintage != null && fromMintageBlock.mintage > 0) {
    return { mintage: fromMintageBlock.mintage, mintage_display: null };
  }

  const unlimited =
    (fromMax.mintage_display && /unlimited/i.test(fromMax.mintage_display)) ||
    (mintageBlockRaw && /unlimited/i.test(mintageBlockRaw)) ||
    (fromMintageBlock.mintage_display && /unlimited/i.test(fromMintageBlock.mintage_display));
  if (unlimited) {
    return { mintage: null, mintage_display: MINTAGE_DISPLAY_UNLIMITED_RU };
  }

  if (fromMax.mintage_display && String(fromMax.mintage_display).trim()) {
    return { mintage: null, mintage_display: String(fromMax.mintage_display).trim() };
  }

  return { mintage: null, mintage_display: MINTAGE_DISPLAY_UNLIMITED_RU };
}

module.exports = {
  mintageFromJoinedSpec,
  issueLimitToNumber,
  resolvePerthMintage,
  buildGetSpec,
  MINTAGE_DISPLAY_UNLIMITED_RU,
};
