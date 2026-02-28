# Крон на Reg.ru (PHP): металлы ЦБ раз в день

Скрипты лежат в `scripts/`: **cron-metal-prices.php** и **cron-metal-prices-config.php.example**.

---

## 1. Загрузить на сервер

Положи в **корень сайта** (папка `www/omonete.ru`, там же где лежит `index.html` и папка `data/`):

- `cron-metal-prices.php` — скрипт крона (переименуй из `scripts/cron-metal-prices.php` или скопируй).
- `cron-metal-prices-config.php` — создай из примера (см. ниже).

В итоге структура должна быть такой:

```
www/omonete.ru/
  index.html
  data/
    metal-prices.json   ← сюда скрипт будет писать
  cron-metal-prices.php
  cron-metal-prices-config.php
```

---

## 2. Настроить конфиг БД

Скопируй `scripts/cron-metal-prices-config.php.example` в `cron-metal-prices-config.php` (в корень сайта на сервере). Открой и укажи данные MySQL из панели Reg.ru:

```php
$dbHost = 'localhost';           // или хост БД из панели
$dbPort = 3306;
$dbName = 'uXXXXXX_omonete';     // имя базы
$dbUser = 'uXXXXXX_omonete';     // пользователь БД
$dbPass = 'пароль';              // пароль БД
```

Рекомендуется закрыть доступ к конфигу по HTTP. В `.htaccess` в корне сайта добавь:

```apache
<Files "cron-metal-prices-config.php">
  Require all denied
</Files>
```

---

## 3. Таблица в MySQL

В той же базе, где `coins` и `mints`, выполни один раз SQL из `scripts/metal-prices-table.sql` (создаётся таблица `metal_prices`). Если таблицу уже создавал для Node-скрипта — ничего делать не нужно.

---

## 4. Задание в планировщике CRON (ISPmanager)

- Зайти: **Планировщик CRON** → **Создать задание**.
- **Расписание:** раз в день, например в 06:00:
  ```text
  0 6 * * *
  ```
- **Команда:** вызов PHP-скрипта. Подставь свой путь к дому пользователя (логин из панели, часто `u1234567` или похожий):

  ```text
  /home/ТВОЙ_ЛОГИН/php-bin-regru-php82/bin/php /home/ТВОЙ_ЛОГИН/www/omonete.ru/cron-metal-prices.php
  ```

  Если в панели указан другой путь к PHP (например `php-bin-php80`), замени `php-bin-regru-php82` на него. Узнать путь можно в разделе **PHP** или в подсказке при создании задания.

Сохрани задание.

---

## 5. Проверка

- Вручную запусти задание кнопкой **Выполнить** в планировщике или из Shell-клиента:
  ```text
  /home/ТВОЙ_ЛОГИН/php-bin-regru-php82/bin/php /home/ТВОЙ_ЛОГИН/www/omonete.ru/cron-metal-prices.php
  ```
- Убедись, что появился или обновился файл `www/omonete.ru/data/metal-prices.json`.
- Открой на сайте страницу «Графики» — данные должны подтягиваться из этого файла.

---

## Что делает скрипт

1. Подключается к MySQL, при необходимости создаёт таблицу `metal_prices`.
2. Если в таблице меньше 500 строк — подтягивает из ЦБ данные за 10 лет (бэкфилл), затем добавляет последние 3 дня.
3. Если строк достаточно — только добавляет последние 3 дня из ЦБ.
4. Читает все данные из `metal_prices`, формирует JSON для периодов 1w, 1m, 1y, 5y, 10y (как в API) и записывает в `data/metal-prices.json`.

Требования: PHP 7.4+ с расширениями **PDO MySQL** и **intl** (для подписей дат на русском). На Reg.ru они обычно включены.
