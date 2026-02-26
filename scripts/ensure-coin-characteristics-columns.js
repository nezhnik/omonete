/**
 * Добавляет в таблицу coins колонки quality, diameter_mm, thickness_mm (если их ещё нет).
 * Запуск: node scripts/ensure-coin-characteristics-columns.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  const columns = [
    { name: "quality", def: "VARCHAR(50) DEFAULT NULL COMMENT 'Качество чеканки (АЦ, Пруф)'" },
    { name: "diameter_mm", def: "VARCHAR(50) DEFAULT NULL COMMENT 'Диаметр, мм'" },
    { name: "thickness_mm", def: "VARCHAR(50) DEFAULT NULL COMMENT 'Толщина, мм'" },
    { name: "length_mm", def: "VARCHAR(50) DEFAULT NULL COMMENT 'Длина, мм (для прямоугольных)'" },
    { name: "width_mm", def: "VARCHAR(50) DEFAULT NULL COMMENT 'Ширина, мм (для прямоугольных)'" },
    { name: "mintage_display", def: "VARCHAR(100) DEFAULT NULL COMMENT 'Тираж как на ЦБ: до 1 000 000'" },
    { name: "mint_short", def: "VARCHAR(100) DEFAULT NULL COMMENT 'Короткое наименование МД: ММД, ЛМД'" },
  ];

  for (const col of columns) {
    try {
      await conn.execute(`ALTER TABLE coins ADD COLUMN ${col.name} ${col.def}`);
      console.log("✓ Добавлена колонка", col.name);
    } catch (e) {
      const isDup = e && (e.code === "ER_DUP_FIELD_NAME" || e.code === "ER_DUP_FIELDNAME" || e.errno === 1060);
      if (isDup) {
        console.log("  Колонка", col.name, "уже есть");
      } else {
        throw e;
      }
    }
  }

  await conn.end();
  console.log("Готово.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
