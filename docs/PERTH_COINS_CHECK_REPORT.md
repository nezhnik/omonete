# Отчёт: монеты Perth 4574, 4595, 4594, 4580; дубли Great War; изображение 4839

## 1. Монеты 4574, 4595, 4594, 4580 — откуда данные и почему на сайте Perth

Все четыре монеты **взяты с сайта Perth Mint** (perthmint.com); ссылки ниже — страницы товаров.

| id   | Название | source_url (Perth) |
|------|----------|-------------------|
| 4574 | The 200th Anniversary of the Shield Back Sovereign Two-Coin Set | https://www.perthmint.com/shop/collector-coins/coin-sets/200th-anniversary-of-the-shield-back-sovereign-two-coin-set |
| 4580 | The Half Sovereign 2025 Gold Proof Coin | https://www.perthmint.com/shop/collector-coins/sovereigns/the-half-sovereign-2025-gold-proof-coin |
| 4594 | The Sovereign 2026 Gold Proof Coin | https://www.perthmint.com/shop/collector-coins/sovereigns/the-sovereign-2026-gold-proof-coin |
| 4595 | The Sovereign 2026 Silver Proof Coin | https://www.perthmint.com/shop/collector-coins/sovereigns/the-sovereign-2026-silver-proof-coin |

- **4574** — сет из двух соверенов (200th Anniversary); в каноническом JSON: страна Австралия, двор Perth Mint — корректно для продукта с сайта Perth.
- **4580** — Half Sovereign 2025; на Perth указан Legal Tender Tuvalu, поэтому в данных страна Тувалу.
- **4594, 4595** — Sovereign 2026 Gold и Silver; по факту продукт **The Royal Mint** (SKU 26Y93/26Y94/26Y92). В канонических JSON уже исправлено: mint = The Royal Mint, country = Великобритания. После `update-perth-from-canonical-json.js` и переэкспорта на сайте будут отображаться как Royal Mint.

Итог: они «есть на сайте Perth», потому что мы парсим каталог Perth; часть продуктов (Sovereign 2026) эмитирует Royal Mint, а Perth их продаёт — атрибуцию мы поправили в данных.

---

## 2. Почему много одинаковых карточек «Perth Mint Great War Gold Sovereign Collection 1914–1918»

В каталоге **несколько отдельных товаров** Perth с разными URL и ценами, но у всех в БД оказались:
- одно и то же **название**: «Perth Mint Great War Gold Sovereign Collection 1914–1918»;
- одно и то же **изображение**: `1910-king-edward-vii-sovereign-mintmark-trio-rev.webp` (это не Great War, а другой продукт).

Причина:

- На сайте Perth есть:
  - один URL **набора** «Great War Gold Sovereign Collection 1914–1918» (одна страница на весь сет);
  - отдельные URL по годам: 1914 (mintmark trio, king george v), 1915, 1916, 1917, 1918 (аналогично).
- В наших данных для многих из этих URL при импорте использовался **один и тот же канонический JSON** (или один образ картинки): у него в raw нет своих фото монет Great War, только упаковка (14w26aaa — box/packaging). Фетчер при выборе картинки по SKU подтянул изображение от другого продукта с той же страницы (15x69baa → 1910 King Edward VII), поэтому у всех записей серии отображается одна и та же неправильная картинка.

Что можно сделать дальше (по желанию):

- Развести записи по годам/вариантам: у каждой своё название (например, «1914 Gold Sovereign Mintmark Trio», «1915 King George V Perth Mint Gold Sovereign» и т.д.) и при возможности своя картинка со страницы этого товара.
- Для этого нужно, чтобы у каждого URL был свой JSON с корректными изображениями (достать со страницы Perth для 1914, 1915, 1916, 1917, 1918) и при импорте не подменять их общим «Great War»-образом.

---

## 3. Неправильное изображение у монеты 4839 (Kookaburra 2020 Kangaroo Paw)

**Монета 4839:** Perth Money Expo ANDA Special 30th Anniversary Australian Kookaburra 2020 1oz Silver Coin with Kangaroo Paw Privy.

- Сейчас показывается картинка: `2013-australian-kookaburra-kangaroo-koala-high-relief-silver-pr-99-9-1-oz-3-coin-set-rev.webp` (это **другой продукт** — сет из трёх монет 2013).
- Правильные изображения для 2020 Kookaburra Kangaroo Paw на сайте Perth лежат в путях с **y20022dpad** (архив 2012–2020). Раньше фетчер не обрабатывал путь `01.-archive/2012-2020/`, поэтому не привязал к продукту картинки y20022dpad и подставил чужую.

**Что сделано в коде:**

- В `scripts/fetch-perth-mint-coin.js` добавлено распознавание архивного пути `01.-archive/2012-2020/<sku>/`: для таких URL теперь извлекаются year и sku (в т.ч. y20022dpad), и фетчер сможет выбрать и сохранить правильные фото для этой монеты.

**Что сделать вам:**

1. Перезапустить фетч **только для этой страницы** (чтобы подтянуть правильные изображения и обновить JSON):

```bash
node scripts/fetch-perth-mint-coin.js "https://www.perthmint.com/shop/collector-coins/coins/perth-money-expo-anda-special-30th-anniversary-australian-kookaburra-2020-1oz-silver-coin-with-kangaroo-paw-privy" --refresh
```

2. Обновить запись в БД из канонического JSON и переэкспорт:

```bash
node scripts/update-perth-from-canonical-json.js
node scripts/export-coins-to-json.js
```

После этого у монеты 4839 в каноническом JSON и на сайте должно отображаться корректное изображение Kookaburra 2020 Kangaroo Paw.

---

## 4. Четыре одинаковые карточки «65th Anniversary of the Coronation of Her Majesty QEII 2018 1oz Silver Proof Coin»

**Что видно в каталоге:** несколько карточек с одним и тем же названием и одной и той же картинкой (биметалл «60 YEARS 1966–2018», Australian Decimal Currency).

**Фактически в БД:** записей с таким названием больше четырёх (id: 4222, 4781, 4788, 4793, 4806, 4807, 4823, 4824, 4828, 4829, 4831, 4832 и др.). У них:
- одно и то же **название**: «65th Anniversary… 2018 1oz Silver Proof Coin»;
- одна и та же **картинка**: `end-of-wwii-75th-anniversary-2020-2oz-gold-proof-coin-rev.webp` — это **не** 65th Anniversary QEII, а монета «End of WWII 75th Anniversary 2020» (другой продукт);
- при этом разные **металл** (Ag / Au), **диаметр** (20.6–50.6 mm), **тираж**, **цена** — то есть это **разные продукты** Perth (1oz silver, 1/4oz gold, 2oz gold, разные форматы/упаковки).

**Откуда дубли:** на Perth по теме «65th Anniversary QEII 2018» есть только три отдельных URL:
- 1/4oz Gold Proof  
- 1oz Silver Proof  
- 2oz Gold Proof  

Остальные строки в БД, скорее всего, попали из листингов или повторного импорта и получили то же название и чужую картинку.

**Почему картинка не та:** у продукта 1oz Silver правильные фото на сайте в путях с **18c59aaa** (архив `01.-archive/2012-2020/`). Раньше фетчер не обрабатывал этот путь и подставил изображение с другой карточки (End of WWII 2020). В `fetch-perth-mint-coin.js` уже добавлена поддержка архива `2012-2020` для любого SKU (в т.ч. 18c59aaa), поэтому при повторном фетче страницы 1oz Silver подтянутся правильные фото.

**Что сделать:**

1. **Исправить изображение у «настоящей» 1oz Silver** — перезапустить фетч только этой страницы:
```bash
node scripts/fetch-perth-mint-coin.js "https://www.perthmint.com/shop/collector-coins/coins/65th-anniversary-of-the-coronation-of-her-majesty-qeii-2018-1oz-silver-proof-coin" --refresh
```
Затем обновить БД из канонического JSON и переэкспорт (`update-perth-from-canonical-json.js`, `export-coins-to-json.js`).

2. **Развести дубли по названиям/типам:** оставить одну запись «65th Anniversary 2018 1oz Silver» с правильной картинкой; остальные строки либо удалить как дубли, либо переименовать по факту (например, «65th Anniversary 2018 1/4oz Gold», «65th Anniversary 2018 2oz Gold») и привязать к своим URL/JSON, чтобы у каждого продукта было своё название и при возможности своя картинка. Это можно сделать скриптом или вручную по `catalog_number` / `source_url` и характеристикам из Perth.
