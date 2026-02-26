-- Изображения монет: путь на нашем сайте или полный URL (ЦБ).
-- Свои файлы: относительный путь, напр. /image/coins/5109-0128-obverse.webp
-- (файл лежит в public/image/coins/). Внешние: полный URL (cbr.ru).
-- Если NULL — API подставит URL ЦБ по catalog_number (аверс/реверс).

ALTER TABLE coins
  ADD COLUMN image_obverse VARCHAR(512) DEFAULT NULL COMMENT 'Аверс: путь или URL' AFTER catalog_number,
  ADD COLUMN image_reverse VARCHAR(512) DEFAULT NULL COMMENT 'Реверс: путь или URL' AFTER image_obverse,
  ADD COLUMN image_box VARCHAR(512) DEFAULT NULL COMMENT 'Коробка (путь или URL), показывать если задан' AFTER image_reverse,
  ADD COLUMN image_certificate VARCHAR(512) DEFAULT NULL COMMENT 'Сертификат (путь или URL), показывать если задан' AFTER image_box;
