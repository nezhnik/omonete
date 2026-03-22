/**
 * Монеты Royal Mint с title «404 PAGE NOT FOUND» в data/royal-mint-*.json:
 * разбор причины и подбор рабочего source URL.
 *
 * В JSON обычно есть:
 *   raw.requestedUrl — что передавали в парсер (часто /shop/.../commemorative/...)
 *   raw.pdpUrl / coin.source_url — куда ушли после rewriteShopPdpToInvestBullion (часто bullion → 404)
 *
 * Запуск (из корня omonete-app):
 *   node scripts/royal-mint-404-url-audit.js
 *   node scripts/royal-mint-404-url-audit.js --probe          — HEAD/GET проверка URL (сеть)
 *   node scripts/royal-mint-404-url-audit.js --probe --probe-limit 15   — проверить в сети только первые N строк
 *   node scripts/royal-mint-404-url-audit.js --write-urls-patch  — дописать scripts/royal-mint-urls-404-fixes.txt
 *
 * Результат: data/royal-mint-404-url-audit.tsv (и при --probe колонки со статусами).
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const URL_LIST = path.join(__dirname, "royal-mint-urls.txt");
const OUT_TSV = path.join(DATA_DIR, "royal-mint-404-url-audit.tsv");
const OUT_PATCH = path.join(__dirname, "royal-mint-urls-404-fixes.txt");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function parseArgs() {
  const probe = process.argv.includes("--probe");
  const writePatch = process.argv.includes("--write-urls-patch");
  const pli = process.argv.indexOf("--probe-limit");
  const probeLimit = pli >= 0 && process.argv[pli + 1] ? parseInt(process.argv[pli + 1], 10) : 0;
  return {
    probe,
    writePatch,
    /** Сколько URL реально дернуть в сети (0 = все строки отчёта). */
    probeLimit: Number.isFinite(probeLimit) && probeLimit > 0 ? probeLimit : 0,
  };
}

function normalizeRmUrl(u) {
  if (!u || typeof u !== "string") return "";
  try {
    const x = new URL(u.trim());
    x.hash = "";
    /** Для shop/commemorative query обычно не нужен; для invest listId оставляем только если не 404-аудит fix */
    if (x.pathname.includes("/shop/")) x.search = "";
    return x.toString().replace(/\/$/, "");
  } catch {
    return String(u).trim().split("?")[0].replace(/\/$/, "");
  }
}

function is404Title(t) {
  return /404\s+page\s+not\s+found/i.test(String(t || ""));
}

function classify(requested, pdp) {
  const req = String(requested || "").toLowerCase();
  const pd = String(pdp || "").toLowerCase();
  if (req.includes("/shop/") && pd.includes("/invest/bullion/bullion-coins/")) {
    return "rewrite_shop_to_bullion_likely_wrong";
  }
  if (req.includes("/shop/") && pd.includes("/invest/bullion/")) {
    return "rewrite_shop_to_bullion_likely_wrong";
  }
  if (req === pd || normalizeRmUrl(requested) === normalizeRmUrl(pdp)) {
    return "direct_url_returns_404";
  }
  if (req.includes("/invest/") && !req.includes("/shop/")) {
    return "invest_url_dead_or_moved";
  }
  return "other_mismatch";
}

async function probeOnce(url) {
  if (!url) return { ok: false, status: 0, note: "empty" };
  const tryFetch = async (method) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      });
      clearTimeout(t);
      return res;
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  };

  try {
    let res = await tryFetch("HEAD");
    if (res.status === 405 || res.status === 501) {
      res = await tryFetch("GET");
    }
    const status = res.status;
    const finalUrl = res.url || url;
    /** У RM для страницы «404» часто реальный HTTP 404; если отдадут 200 — возможен soft-404 (смотреть вручную). */
    const ok = status >= 200 && status < 300;
    return { ok, status, finalUrl: finalUrl.slice(0, 120) };
  } catch (e) {
    return { ok: false, status: 0, note: String(e.message || e).slice(0, 80) };
  }
}

function readUrlListSet() {
  if (!fs.existsSync(URL_LIST)) return new Set();
  const text = fs.readFileSync(URL_LIST, "utf8");
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/https?:\/\/[^\s#]+/);
    if (m) set.add(normalizeRmUrl(m[0]));
  }
  return set;
}

function mainSync() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("royal-mint-") && f.endsWith(".json") && !f.includes("skipped") && !f.includes("verify"));

  const rows = [];
  for (const f of files) {
    const fp = path.join(DATA_DIR, f);
    let j;
    try {
      j = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    const title = (j.coin && j.coin.title) || (j.raw && j.raw.title) || "";
    if (!is404Title(title)) continue;

    const requested = (j.raw && j.raw.requestedUrl) || "";
    const pdp = (j.raw && j.raw.pdpUrl) || (j.coin && j.coin.source_url) || "";
    const slug = (j.coin && j.coin.catalog_suffix) || "";
    const cat = classify(requested, pdp);
    const suggested = normalizeRmUrl(requested) || normalizeRmUrl(pdp);

    rows.push({
      file: f,
      slug,
      reason: cat,
      requestedUrl: requested,
      pdpUrl: pdp,
      suggestedTryUrl: suggested,
    });
  }

  return rows;
}

async function main() {
  const { probe, writePatch, probeLimit } = parseArgs();
  let rows = mainSync();
  rows.sort((a, b) => a.file.localeCompare(b.file));

  const listSet = readUrlListSet();

  const header = probe
    ? [
        "file",
        "slug",
        "reason",
        "in_royal_mint_urls_txt",
        "requested_url",
        "pdp_url",
        "suggested_try_url",
        "probe_suggested_status",
        "probe_suggested_ok",
      ].join("\t")
    : [
        "file",
        "slug",
        "reason",
        "in_royal_mint_urls_txt",
        "requested_url",
        "pdp_url",
        "suggested_try_url",
      ].join("\t");

  const lines = [header];

  let probeIdx = 0;
  for (const r of rows) {
    const inList =
      r.requestedUrl && listSet.has(normalizeRmUrl(r.requestedUrl))
        ? "yes"
        : listSet.has(normalizeRmUrl(r.suggestedTryUrl))
          ? "yes_normalized"
          : "no";

    let probeStatus = "";
    let probeOk = "";
    const doProbe =
      probe &&
      r.suggestedTryUrl &&
      (probeLimit === 0 || probeIdx < probeLimit);
    if (doProbe) {
      probeIdx++;
      const p = await probeOnce(r.suggestedTryUrl);
      probeStatus = p.status ? String(p.status) : p.note || "0";
      probeOk = p.ok ? "yes" : "no";
      await new Promise((res) => setTimeout(res, 400));
    } else if (probe) {
      probeStatus = "skipped";
      probeOk = "";
    }

    if (probe) {
      lines.push(
        [
          r.file,
          r.slug,
          r.reason,
          inList,
          r.requestedUrl,
          r.pdpUrl,
          r.suggestedTryUrl,
          probeStatus,
          probeOk,
        ]
          .map((c) => String(c).replace(/\t/g, " ").replace(/\r?\n/g, " "))
          .join("\t")
      );
    } else {
      lines.push(
        [r.file, r.slug, r.reason, inList, r.requestedUrl, r.pdpUrl, r.suggestedTryUrl]
          .map((c) => String(c).replace(/\t/g, " ").replace(/\r?\n/g, " "))
          .join("\t")
      );
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_TSV, lines.join("\n") + "\n", "utf8");
  console.log("Записано:", OUT_TSV);
  console.log("Строк (монет с 404 в title):", rows.length);

  const byReason = {};
  for (const r of rows) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  console.log("По причинам:", byReason);

  if (writePatch) {
    const shopFixes = rows.filter((r) => r.reason === "rewrite_shop_to_bullion_likely_wrong" && r.suggestedTryUrl);
    const uniq = [...new Set(shopFixes.map((r) => r.suggestedTryUrl))];
    const banner = `# Авто: замените в royal-mint-urls.txt строки с invest/bullion/.../SLUG на shop URL ниже (тот же slug).\n# Сгенерировано royal-mint-404-url-audit.js --write-urls-patch\n\n`;
    fs.writeFileSync(OUT_PATCH, banner + uniq.join("\n") + "\n", "utf8");
    console.log("Подсказки для замены URL:", OUT_PATCH, "(" + uniq.length + " уникальных suggestedTryUrl)");
  }

  if (probe) {
    let okCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("\t");
      if (parts[parts.length - 1] === "yes") okCount++;
    }
    console.log("Probe: HTTP 2xx на suggestedTryUrl:", okCount, "/", rows.length, "(soft-404 возможен при 200)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
