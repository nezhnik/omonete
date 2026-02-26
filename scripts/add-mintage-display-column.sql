-- Тиражи с ЦБ иногда указаны как «до X» — храним исходную строку для отображения.
ALTER TABLE coins
  ADD COLUMN mintage_display VARCHAR(100) DEFAULT NULL COMMENT 'Тираж как на ЦБ: «до 1 000 000» или NULL' AFTER mintage;
