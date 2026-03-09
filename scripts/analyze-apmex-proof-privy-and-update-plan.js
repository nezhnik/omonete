/**
 * Анализирует apmex-kookaburra-parsed.json на proof/privy/incuse,
 * обновляет KOOKABURRA_SERIES_PLAN.md — проставляет has_images и image_saved_paths
 * для строк, где картинки есть в APMEX (в т.ч. proof/privy варианты).
 *
 * Запуск: node scripts/analyze-apmex-proof-privy-and-update-plan.js
 *         node scripts/analyze-apmex-proof-privy-and-update-plan.js --dry-run
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const PARSED_PATH = path.join(__dirname, "..", "data", "apmex-kookaburra-parsed.json");
const PLAN_PATH = path.join("/Users/mihail/Desktop/Нумизматика сайт", "Файлы и документы по монетам", "кукабарра", "KOOKABURRA_SERIES_PLAN.md");
const ANALYSIS_PATH = path.join(__dirname, "..", "data", "apmex-proof-privy-analysis.md");

function analyzeApmex(data) {
  const proof = data.filter((e) => /proof/i.test(e.slug || "") || /proof/i.test(e.title || ""));
  const privy = data.filter((e) => /privy/i.test(e.slug || "") || /privy/i.test(e.title || ""));
  const incuse = data.filter((e) => /incuse|incused/i.test(e.slug || "") || /incuse|incused/i.test(e.title || ""));
  const piedfort = data.filter((e) => /piedfort/i.test(e.slug || "") || /piedfort/i.test(e.title || ""));

  const byKey = {};
  for (const e of data) {
    if (!e.obverse || !e.reverse) continue;
    const key = `${e.year}-${e.weight}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({
      ...e,
      isProof: /proof/i.test(e.slug || "") || /proof/i.test(e.title || ""),
      isPrivy: /privy/i.test(e.slug || "") || /privy/i.test(e.title || ""),
    });
  }

  return { proof, privy, incuse, piedfort, byKey };
}

function parsePlanTable(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    if (!line.startsWith("|") || line.startsWith("| year") || line.startsWith("|------")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 14) continue;
    result.push({ line, cells, raw: line });
  }
  return result;
}

function planKey(cells) {
  const year = parseInt(cells[0], 10);
  const type = cells[1];
  const variant = (cells[2] || "").trim().toLowerCase();
  if (!year || !type) return null;
  const w = type.replace("regular-", "").replace("proof-", "").replace("incuse-", "");
  return { year, type, variant, key: `${year}-${w}`, weightKey: w };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(PARSED_PATH)) {
    console.error("Не найден:", PARSED_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(PLAN_PATH)) {
    console.error("Не найден план:", PLAN_PATH);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(PARSED_PATH, "utf8"));
  const { proof, privy, incuse, piedfort, byKey } = analyzeApmex(data);

  let analysis = `# Анализ APMEX Kookaburra: Proof, Privy, Incuse

Обновлено: ${new Date().toISOString().slice(0, 10)}

## Proof (${proof.length})
| Год | Вес | Slug |
|-----|-----|------|
`;
  for (const p of proof) {
    analysis += `| ${p.year} | ${p.weight} | ${(p.slug || "").slice(0, 55)} |\n`;
  }
  analysis += `\n## Privy (${privy.length})\n| Год | Вес | Slug |\n|-----|-----|------|\n`;
  for (const p of privy) {
    analysis += `| ${p.year} | ${p.weight} | ${(p.slug || "").slice(0, 55)} |\n`;
  }
  analysis += `\n## Incuse (${incuse.length})\n`;
  analysis += `\n## Piedfort (${piedfort.length})\n`;

  fs.writeFileSync(ANALYSIS_PATH, analysis, "utf8");
  console.log("Анализ сохранён:", ANALYSIS_PATH);

  const planText = fs.readFileSync(PLAN_PATH, "utf8");
  const rows = parsePlanTable(planText);
  let updated = 0;

  const newLines = planText.split(/\r?\n/).map((line) => {
    if (!line.startsWith("|") || line.startsWith("| year") || line.startsWith("|------")) return line;

    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 14) return line;

    const { year, type, variant, key: pk, weightKey } = planKey(cells);
    if (!year || !weightKey) return line;

    const hasImages = cells[13];
    const imageSaved = cells[12];
    const imageMain = cells[11];

    if (hasImages === "yes" || imageSaved) return line;

    const apmexKey = `${year}-${weightKey}`;
    const apmexEntries = byKey[apmexKey];
    if (!apmexEntries || apmexEntries.length === 0) return line;

    const wantPrivy = variant === "privy";
    const hasPrivy = apmexEntries.some((e) => e.isPrivy);
    const hasRegular = apmexEntries.some((e) => !e.isPrivy);

    let entry;
    if (wantPrivy && hasPrivy) entry = apmexEntries.find((e) => e.isPrivy);
    else if (!wantPrivy && hasRegular) entry = apmexEntries.find((e) => !e.isPrivy);
    else if (!wantPrivy && hasPrivy) entry = apmexEntries.find((e) => e.isPrivy);
    else return line;

    const paths = `${entry.reverse}, ${entry.obverse}`;

    cells[11] = imageMain || entry.slug || "";
    cells[12] = imageSaved || paths;
    cells[13] = "yes";

    updated++;
    if (!dryRun) console.log(`  ✓ ${year} ${type} ${variant || "regular"}`);
    return "| " + cells.join(" | ") + " |";
  });

  if (updated > 0 && !dryRun) {
    fs.writeFileSync(PLAN_PATH, newLines.join("\n"), "utf8");
    console.log("\nОбновлено строк в плане:", updated);
  } else if (dryRun) {
    console.log("\nDry-run: было бы обновлено", updated, "строк");
  }

  console.log("Proof:", proof.length, "| Privy:", privy.length, "| Incuse:", incuse.length);
}

main();
