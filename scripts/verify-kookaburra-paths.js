/**
 * Проверка путей картинок у монет Australian Kookaburra:
 * - файл существует на диске;
 * - путь по названию/весу: обвод и реверс соответствуют весу монеты (1oz/10oz/1kg/2oz)
 *   и году; box/cert если указаны — файл есть и логически к этой монете.
 *
 * Запуск: node scripts/verify-kookaburra-paths.js
 */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const PUBLIC = path.join(__dirname, "..", "public");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

/** По weight_oz возвращаем класс веса для сопоставления с путём */
function weightClass(weightOz) {
  if (weightOz == null || weightOz === "") return null;
  const w = parseFloat(String(weightOz).replace(",", "."));
  if (w >= 31 && w <= 33) return "1kg";
  if (w >= 10 && w <= 11) return "10oz";
  if (w >= 2 && w <= 2.5) return "2oz";
  if (w >= 1 && w <= 1.5) return "1oz";
  return null;
}

/** Год из catalog_number (AU-KOOK-1990-1oz → 1990) */
function yearFromCatalog(catalogNumber) {
  const m = (catalogNumber || "").match(/AU-KOOK-(\d{4})/i);
  return m ? m[1] : null;
}

/** Какой класс веса упомянут в пути (из имени файла/папки) */
function weightInPath(imgPath) {
  if (!imgPath) return null;
  const s = path.basename(String(imgPath)).toLowerCase();
  if (s.includes("1kg") || /-1-kilo-/.test(s)) return "1kg";
  if (s.includes("10oz")) return "10oz";
  if (s.includes("2oz")) return "2oz";
  if (s.includes("1oz") || s.includes("1-oz")) return "1oz";
  return null;
}

/** Год (4 цифры) в пути */
function yearInPath(imgPath) {
  if (!imgPath) return null;
  const m = String(imgPath).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, weight_oz, weight_g,
            image_obverse, image_reverse, image_box, image_certificate
     FROM coins
     WHERE series = 'Australian Kookaburra' AND catalog_number LIKE 'AU-KOOK-%'
     ORDER BY catalog_number, id`
  );
  await conn.end();

  const roles = [
    { key: "image_obverse", label: "obv" },
    { key: "image_reverse", label: "rev" },
    { key: "image_box", label: "box" },
    { key: "image_certificate", label: "cert" },
  ];

  const missingFiles = [];
  const weightMismatch = [];
  const yearMismatch = [];
  let okCount = 0;

  for (const r of rows) {
    const cat = r.catalog_number || "";
    const expectedYear = yearFromCatalog(cat);
    const expectedWeight = weightClass(r.weight_oz);
    let rowOk = true;

    for (const { key, label } of roles) {
      const imgPath = r[key];
      if (!imgPath || String(imgPath).trim() === "") continue;

      const relPath = imgPath.replace(/^\//, "");
      const fullPath = path.join(PUBLIC, relPath);
      const exists = fs.existsSync(fullPath);

      if (!exists) {
        missingFiles.push({
          id: r.id,
          catalog: cat,
          title: (r.title || "").slice(0, 50),
          role: label,
          path: imgPath,
        });
        rowOk = false;
        continue;
      }

      // Проверка соответствия весу и году только для obv/rev (основные изображения монеты)
      if (label === "obv" || label === "rev") {
        const pathWeight = weightInPath(imgPath);
        const pathYear = yearInPath(imgPath);
        if (expectedWeight && pathWeight && pathWeight !== expectedWeight) {
          weightMismatch.push({
            id: r.id,
            catalog: cat,
            weight_oz: r.weight_oz,
            expectedWeight,
            pathWeight,
            role: label,
            path: imgPath,
          });
          rowOk = false;
        }
        if (expectedYear && pathYear && pathYear !== expectedYear) {
          yearMismatch.push({
            id: r.id,
            catalog: cat,
            expectedYear,
            pathYear,
            role: label,
            path: imgPath,
          });
          rowOk = false;
        }
      }
      // box/cert: только проверка существования файла (уже сделано выше)
    }

    if (rowOk) okCount++;
  }

  console.log("=== Проверка путей Kookaburra (название и вес) ===\n");
  console.log("Всего монет AU-KOOK:", rows.length);
  console.log("Без замечаний:", okCount);
  console.log("Отсутствующие файлы:", missingFiles.length);
  console.log("Несоответствие веса (obv/rev):", weightMismatch.length);
  console.log("Несоответствие года (obv/rev):", yearMismatch.length);

  if (missingFiles.length) {
    console.log("\n--- Отсутствующие файлы ---");
    missingFiles.forEach((p) => {
      console.log(`  id=${p.id} ${p.catalog} [${p.role}] ${p.path}`);
      console.log(`    ${p.title}`);
    });
  }

  if (weightMismatch.length) {
    console.log("\n--- Несоответствие веса (путь не по весу монеты) ---");
    weightMismatch.forEach((p) => {
      console.log(`  id=${p.id} ${p.catalog} weight_oz=${p.weight_oz} ожидается ${p.expectedWeight}, в пути: ${p.pathWeight} [${p.role}]`);
      console.log(`    ${p.path}`);
    });
  }

  if (yearMismatch.length) {
    console.log("\n--- Несоответствие года ---");
    yearMismatch.forEach((p) => {
      console.log(`  id=${p.id} ${p.catalog} год ${p.expectedYear}, в пути: ${p.pathYear} [${p.role}]`);
      console.log(`    ${p.path}`);
    });
  }

  const totalIssues = missingFiles.length + weightMismatch.length + yearMismatch.length;
  if (totalIssues === 0) {
    console.log("\nОшибок не найдено. Пути соответствуют названию и весу, файлы на месте.");
  } else {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
