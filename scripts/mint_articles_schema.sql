-- Таблица статей о монетных дворах (MySQL, Reg.ru).
-- Выполнить в phpMyAdmin: выбрать БД → SQL → вставить и выполнить.

CREATE TABLE IF NOT EXISTS mint_articles (
  slug VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(64) NOT NULL DEFAULT '',
  country VARCHAR(128) DEFAULT NULL,
  logo_url VARCHAR(512) NOT NULL DEFAULT '',
  gallery_images JSON DEFAULT NULL COMMENT 'Массив URL картинок',
  sections JSON NOT NULL COMMENT 'Массив {title, content}',
  facts JSON DEFAULT NULL COMMENT 'Массив строк',
  famous_coins JSON DEFAULT NULL COMMENT 'Массив {category, title, description, year}',
  sources_line VARCHAR(512) DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
