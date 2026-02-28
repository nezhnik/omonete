/**
 * Удаляет out/data/metal-prices.json после билда, чтобы при заливке out на Reg.ru
 * не перезатирать файл, который обновляет крон на сервере.
 * Запуск: node scripts/clean-metal-prices-from-out.js
 */
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "out", "data", "metal-prices.json");

try {
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    console.log("✂ Удалён из out:", target);
  } else {
    console.log("Файл уже отсутствует в out:", target);
  }
} catch (err) {
  console.error("Не удалось удалить metal-prices.json из out:", err.message);
  process.exit(1);
}

