/**
 * Собирает из reports/pamp-missing-mintage.json монеты, по которым веб-поиск уже дал тираж(и).
 * Пишет reports/pamp-web-mintage-found.json и .md — удобно проверять прогон (например 22/144).
 *
 *   node scripts/report-pamp-web-mintage-found.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const IN_JSON = path.join(ROOT, "reports", "pamp-missing-mintage.json");
const OUT_JSON = path.join(ROOT, "reports", "pamp-web-mintage-found.json");
const OUT_MD = path.join(ROOT, "reports", "pamp-web-mintage-found.md");

function escapeMdCell(s) {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function rowHasWebMintage(row) {
  const ms = row.mintage_source;
  if (!ms || typeof ms !== "object") return false;
  if (ms.status === "verified" || ms.status === "partial" || ms.status === "conflict") return true;
  if (ms.verified_mintage != null && Number.isFinite(Number(ms.verified_mintage))) return true;
  if (Array.isArray(ms.sources) && ms.sources.length > 0) return true;
  return false;
}

function main() {
  if (!fs.existsSync(IN_JSON)) {
    console.error("Нет файла:", IN_JSON);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(IN_JSON, "utf8"));
  const rows = doc.rows || [];
  const withMs = rows.filter((r) => r.mintage_source);
  const found = rows.filter(rowHasWebMintage);

  const items = found.map((r) => {
    const ms = r.mintage_source;
    const sourceLines = (ms.sources || []).map(
      (s) => `${s.host}: ${s.mintage} — ${(s.url || "").slice(0, 120)}`
    );
    return {
      id: r.id,
      catalog_number: r.catalog_number,
      title: r.title,
      official_pamp_url: r.source_url,
      web_status: ms.status,
      verified_mintage: ms.verified_mintage ?? null,
      agreeing_hosts: ms.agreeing_hosts || [],
      proposed_mintages: [...new Set((ms.sources || []).map((s) => s.mintage).filter((n) => n != null))],
      sources_count: (ms.sources || []).length,
      sources_detail: ms.sources || [],
      researched_at: ms.researched_at,
      method: ms.method,
      query_used: ms.query_used,
      note: ms.note,
    };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    source_report_generatedAt: doc.generatedAt || null,
    cohort_missing_count: rows.length,
    rows_with_any_mintage_source_block: withMs.length,
    found_mintage_count: found.length,
    items,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");

  const md = [
    `# PAMP: веб-поиск — найденные тиражи (из списка без тиража)`,
    ``,
    `- **Сгенерировано:** ${out.generatedAt}`,
    `- **Исходный отчёт:** ${doc.generatedAt || "—"}`,
    `- **Строк в pamp-missing-mintage:** ${rows.length}`,
    `- **С блоком mintage_source:** ${withMs.length}`,
    `- **С найденным тиражом (verified / partial / conflict):** ${found.length}`,
    ``,
    found.length === 0
      ? `_Пока ни у одной строки нет статуса verified / partial / conflict и непустого списка sources. Обновите \`pamp-missing-mintage.json\` после прогона веб-поиска и снова запустите \`npm run pamp:report-web-found\`._`
      : "",
    ``,
    `| id | status | verified | предлож. числа | title |`,
    `| ---: | --- | --- | --- | --- |`,
    ...items.map((it) => {
      const nums = it.proposed_mintages.length ? it.proposed_mintages.join(", ") : "—";
      const ver = it.verified_mintage != null ? String(it.verified_mintage) : "—";
      return `| ${it.id} | ${escapeMdCell(it.web_status)} | ${escapeMdCell(ver)} | ${escapeMdCell(nums)} | ${escapeMdCell(it.title)} |`;
    }),
    ``,
    `## Детали по ссылкам`,
    ``,
    ...items.flatMap((it) => [
      `### id ${it.id} — ${escapeMdCell(it.title)}`,
      ``,
      `- Статус: **${it.web_status}**`,
      `- Подтверждённый тираж: ${it.verified_mintage ?? "—"}`,
      `- Запрос: ${escapeMdCell(it.query_used)}`,
      ``,
      ...((it.sources_detail || []).map(
        (s) =>
          `- **${escapeMdCell(s.host)}** mintage ${s.mintage}: [ссылка](${s.url}) — ${escapeMdCell((s.quoted_text || "").slice(0, 160))}`
      )),
      ``,
    ]),
  ];

  fs.writeFileSync(OUT_MD, md.join("\n"), "utf8");

  console.log(JSON.stringify({ found_mintage_count: found.length, OUT_JSON, OUT_MD }, null, 2));
}

main();
