# Royal Mint — несоответствие металла (аудит JSON)

Сгенерировано: 2026-03-24T21:06:46.551Z (`node scripts/audit-royal-mint-obvrev-metal-mismatch.js`)

Всего JSON: **357**, с `classified`: **353**.

## 1. Лицо / реверс (obv, rev) vs металл PDP

Подозрительных пар **нет**: у золотых PDP в URL obv/rev нет `silver-proof|silver-bullion|silver-piedfort` (и симметрично для серебра).

## 2. Сертификат / коробка при золотом PDP

Нет случаев, когда у золотого PDP в `certificate` или `box` в URL фигурирует silver-*.
