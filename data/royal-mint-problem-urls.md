# The Royal Mint — проблемные монеты (ссылки на PDP)

Сгенерировано: 2026-03-24T20:17:34.327Z (`node scripts/audit-royal-mint-db-issues.js`)

В БД в колонке `source_url` — канонический URL страницы товара (без query). Если ссылки нет, строка помечена.

## 1. Плохой заголовок (404 PAGE NOT FOUND или «Welcome to The Royal Mint») (3)

- [Welcome to The Royal Mint](https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/archive/Charles-III-Definitives-2024-UK-2-Pound-Silver-Proof-Coin) — `GB-ROYAL-CHARLES` — id 6079
- [Welcome to The Royal Mint](https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/archive/King-Charles-III-Definitives-2024-UK-50p-Silver-Proof-Coin) — `GB-ROYAL-KING` — id 6100
- [Welcome to The Royal Mint](https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/archive/The-Lion-and-The-Eagle-2024-UK-1-2oz-Silver-Proof-Coin) — `GB-ROYAL-THE-LION-AND-THE-EAGLE-` — id 6255

## 2. Нет ни image_obverse, ни image_reverse (в т.ч. только блистер или пусто) (12)

- [2019 Remembrance Day UK £5 Silver Proof Piedfort](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2019-Remembrance-Day-UK-5-Silver-Proof-Piedfort) — `GB-ROYAL-2019-REMEMBRANCE-DAY-UK` — id 6217
- [2020 Celebrating British Diversity 50p Silver Proof](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2020-Celebrating-British-Diversity-50p-Silver-Proof) — `GB-ROYAL-2020-CELEBRATING-BRITIS` — id 6218
- [2012 London Olympic & Paralympic Gold Proof £5, two coin set](https://www.royalmint.com/shop/coin-sets/2012-London-Olympic-Paralympic-Gold-Proof-5-two-coin-set) — `GB-ROYAL-2012` — id 6522
- [2017 Elizabeth II Queen's Beasts Unicorn of Scotland Gold Proof Quarter-Ounce Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2017-Elizabeth-II-Queens-Beasts-Unicorn-of-Scotland-Gold-Proof-Quarter-Ounce-Coin) — `GB-ROYAL-2017` — id 6532
- [2019 Elizabeth II Piedfort Sovereign Proof Gold Coin](https://www.royalmint.com/sovereign/all/2019-Elizabeth-II-Piedfort-Sovereign-Proof-Gold-Coin) — `GB-ROYAL-2019-ELIZABETH-II-PIEDF` — id 6538
- [2019 Queen Elizabeth II Remembrance Day UK £5 Gold Proof Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2019-Queen-Elizabeth-II-Remembrance-Day-UK-5-Gold-Proof-Coin) — `GB-ROYAL-2019` — id 6539
- [2020 Elizabeth II Captain Cook £2 Gold Proof Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2020-Elizabeth-II-Captain-Cook-2-Gold-Proof-Coin) — `GB-ROYAL-2020-ELIZABETH-II-CAPTA` — id 6540
- [2020 Elizabeth II Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/2020-Elizabeth-II-Gold-Proof-Sovereign) — `GB-ROYAL-2020-ELIZABETH-II-GOLD-` — id 6541
- [2020 Queen Elizabeth II Gold Proof Snowman 50p Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2020-Queen-Elizabeth-II-Gold-Proof-Snowman-50p-Coin) — `GB-ROYAL-2020-QUEEN-ELIZABETH-II` — id 6542
- [The 1997 Golden Wedding £5 Gold Proof Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/golden-wedding-gold-5-pound) — `GB-ROYAL-GOLDEN-WEDDING-GOLD-5-P` — id 6572
- [The Queen's 80th Birthday 2006](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/queens-80th-birthday-gold-5-pound-coin) — `GB-ROYAL-QUEENS-80TH-BIRTHDAY-GO` — id 6583
- [The Royal Tudor Beasts The Seymore Panther Two-Ounce Gold Proof Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/The-Royal-Tudor-Beasts-The-Seymore-Panther-Two-Ounce-Gold-Proof-Coin) — `GB-ROYAL-THE` — id 6626

## 3. Только одна сторона монеты в колонках (obverse или reverse) (35)

- [Britannia 2022 1 oz Silver Bullion Coin](https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/britannia-2022-1-oz-silver-bullion-coin) — `GB-ROYAL-BRITANNIA-2022-1-OZ-SIL` — id 6055
- [1997 Britannia Silver Set](https://www.royalmint.com/shop/coin-sets/Britannia-Silver-Set) — `GB-ROYAL-BRITANNIA-SILVER-SET` — id 6074
- [Stegosaurus 2024 UK 50p Silver Proof Colour Coin](https://www.royalmint.com/shop/limited-editions/dinosaurs-iconic-specimens/stegosaurus/stegosaurus-2024-50p-silver-proof-colour-coin) — `GB-ROYAL-STEGOSAURUS-2024-50P-SI` — id 6191
- [The Red Arrows Collector Coin Set](https://www.royalmint.com/shop/limited-editions/red-arrows/The-Red-Arrows-Collector-Coin-Set) — `GB-ROYAL-THE-RED-ARROWS-COLLECTO` — id 6205
- [The Snowman 2025 UK 50p Silver Proof Colour Coin](https://www.royalmint.com/shop/commemorative/childhood-characters/the-snowman/the-snowman-2025-50p-silver-proof-colour-coin) — `GB-ROYAL-THE-SNOWMAN-2025-50P-SI` — id 6206
- [2017 'A Life of Service' Prince Philip Silver £5 Crown](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2017-A-Life-of-Service-Prince-Philip-Silver-5-Crown) — `GB-ROYAL-2017-A-LIFE-OF-SERVICE-` — id 6215
- [2019 Queen Victoria UK Silver Proof £5 Piedfort Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2019-Queen-Victoria-UK-Silver-Proof-5-Piedfort-Coin) — `GB-ROYAL-2019-QUEEN-VICTORIA-UK-` — id 6216
- [Britannia and Liberty 2024 UK 1/4oz Silver Bullion Coin](https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/Britannia-and-Liberty-2024-UK-1-4oz-Silver-Bullion-Coin) — `GB-ROYAL-BRITANNIA-AND-LIBERTY-2` — id 6231
- [Charles III Definitives 2024 UK 5p Silver Proof Coin](https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/Charles-III-Definitives-2024-UK-5p-Silver-Proof-Coin) — `GB-ROYAL-CHARLES-III-DEFINITIVES` — id 6240
- [The Lion and The Eagle 2024 UK 2oz Silver Proof Coin](https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/The-Lion-and-The-Eagle-2024-UK-2oz-Silver-Proof-Coin) — `GB-ROYAL-THE-LION-AND-THE-EAGLE-` — id 6258
- [The Lion and The Eagle 2024 UK 5oz Silver Proof Coin](https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/The-Lion-and-The-Eagle-2024-UK-5oz-Silver-Proof-Coin) — `GB-ROYAL-THE-LION-AND-THE-EAGLE-` — id 6259
- [75 Years of Dennis the Menace 2026 UK 1kg Silver Proof Coin](https://www.royalmint.com/shop/limited-editions/dennis-the-menace/75-years-of-dennis-the-menace-2026-1kg-silver-proof-coin) — `GB-ROYAL-75` — id 6268
- [The 80th Anniversary of VE Day 2025 UK 50p Silver Proof Coin](https://www.royalmint.com/shop/limited-editions/ve-day/the-80th-anniversary-of-ve-day-2025-50p-silver-proof-coin) — `GB-ROYAL-THE` — id 6282
- [2002 Queen Elizabeth II £2 Proof Sovereign](https://www.royalmint.com/sovereign/all/2002-Queen-Elizabeth-II-2-Proof-Sovereign) — `GB-ROYAL-2002-QUEEN-ELIZABETH-II` — id 6504
- [2004 UK Proof Half Sovereign](https://www.royalmint.com/sovereign/all/2004-UK-Proof-Half-Sovereign) — `GB-ROYAL-2004-UK-PROOF-HALF-SOVE` — id 6505
- [The 2012 Gold Proof Half-Sovereign](https://www.royalmint.com/sovereign/all/2012-uk-proof-half-sovereign) — `GB-ROYAL-2012-UK-PROOF-HALF-SOVE` — id 6523
- [2013 Elizabeth II Brilliant Uncirculated Sovereign](https://www.royalmint.com/sovereign/all/2013-Sovereign-I-Mint-Mark) — `GB-ROYAL-2013-SOVEREIGN-I-MINT-M` — id 6524
- [2014 Sovereign I Mint Mark](https://www.royalmint.com/sovereign/all/2014-sovereign-I-mint-mark) — `GB-ROYAL-2014-SOVEREIGN-I-MINT-M` — id 6526
- [2017 Elizabeth II Piedfort Proof Sovereign](https://www.royalmint.com/sovereign/all/2017-Elizabeth-II-Piedfort-Proof-Sovereign) — `GB-ROYAL-2017-ELIZABETH-II-PIEDF` — id 6531
- [2021 Elizabeth II Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/2021-Elizabeth-II-Gold-Proof-Sovereign) — `GB-ROYAL-2021-ELIZABETH-II-GOLD-` — id 6544
- [Britannia 2026 1/2oz Gold Bullion Coin in Blister](https://www.royalmint.com/invest/bullion/bullion-coins/gold-coins/bb26gho-britannia-2026-1-2oz-gold-bullion-coin-in-blister) — `GB-ROYAL-BB26GHO` — id 6561
- [Britannia 2026 1/4oz Gold Bullion Coin in Blister](https://www.royalmint.com/invest/bullion/bullion-coins/gold-coins/bb26gqo-britannia-2026-quarter-oz-gold-bullion-coin-in-blister) — `GB-ROYAL-BB26GQO` — id 6564
- [2006 UK Proof Half Sovereign](https://www.royalmint.com/sovereign/all/hishso06) — `GB-ROYAL-HISHSO06` — id 6575
- [The 2010 Five Sovereign Piece](https://www.royalmint.com/sovereign/all/Sovereign-2010-proof) — `GB-ROYAL-SOVEREIGN-2010-PROOF` — id 6585
- [The 2003 Gold Proof Half-Sovereign](https://www.royalmint.com/sovereign/all/the-half-sovereign-2003) — `GB-ROYAL-THE-HALF-SOVEREIGN-2003` — id 6605
- [The 1999 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-1999) — `GB-ROYAL-THE-SOVEREIGN-1999` — id 6631
- [The 2000 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-2000) — `GB-ROYAL-THE-SOVEREIGN-2000` — id 6632
- [The 2002 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-2002) — `GB-ROYAL-THE-SOVEREIGN-2002` — id 6633
- [The 2003 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-2003) — `GB-ROYAL-THE-SOVEREIGN-2003` — id 6634
- [The 2004 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-2004) — `GB-ROYAL-THE-SOVEREIGN-2004` — id 6635
- [The 2005 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-2005) — `GB-ROYAL-THE-SOVEREIGN-2005` — id 6636
- [The 2006 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-2006) — `GB-ROYAL-THE-SOVEREIGN-2006` — id 6637
- [The 2007 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-2007) — `GB-ROYAL-THE-SOVEREIGN-2007` — id 6638
- [The 2008 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-2008) — `GB-ROYAL-THE-SOVEREIGN-2008` — id 6639
- [The 2009 Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/the-sovereign-2009) — `GB-ROYAL-THE-SOVEREIGN-2009` — id 6640

## 4. Нет экспортируемой картинки (ни пары блистеров, ни нормальных obv/rev, ни массива image_urls) (12)

- [2019 Remembrance Day UK £5 Silver Proof Piedfort](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2019-Remembrance-Day-UK-5-Silver-Proof-Piedfort) — `GB-ROYAL-2019-REMEMBRANCE-DAY-UK` — id 6217
- [2020 Celebrating British Diversity 50p Silver Proof](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2020-Celebrating-British-Diversity-50p-Silver-Proof) — `GB-ROYAL-2020-CELEBRATING-BRITIS` — id 6218
- [2012 London Olympic & Paralympic Gold Proof £5, two coin set](https://www.royalmint.com/shop/coin-sets/2012-London-Olympic-Paralympic-Gold-Proof-5-two-coin-set) — `GB-ROYAL-2012` — id 6522
- [2017 Elizabeth II Queen's Beasts Unicorn of Scotland Gold Proof Quarter-Ounce Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2017-Elizabeth-II-Queens-Beasts-Unicorn-of-Scotland-Gold-Proof-Quarter-Ounce-Coin) — `GB-ROYAL-2017` — id 6532
- [2019 Elizabeth II Piedfort Sovereign Proof Gold Coin](https://www.royalmint.com/sovereign/all/2019-Elizabeth-II-Piedfort-Sovereign-Proof-Gold-Coin) — `GB-ROYAL-2019-ELIZABETH-II-PIEDF` — id 6538
- [2019 Queen Elizabeth II Remembrance Day UK £5 Gold Proof Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2019-Queen-Elizabeth-II-Remembrance-Day-UK-5-Gold-Proof-Coin) — `GB-ROYAL-2019` — id 6539
- [2020 Elizabeth II Captain Cook £2 Gold Proof Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2020-Elizabeth-II-Captain-Cook-2-Gold-Proof-Coin) — `GB-ROYAL-2020-ELIZABETH-II-CAPTA` — id 6540
- [2020 Elizabeth II Gold Proof Sovereign](https://www.royalmint.com/sovereign/all/2020-Elizabeth-II-Gold-Proof-Sovereign) — `GB-ROYAL-2020-ELIZABETH-II-GOLD-` — id 6541
- [2020 Queen Elizabeth II Gold Proof Snowman 50p Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2020-Queen-Elizabeth-II-Gold-Proof-Snowman-50p-Coin) — `GB-ROYAL-2020-QUEEN-ELIZABETH-II` — id 6542
- [The 1997 Golden Wedding £5 Gold Proof Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/golden-wedding-gold-5-pound) — `GB-ROYAL-GOLDEN-WEDDING-GOLD-5-P` — id 6572
- [The Queen's 80th Birthday 2006](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/queens-80th-birthday-gold-5-pound-coin) — `GB-ROYAL-QUEENS-80TH-BIRTHDAY-GO` — id 6583
- [The Royal Tudor Beasts The Seymore Panther Two-Ounce Gold Proof Coin](https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/The-Royal-Tudor-Beasts-The-Seymore-Panther-Two-Ounce-Gold-Proof-Coin) — `GB-ROYAL-THE` — id 6626
