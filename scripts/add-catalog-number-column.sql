-- Каталожный номер ЦБ (например 5109-0128) — по нему можно брать изображения с cbr.ru
ALTER TABLE coins
  ADD COLUMN catalog_number VARCHAR(32) DEFAULT NULL COMMENT 'Каталожный номер (ЦБ)' AFTER image_urls;

-- Индекс для поиска по каталожному номеру (опционально)
-- CREATE INDEX idx_coins_catalog_number ON coins (catalog_number);
