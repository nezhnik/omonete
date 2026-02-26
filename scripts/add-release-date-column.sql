-- Добавить столбец "дата выпуска"
ALTER TABLE coins
  ADD COLUMN release_date DATE DEFAULT NULL COMMENT 'Дата выпуска' AFTER weight_g;
