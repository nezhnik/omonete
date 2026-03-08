-- Ссылка на страницу-источник (Perth Mint и др.) — для повторной загрузки и проверки.
-- Запустить один раз. Если столбец уже есть — будет ошибка «duplicate column», можно игнорировать.
ALTER TABLE coins
  ADD COLUMN source_url VARCHAR(500) DEFAULT NULL COMMENT 'URL страницы-источника (perthmint.com и т.д.)' AFTER price_display;
