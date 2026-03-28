/**
 * Приводит data/mennica-*.json в соответствие: поле classified.* должно указывать на URL,
 * в имени файла которого есть ожидаемый токен (obverse/reverse/box/…).
 *
 * - Перепутанные obv/rev (в слоте obverse URL только с «reverse» и наоборот) — swap или переназначение из imageUrls.
 * - Пустые box / certificate / packaging / blister — добор из imageUrls по шаблону имени (как в парсере).
 * - Одинаковый канонический URL у obverse и reverse — только отчёт (нужен refetch PDP или ручная правка).
 *
 * По умолчанию dry-run. Запись: --apply
 *
 *   node scripts/fix-mennica-classified-labels.js
 *   node scripts/fix-mennica-classified-labels.js --apply
 *   node scripts/fix-mennica-classified-labels.js --slug fried-egg-500-cfa-francs
 */
const fs = require("fs");
const path = require("path");
const {
  normalizeMennicaImgCanon,
  urlHasFaceToken,
  isPackagingFilename,
  looksLikeCertificate,
  looksLikeBox,
  looksLikePackaging,
  looksLikeBlister,
} = require("./mennica-image-url-utils.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function isHttp(u) {
  return u && typeof u === "string" && /^https?:\/\//i.test(u.trim());
}

function usedCanons(classified) {
  const set = new Set();
  for (const k of ["obverse", "reverse", "blister_obverse", "blister_reverse", "packaging", "box", "certificate"]) {
    const u = classified[k];
    if (isHttp(u)) set.add(normalizeMennicaImgCanon(u));
  }
  return set;
}

function pickCoinFaceFromGallery(gallery, face, excludeCanons) {
  for (const u of gallery) {
    if (!isHttp(u)) continue;
    const c = normalizeMennicaImgCanon(u);
    if (excludeCanons.has(c)) continue;
    if (isPackagingFilename(u)) continue;
    if (urlHasFaceToken(u, face)) return u;
  }
  return null;
}

function fixBlisterOrder(blisterObv, blisterRev) {
  if (!blisterObv && !blisterRev) return { blister_obverse: null, blister_reverse: null, swapped: false };
  const oIsObv = blisterObv && urlHasFaceToken(blisterObv, "obverse");
  const oIsRev = blisterObv && urlHasFaceToken(blisterObv, "reverse");
  const rIsObv = blisterRev && urlHasFaceToken(blisterRev, "obverse");
  const rIsRev = blisterRev && urlHasFaceToken(blisterRev, "reverse");
  if (blisterObv && blisterRev && oIsRev && !oIsObv && rIsObv && !rIsRev) {
    return { blister_obverse: blisterRev, blister_reverse: blisterObv, swapped: true };
  }
  return { blister_obverse: blisterObv, blister_reverse: blisterRev, swapped: false };
}

function fixOne(raw, slug) {
  const issues = [];
  const changes = [];
  const cl = raw.classified && typeof raw.classified === "object" ? raw.classified : null;
  if (!cl) {
    issues.push("no_classified");
    return { issues, changes, modified: false };
  }

  const gallery = Array.isArray(raw.imageUrls) ? raw.imageUrls.filter(isHttp) : [];
  let modified = false;

  let obv = cl.obverse;
  let rev = cl.reverse;
  const co = obv ? normalizeMennicaImgCanon(obv) : "";
  const cr = rev ? normalizeMennicaImgCanon(rev) : "";

  if (co && cr && co === cr) {
    issues.push("duplicate_obv_rev_url");
  }

  if (isHttp(obv) && isHttp(rev)) {
    const oObv = urlHasFaceToken(obv, "obverse");
    const oRev = urlHasFaceToken(obv, "reverse");
    const rObv = urlHasFaceToken(rev, "obverse");
    const rRev = urlHasFaceToken(rev, "reverse");

    if (oRev && !oObv && rObv && !rRev) {
      cl.obverse = rev;
      cl.reverse = obv;
      changes.push("swap_obv_rev_tokens");
      modified = true;
      obv = cl.obverse;
      rev = cl.reverse;
    } else if (oRev && !oObv && rRev && !rObv && co !== cr) {
      issues.push("mint_names_both_sides_reverse_token_only_order_kept");
    } else if (oRev && !oObv && !rObv) {
      const usedBefore = usedCanons(cl);
      const go = pickCoinFaceFromGallery(gallery, "obverse", usedBefore);
      const gr = pickCoinFaceFromGallery(gallery, "reverse", usedBefore);
      if (go && gr && normalizeMennicaImgCanon(go) !== normalizeMennicaImgCanon(gr)) {
        cl.obverse = go;
        cl.reverse = gr;
        changes.push("reassign_obv_rev_from_gallery");
        modified = true;
        obv = go;
        rev = gr;
      } else if (oRev && !oObv) {
        issues.push("obverse_slot_wrong_token_no_obverse_file_in_gallery");
      }
    } else if (isHttp(rev) && rObv && !rRev && !looksLikeBox(rev) && !looksLikeCertificate(rev)) {
      issues.push("reverse_url_has_obverse_token_only");
    }
  }

  const used = usedCanons(cl);

  function tryFill(field, testFn) {
    if (isHttp(cl[field])) return;
    for (const u of gallery) {
      if (!isHttp(u)) continue;
      const c = normalizeMennicaImgCanon(u);
      if (used.has(c)) continue;
      if (!testFn(u)) continue;
      cl[field] = u;
      used.add(c);
      changes.push(`fill_${field}`);
      modified = true;
      return;
    }
  }

  tryFill("certificate", looksLikeCertificate);
  tryFill("box", looksLikeBox);
  tryFill("packaging", (u) => looksLikePackaging(u) && !looksLikeBox(u));

  const bh = [];
  for (const u of gallery) {
    if (!isHttp(u)) continue;
    const c = normalizeMennicaImgCanon(u);
    if (used.has(c)) continue;
    if (looksLikeBlister(u)) bh.push(u);
  }
  if (bh.length && (!isHttp(cl.blister_reverse) || !isHttp(cl.blister_obverse))) {
    if (!isHttp(cl.blister_reverse)) {
      cl.blister_reverse = bh[0];
      used.add(normalizeMennicaImgCanon(bh[0]));
      changes.push("fill_blister_reverse");
      modified = true;
    }
    if (bh[1] && !isHttp(cl.blister_obverse)) {
      const c1 = normalizeMennicaImgCanon(cl.blister_reverse);
      const second = bh.find((u) => normalizeMennicaImgCanon(u) !== c1);
      if (second) {
        cl.blister_obverse = second;
        used.add(normalizeMennicaImgCanon(second));
        changes.push("fill_blister_obverse");
        modified = true;
      }
    }
  }

  const bfix = fixBlisterOrder(cl.blister_obverse, cl.blister_reverse);
  if (bfix.swapped) {
    cl.blister_obverse = bfix.blister_obverse;
    cl.blister_reverse = bfix.blister_reverse;
    changes.push("swap_blister_tokens");
    modified = true;
  }

  if (!isHttp(cl.packaging) && isHttp(cl.blister_reverse)) {
    cl.packaging = cl.blister_reverse;
    changes.push("packaging_mirror_blister");
    modified = true;
  }

  if (modified && Array.isArray(raw.imageUrls)) {
    const seen = new Set();
    const merged = [];
    for (const u of [...gallery, cl.obverse, cl.reverse, cl.box, cl.certificate, cl.packaging, cl.blister_obverse, cl.blister_reverse]) {
      if (!isHttp(u)) continue;
      const c = normalizeMennicaImgCanon(u);
      if (seen.has(c)) continue;
      seen.add(c);
      merged.push(u);
    }
    raw.imageUrls = merged;
    changes.push("rebuild_imageUrls");
  }

  return { issues, changes, modified, slug };
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const slugArg = argv.find((a) => a.startsWith("--slug="));
  const slugOnly = slugArg ? slugArg.slice("--slug=".length).trim() : null;

  let files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("mennica-") && f.endsWith(".json") && !f.includes("listing-products"));
  if (slugOnly) {
    const want = `mennica-${slugOnly}.json`;
    files = files.filter((f) => f === want);
    if (!files.length) {
      console.error("Нет файла", want);
      process.exit(1);
    }
  }

  let totalMod = 0;
  const report = [];

  for (const f of files.sort()) {
    const slug = f.replace(/^mennica-/, "").replace(/\.json$/, "");
    const fp = path.join(DATA_DIR, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch (e) {
      console.warn("skip broken", f, e.message);
      continue;
    }
    const r = fixOne(raw, slug);
    if (r.issues.length || r.changes.length) {
      report.push({ slug, ...r });
    }
    if (r.modified && apply) {
      fs.writeFileSync(fp, JSON.stringify(raw, null, 2), "utf8");
      totalMod++;
      console.log("записано", f, r.changes.join(", "));
    } else if (r.modified && !apply) {
      console.log("[dry-run]", slug, "изменения:", r.changes.join(", ") || "—", "| проблемы:", r.issues.join(", ") || "—");
    } else if (r.issues.length && !r.modified) {
      const noise = "mint_names_both_sides_reverse_token_only_order_kept";
      const serious = r.issues.filter((i) => i !== noise);
      if (serious.length) console.log("[внимание]", slug, serious.join(", "));
    }
  }

  if (!apply) {
    console.log("\nЭто был dry-run. Для записи JSON: node scripts/fix-mennica-classified-labels.js --apply");
    console.log("Затем: npm run mennica:import:force-images && npm run data:export:incremental");
  } else {
    console.log("\nИсправлено файлов:", totalMod);
    console.log("Далее: npm run mennica:import:force-images && npm run data:export:incremental");
  }

  const dups = report.filter((x) => x.issues.includes("duplicate_obv_rev_url"));
  if (dups.length) {
    console.log("\nДубль URL obv=rev (нужен refetch PDP):", dups.map((x) => x.slug).join(", "));
  }
}

main();
