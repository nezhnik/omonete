-- Серебряным монетам с номиналом 3 рубля проставить вес 1 унция (31.1 г) для фильтра в каталоге.
-- Запуск: выполнить в MySQL или через node scripts/set-weight-3rub-silver.js

UPDATE coins
SET weight_g = '31.1'
WHERE face_value = '3 рубля'
  AND (LOWER(COALESCE(metal, '')) LIKE '%серебро%');
