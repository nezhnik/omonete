# Монеты Perth Mint: проблемы при сборе

Список монет со ссылками, по которым при первом проходе возникли проблемы (нет аверса, не монета и т.д.).

---

## 1. Нет аверса (подтянулся только реверс)

На сайте у части монет реверс обозначен в имени файла как **straight-on** / **straight** (а не только rev/reverse). Аверс может быть в папке **01.-archive** с именем **obverse-highres**. В скрипте добавлено распознавание `straight-on`/`straight` как реверс и учёт папки `01.-archive` при выборе SKU; при повторном сборе по этим ссылкам аверс должен подтянуться.

| Монета | Ссылка | Примечание |
|--------|--------|------------|
| Australian Koala 2025 1/2oz Gold Proof Coin | https://www.perthmint.com/shop/collector-coins/coins/australian-koala-2025-1-2oz-gold-proof-coin | Реверс в имени: straight-on-highres |
| Australian Koala 2025 1oz Gold Proof Coloured Coin | https://www.perthmint.com/shop/collector-coins/coins/australian-koala-2025-1oz-gold-proof-coloured-coin | То же |
| Beijing International Coin Expo Special Australian Koala 2025 1oz Silver (Panda Privy) | https://www.perthmint.com/shop/collector-coins/coins/beijing-international-coin-expo-australian-koala-2025-1oz-silver-coin-panda-privy | То же |
| Australian Wedge-tailed Eagle 2025 1 Kilo Gold Proof Ultra High Relief Gilded Coin | https://www.perthmint.com/shop/collector-coins/coins/australian-wedge-tailed-eagle-2025-1-kilo-gold-proof-ultra-high-relief-gilded-coin | То же |

---

## 2. Нет аверса (другая причина)

| Монета | Ссылка | Примечание |
|--------|--------|------------|
| Giant Centipede 2026 1oz Silver Proof Coloured Coin | https://www.perthmint.com/shop/collector-coins/coins/deadly-and-dangerous-australias-giant-centipede-2026-1oz-silver-proof-coloured-coin | При первом сборе аверс не определился (есть реверс и сертификат) |

---

## 3. Не монета (страница услуги)

| Название | Ссылка | Рекомендация |
|----------|--------|--------------|
| Corporate Personalised Medallions | https://www.perthmint.com/shop/collector-coins/coins/corporate-personalised-medallions | Страница услуги, не одна монета. При импорте в БД можно исключить по `catalog_number`: AU-PERTH-2026 (или не добавлять в каталог). |

---

## 4. Дублирующийся / неверный catalog_number

У нескольких разных монет при сборе получился один и тот же SKU из картинок (26022dpad), поэтому в данных фигурирует один и тот же `catalog_number` (AU-PERTH-2026-26022DPAD). Имеет смысл после импорта проверить и при необходимости поправить в БД по `title` или по ссылке на страницу Perth.

- Australian Koala 2025 1/2oz Gold Proof Coin  
- Australian Koala 2025 1oz Gold Proof Coloured Coin  
- Beijing International Coin Expo Special Australian Koala 2025 1oz Silver (Panda Privy)  
- Australian Wedge-tailed Eagle 2025 1 Kilo Gold Proof Ultra High Relief Gilded Coin  

---

*Файл сформирован по результатам первого прохода fetch (perth-mint-fetch-progress.json). После доработки скрипта (straight-on, 01.-archive, выбор SKU по большинству) можно удалить эти URL из прогресса и перезапустить fetch для повторного сбора.*
