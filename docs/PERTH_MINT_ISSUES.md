# Perth Mint — монеты с проблемами при сборе

Список позиций, по которым при загрузке возникли особенности или ошибки.

---

## 1. Нет аверса (подтянулся только реверс)

На сайте у этих монет аверс не попал в выборку (другая структура/имена файлов картинок). В каталоге будет отображаться только реверс.

| Монета | Ссылка | catalog_number |
|--------|--------|----------------|
| Giant Centipede 2026 1oz Silver Proof Coloured Coin | https://www.perthmint.com/shop/collector-coins/coins/deadly-and-dangerous-australias-giant-centipede-2026-1oz-silver-proof-coloured-coin/ | AU-PERTH-2026-26Y15AAA |
| Australian Koala 2025 1/2oz Gold Proof Coin | https://www.perthmint.com/shop/collector-coins/coins/australian-koala-2025-1-2oz-gold-proof-coin/ | AU-PERTH-2026-26022DPAD |
| Australian Koala 2025 1oz Gold Proof Coloured Coin | https://www.perthmint.com/shop/collector-coins/coins/australian-koala-2025-1oz-gold-proof-coloured-coin/ | AU-PERTH-2026-26022DPAD |
| Beijing International Coin Expo Special Australian Koala 2025 1oz Silver Coin with Panda Privy | https://www.perthmint.com/shop/collector-coins/coins/beijing-international-coin-expo-australian-koala-2025-1oz-silver-coin-panda-privy/ | AU-PERTH-2026-26022DPAD |
| Australian Wedge-tailed Eagle 2025 1 Kilo Gold Proof Ultra High Relief Gilded Coin | https://www.perthmint.com/shop/collector-coins/coins/australian-wedge-tailed-eagle-2025-1-kilo-gold-proof-ultra-high-relief-gilded-coin/ | AU-PERTH-2026-26022DPAD |

**Всего: 5 монет.**

---

## 2. Не монета (страница услуги)

Эту позицию не стоит добавлять в каталог монет — это страница услуги (персонализированные медальоны).

| Название | Ссылка | catalog_number |
|----------|--------|----------------|
| Corporate Personalised Medallions | https://www.perthmint.com/shop/collector-coins/coins/corporate-personalised-medallions/ | AU-PERTH-2026 |

**При импорте в БД:** можно исключить по `catalog_number = 'AU-PERTH-2026'` и отсутствию суффикса (SKU), либо добавить в скрипт импорта проверку по заголовку/URL и не вставлять эту запись.

---

## Замечание по catalog_number

У части монет (Australian Koala 2025, Beijing Expo Koala, Wedge-tailed Eagle 2025) в прогрессе записан один и тот же `AU-PERTH-2026-26022DPAD` — SKU взят из картинок с другой монеты на странице. При импорте возможны дубликаты по `catalog_number`. Имеет смысл проверить и при необходимости задать уникальные номера вручную или доработать извлечение SKU из страницы.
