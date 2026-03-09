# Правила извлечения серий Perth Mint из breadcrumb

Проверено на реальных страницах (2025).

## Структуры pageMetadataObject.breadcrumb

### 1. Sovereigns / Coin Sets (4 элемента)
```
["Home", "Collector coins", "Sovereigns", "1914 King George V Perth Mint Gold Sovereign"]
["Home", "Collector coins", "Coin Sets", "..."]
```
**Серия:** `bc[2]` → "Gold Sovereign" или "Coin Sets"

### 2. Серия в формате "Series - Title" (4 элемента)
```
["Home", "Collector coins", "Coins", "Deadly and Dangerous - Australia's Giant Centipede 2026 1oz Silver Proof Coloured Coin"]
["Home", "Collector coins", "Coins", "Sydney ANDA Coin Show Special - Australian Lunar Series II - 2012 Year of the Dragon 1oz Silver Coloured Edition"]
```
**Серия:** часть до первого " - " в последнем элементе → "Deadly and Dangerous", "Sydney ANDA Coin Show Special"

### 3. Серия до года в last (4 элемента, bc[2]=="Coins")
```
["Home", "Collector coins", "Coins", "Australian Lunar Series III 2025 Year of the Snake 1oz Silver Proof Coin"]
["Home", "Collector coins", "Coins", "Australian Kangaroo 2018 1oz Silver Proof High Relief Coin"]
["Home", "Collector coins", "Coins", "Australian Lunar Silver Coin Series II 2018 Year of the Dog 1oz Silver Gilded Edition"]
```
**Серия:** regex `^(.+?)\s+(?:20|19)\d{2}` → "Australian Lunar Series III", "Australian Kangaroo", "Australian Lunar Silver Coin Series II"

### 4. 3 элемента (URL без /coins/ в пути)
```
["Home", "Collector coins", "Australian Kangaroo 2023 1/10oz Gold Proof Coin"]
```
**Серия:** тот же regex по году → "Australian Kangaroo"

## Примечания

- Некоторые страницы (напр. Kookaburra) могут загружать pageMetadataObject с задержкой — нужен waitForSelector или networkidle.
- Если breadcrumb не найден или не подходит под правила — серия = null (без fallback).
- Источник: `#pageMetadataObject` (JSON в `<script id="pageMetadataObject">`).
