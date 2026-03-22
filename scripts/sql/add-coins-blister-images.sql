-- MySQL: блистер (две стороны) для иностранных монет.
-- Порядок в экспорте/галерее: reverse/obverse (как в coin-display-config), затем
-- blister_reverse, blister_obverse, далее как раньше — box, certificate.
-- Запуск вручную: mysql ... < scripts/sql/add-coins-blister-images.sql

ALTER TABLE coins
  ADD COLUMN image_blister_reverse VARCHAR(1024) NULL DEFAULT NULL COMMENT 'Реверс в блистере' AFTER image_reverse;

ALTER TABLE coins
  ADD COLUMN image_blister_obverse VARCHAR(1024) NULL DEFAULT NULL COMMENT 'Аверс в блистере' AFTER image_blister_reverse;
