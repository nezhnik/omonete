# Australian Silver Kangaroo: Wikipedia — импорт в БД

Источник: [Australian Silver Kangaroo (bullion) — Wikipedia](https://en.wikipedia.org/wiki/Australian_Silver_Kangaroo_(bullion))

**Только текст и цифры. Картинки с Wikipedia не используем.**

## Спеки 1 oz bullion

| Параметр   | Значение   |
|-----------|------------|
| Масса     | 31.1 g     |
| Диаметр   | 40.6 mm    |
| Толщина   | 3.2 mm     |
| Проба     | 99.99% Ag  |
| Номинал   | AU$1       |

## Тиражи (Wikipedia)

| Год | Mintage    |
|-----|------------|
| 2015 | 300,000   |
| 2016 | 11,245,615 |
| 2017 | 5,178,016  |
| 2018 | 4,395,517  |
| 2019 | 5,650,501  |
| 2020 | 13,169,939 |
| 2021 | 11,735,394 |

## Файлы и импорт

| Файл | Назначение |
|------|------------|
| `data/kangaroo-wikipedia.json` | Bullion 2015–2021 из Wikipedia |
| `scripts/import-kangaroo-wikipedia-to-db.js` | Импорт в `coins` |

**Запуск:**
```bash
npm run kangaroo:import
```

По `catalog_number` дубликаты не создаются.
