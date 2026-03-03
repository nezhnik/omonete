-- Добавляет столбец title_en для поиска на английском
-- Запуск: mysql -u user -p database < scripts/add-title-en-column.sql

ALTER TABLE coins
  ADD COLUMN title_en VARCHAR(500) DEFAULT NULL COMMENT 'Название на английском (для поиска, SEO)' AFTER title;
