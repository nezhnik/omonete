/**
 * Проверка data/royal-mint-*.json: металл в source_url vs URL в raw.classified.
 * 1) obv/rev: золотой PDP не должен ссылаться на silver-proof/bullion/piedfort в лице/реверсе (и наоборот).
 * 2) cert/box: для золотого PDP помечаем, если URL сертификата/коробки содержит silver-* (часто ошибка классификатора RM/парсера, не монета).
 *
 *   node scripts/audit-royal-mint-obvrev-metal-mismatch.js
 *   node scripts/audit-royal-mint-obvrev-metal-mismatch.js --json   → data/royal-mint-obvrev-metal-mismatch.json
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_JSON = path.join(DATA_DIR, "royal-mint-obvrev-metal-mismatch.json");
const OUT_MD = path.join(DATA_DIR, "royal-mint-obvrev-metal-mismatch.md");

function listRoyalMintJsonFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter(
      (f) =>
        f.startsWith("royal-mint-") &&
        f.endsWith(".json") &&
        !f.includes("skipped") &&
        !f.includes("verify") &&
        !f.includes("progress") &&
        !f.includes("listing-products") &&
        !f.includes("probe") &&
        f !== "royal-mint-db-issues.json"
    )
    .sort()
    .map((f) => path.join(DATA_DIR, f));
}

/** @param {string} u */
function pdpMetal(u) {
  if (!u || typeof u !== "string") return null;
  const s = u.toLowerCase();
  const sil =
    /silver-proof|silver-bullion|silver-piedfort|silver-proof-piedfort/.test(s) ||
    (/-silver-|\/silver-/i.test(s) && /proof|bullion|piedfort|coin/.test(s));
  const gol =
    /gold-proof|gold-bullion/.test(s) ||
    (/\/sovereign\//i.test(s) && !/silver/i.test(s)) ||
    (/sovereign/i.test(s) && /gold|half-sovereign|double-sovereign|quintuple|five-sovereign/i.test(s) && !/silver/i.test(s));
  if (sil && gol) return null;
  if (sil) return "silver";
  if (gol) return "gold";
  return null;
}

/** @param {string} url */
function imgLooksSilver(url) {
  if (!url) return false;
  return /silver-proof|silver-bullion|silver-piedfort|silver-proof-piedfort/i.test(url);
}

/** @param {string} url */
function imgLooksGold(url) {
  if (!url) return false;
  return /gold-proof|gold-bullion/i.test(url);
}

function main() {
  const wantJson = process.argv.includes("--json");
  const files = listRoyalMintJsonFiles();
  const issues = [];
  const certBoxIssues = [];
  let withClassified = 0;
  let skippedNoClassified = 0;
  let skippedAmbiguousPdp = 0;

  for (const fp of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    const c = raw.coin;
    const cl = raw.raw && raw.raw.classified;
    if (!c?.source_url || !cl) {
      skippedNoClassified++;
      continue;
    }
    withClassified++;
    const metal = pdpMetal(c.source_url);
    if (!metal) {
      skippedAmbiguousPdp++;
      continue;
    }

    const obv = cl.obverse;
    const rev = cl.reverse;
    const problems = [];
    if (metal === "gold") {
      if (imgLooksSilver(obv)) problems.push({ side: "obverse", url: obv });
      if (imgLooksSilver(rev)) problems.push({ side: "reverse", url: rev });
    } else if (metal === "silver") {
      if (imgLooksGold(obv)) problems.push({ side: "obverse", url: obv });
      if (imgLooksGold(rev)) problems.push({ side: "reverse", url: rev });
    }

    if (problems.length > 0) {
      issues.push({
        file: path.basename(fp),
        title: (c.title || "").trim(),
        source_url: c.source_url,
        pdpMetal: metal,
        problems,
      });
    }

    if (metal === "gold") {
      for (const slot of ["certificate", "box"]) {
        const u = cl[slot];
        if (u && imgLooksSilver(u)) {
          certBoxIssues.push({
            file: path.basename(fp),
            title: (c.title || "").trim(),
            source_url: c.source_url,
            slot,
            url: u,
          });
        }
      }
    }
  }

  console.log(
    "Файлов royal-mint-*.json:",
    files.length,
    "| с raw.classified:",
    withClassified,
    "| без classified:",
    skippedNoClassified,
    "| PDP без чёткого gold/silver:",
    skippedAmbiguousPdp
  );
  console.log("Несоответствий obv/rev vs металл PDP:", issues.length);
  for (const it of issues) {
    console.log(" —", it.file);
    for (const p of it.problems) console.log("    ", p.side, p.url.slice(0, 100) + (p.url.length > 100 ? "…" : ""));
  }
  console.log("Золотой PDP, cert/box с silver в URL:", certBoxIssues.length);
  for (const it of certBoxIssues) console.log(" —", it.file, it.slot);

  const md = [
    "# Royal Mint — несоответствие металла (аудит JSON)",
    "",
    `Сгенерировано: ${new Date().toISOString()} (\`node scripts/audit-royal-mint-obvrev-metal-mismatch.js\`)`,
    "",
    `Всего JSON: **${files.length}**, с \`classified\`: **${withClassified}**.`,
    "",
    "## 1. Лицо / реверс (obv, rev) vs металл PDP",
    "",
    issues.length === 0
      ? "Подозрительных пар **нет**: у золотых PDP в URL obv/rev нет `silver-proof|silver-bullion|silver-piedfort` (и симметрично для серебра)."
      : `Найдено **${issues.length}** — см. ниже.`,
    "",
  ];
  if (issues.length > 0) {
    for (const it of issues) {
      md.push(`### ${it.file}`, "", `- **${it.title}**`, `- PDP: ${it.pdpMetal}`, `- ${it.source_url}`, "");
      for (const p of it.problems) md.push(`- **${p.side}**: \`${p.url}\``);
      md.push("");
    }
  }
  md.push("## 2. Сертификат / коробка при золотом PDP", "");
  md.push(
    certBoxIssues.length === 0
      ? "Нет случаев, когда у золотого PDP в `certificate` или `box` в URL фигурирует silver-*."
      : `Найдено **${certBoxIssues.length}** (часто не монета, а чужая упаковка на странице RM):`
  );
  md.push("");
  for (const it of certBoxIssues) {
    md.push(`- **${it.file}** (${it.slot})`, `  - ${it.title}`, `  - \`${it.url}\``, "");
  }
  fs.writeFileSync(OUT_MD, md.join("\n"), "utf8");
  console.log("\nЗаписано:", OUT_MD);
  if (wantJson) {
    fs.writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          counts: {
            files: files.length,
            withClassified,
            skippedNoClassified,
            skippedAmbiguousPdp,
            obvRevIssues: issues.length,
            certBoxSilverOnGoldPdp: certBoxIssues.length,
          },
          obvRevIssues: issues,
          certBoxSilverOnGoldPdp: certBoxIssues,
        },
        null,
        2
      ),
      "utf8"
    );
    console.log("Записано:", OUT_JSON);
  }
}

main();
