-- Увеличить длину catalog_number с 32 до 64 символов (Perth и др. могут быть длиннее)
-- Пример: AU-PERTH-2026-26022DPAD = 23 символа; запас для будущих длинных кодов.
ALTER TABLE coins
  MODIFY COLUMN catalog_number VARCHAR(64) DEFAULT NULL COMMENT 'Каталожный номер (ЦБ, Perth и др.)';
