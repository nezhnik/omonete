-- Справочник монетных дворов: логотип и данные для главной/фильтров
CREATE TABLE IF NOT EXISTS mints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL COMMENT 'Каноническое название (совпадает с coins.mint)',
  slug VARCHAR(64) NOT NULL COMMENT 'URL-идентификатор: spmd, mmd, lmd',
  logo_url VARCHAR(512) DEFAULT NULL COMMENT 'Путь к логотипу: /image/Mints/spmd.png',
  country VARCHAR(100) DEFAULT NULL COMMENT 'Страна',
  UNIQUE KEY uq_mints_name (name),
  UNIQUE KEY uq_mints_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Монетные дворы: логотипы и данные для отображения';
