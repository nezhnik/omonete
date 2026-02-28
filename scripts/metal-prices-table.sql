-- Таблица учётных цен ЦБ РФ на драгметаллы (руб/г).
-- Один раз в день крон запрашивает ЦБ, вставляет строку, затем выгружает в public/data/metal-prices.json.

CREATE TABLE IF NOT EXISTS metal_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  xau DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'Золото, руб/г',
  xag DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'Серебро, руб/г',
  xpt DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'Платина, руб/г',
  xpd DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'Палладий, руб/г',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_metal_prices_date ON metal_prices (date);
