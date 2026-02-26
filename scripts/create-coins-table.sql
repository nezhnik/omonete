-- Таблица монет (данные ЦБ и каталог)
CREATE TABLE IF NOT EXISTS coins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  image_urls JSON DEFAULT NULL COMMENT 'Изображения (массив URL)',
  title VARCHAR(500) NOT NULL COMMENT 'Название монеты',
  series VARCHAR(255) DEFAULT NULL COMMENT 'Серия',
  mint VARCHAR(255) DEFAULT NULL COMMENT 'Монетный двор',
  country VARCHAR(100) DEFAULT NULL COMMENT 'Страна',
  face_value VARCHAR(50) DEFAULT NULL COMMENT 'Номинал',
  metal VARCHAR(100) DEFAULT NULL COMMENT 'Металл',
  metal_fineness VARCHAR(50) DEFAULT NULL COMMENT 'Проба металла',
  mintage INT DEFAULT NULL COMMENT 'Тираж, шт',
  weight_g VARCHAR(50) DEFAULT NULL COMMENT 'Вес, г (число или строка, напр. 31.1 или 33,94 (±0,31))',
  weight_oz VARCHAR(50) DEFAULT NULL COMMENT 'Вес в унциях/кг: 1 унция, 1/2 унции, 1 кг и т.д.',
  release_date DATE DEFAULT NULL COMMENT 'Дата выпуска',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Каталог монет';
