-- Таблица учётных цен ЦБ РФ на драгметаллы (руб/г) и медь (руб/г, из LME + курс ЦБ).
-- Крон запрашивает ЦБ, пишет в metal_prices, подтягивает курсы в cbr_rates, выгружает в metal-prices.json.

CREATE TABLE IF NOT EXISTS metal_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  xau DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'Золото, руб/г',
  xag DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'Серебро, руб/г',
  xpt DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'Платина, руб/г',
  xpd DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'Палладий, руб/г',
  xcu DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'Медь, руб/г (LME USD/т × курс ЦБ)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_metal_prices_date ON metal_prices (date);

-- Курсы ЦБ (USD/RUB) — свои данные для расчёта меди и др. Заполняется backfill-cbr-rates.js и кроном.
CREATE TABLE IF NOT EXISTS cbr_rates (
  date DATE NOT NULL PRIMARY KEY,
  usd_rub DECIMAL(12,4) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
