-- Характеристики с сайта ЦБ (блок commemor-coin_info_characteristics):
-- Качество чеканки (АЦ, Пруф и т.д.), диаметр, толщина.
-- Опционально: масса общая (если нужна отдельно от weight_g — содержание чистого металла).

ALTER TABLE coins
  ADD COLUMN quality VARCHAR(50) DEFAULT NULL COMMENT 'Качество чеканки (АЦ, Пруф и т.д.)' AFTER metal_fineness,
  ADD COLUMN diameter_mm VARCHAR(50) DEFAULT NULL COMMENT 'Диаметр, мм (с допуском, напр. 22,60 (±0,15))' AFTER weight_oz,
  ADD COLUMN thickness_mm VARCHAR(50) DEFAULT NULL COMMENT 'Толщина, мм (с допуском)' AFTER diameter_mm;
