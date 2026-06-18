# 区域数据审计 (Area Data Audit)

> 生成:2026-06-01 快照 · 共 229 个可见区
> 数据源:dld_transactions(住宅 Sales: property_usage='Residential', property_type IN ('Unit','Villa'), meter_sale_price 1000-250000)+ dld_rent_contracts,经 dld_areas 桥接到 dubai_areas。

## 摘要

| 状态 | 区数 | 说明 |
|------|------|------|
| **四项全有**(价/量/增长/收益) | 60 | 有可靠住宅市场数据 |
| **部分有**(有价或量,缺增长/收益) | 58 | 成交稀疏,增长/收益算不出(<20笔护栏) |
| **完全空**(显示"—") | 111 | 无住宅成交:见下三类原因 |
| 合计可见区 | 229 | |

**完全空的三类原因:**
- 🅰 **真·非住宅**:机场 / 工业区 / Labor camp / DMCC / DIFC / Science Park(纯商业,无住宅成交,正确)。
- 🅱 **营销/楼盘名**:DLD 无此地籍区(如 Acres by meraas、Azizi Rivera、Cherry wood),数据不存在,接不上。
- 🅲 **真住宅但 DLD 用了不同地籍名**:数据存在但名字对不上(如 Arabian Ranches=Wadi Al Safa),需手动映射。见文末"未桥接 DLD 地籍区"。

---

## 1. 全部可见区(按成交量降序)

| 区域 | 成交量(12m) | 中位价/m² | 资本增长 | 租金收益 | 桥接DLD区数 | 桥接区总成交 |
|------|------------|-----------|---------|---------|-----------|-------------|
| JVC Jumeirah Village Circle | 14549 | 16142 | 11.8% | 6.24% | 1 | 94357 |
| Dubai Southأ | 10363 | 16693 | 4.3% | 4.79% | 1 | 31773 |
| The Villa | 9544 | 15789 | 10.8% | 5.01% | 1 | 51987 |
| Business Bay  | 9196 | 27818 | 6.0% | 4.71% | 1 | 80374 |
| Wadi Al Safa 3 | 7544 | 16300 | 8.2% | 4.82% | 1 | 19880 |
| Dubai investments Park | 6982 | 15841 | 7.4% | 4.61% | 2 | 22117 |
| Al Furjan | 6701 | 16519 | 48.8% | 4.15% | 1 | 40215 |
| Dubai Island A | 5260 | 28525 | 17.0% | — | 1 | 6938 |
| Motor city | 5169 | 20505 | 5.9% | 4.12% | 1 | 20973 |
| JVT Jumeirah villiage triangle | 5097 | 17457 | 15.9% | 5.67% | 1 | 20279 |
| Deira | 4872 | 18139 | 17.6% | 4.21% | 35 | 26721 |
| Maritime City | 4852 | 33243 | 18.3% | 2.15% | 1 | 12217 |
| Production City | 4292 | 14736 | 11.1% | 5.98% | 1 | 29078 |
| Dubai Creek Harbour | 4154 | 27186 | 2.0% | 5.34% | 2 | 25010 |
| Dubai Marina  | 4133 | 26803 | 4.3% | 4.30% | 1 | 119075 |
| Sobha Hartland 2 | 3678 | 26694 | 4.1% | 2.35% | 1 | 8206 |
| Arjan | 3499 | 16360 | 13.5% | 5.87% | 1 | 23433 |
| Hadaeq Sheikh Mohammed Bin Rashid | 3407 | 25932 | 3.0% | 5.70% | 1 | 37256 |
| International City | 3394 | 9451 | 21.8% | 6.91% | 2 | 56763 |
| Sport city | 3329 | 14306 | 11.9% | 6.08% | 1 | 40992 |
| Al Jadaf | 2934 | 21611 | 18.4% | 4.44% | 1 | 12907 |
| Downtown Dubai | 2818 | 31568 | 12.7% | 4.69% | 1 | 83145 |
| Dubai Silicon Oasis | 2813 | 14809 | 11.4% | 4.87% | 1 | 24173 |
| Jumeriah island | 2694 | 22973 | 2.5% | 5.02% | 1 | 86002 |
| MBR City District 1 | 2670 | 22288 | 0.9% | 6.74% | 1 | 35625 |
| City of Arabia | 2622 | 20643 | 11.8% | 3.25% | 1 | 4290 |
| wadi Al Safa2 | 2164 | 15338 | 41.9% | 5.17% | 1 | 14835 |
| Nadd Al Sheba 2 | 2129 | 35601 | 61.6% | 3.09% | 2 | 10932 |
| Damac lagoons | 1907 | 18363 | 18.8% | 4.72% | 1 | 24946 |
| Al wasl | 1790 | 34189 | 8.7% | 3.58% | 2 | 11847 |
| Al Satwa | 1741 | 24311 | 18.4% | 4.15% | 1 | 3587 |
| Studio City | 1419 | 15441 | 4.4% | 7.43% | 1 | 5066 |
| Damac hills | 1391 | 16583 | 19.4% | 6.21% | 1 | 20324 |
| Al Yufrah 1 | 1317 | 15636 | 15.5% | 4.74% | 1 | 9685 |
| Palm Jumeirah | 1196 | 38058 | 27.5% | 3.27% | 2 | 38609 |
| Al Layyan | 1119 | 15662 | 37.5% | 5.72% | 3 | 3484 |
| Zabeel 1&2 | 1090 | 32600 | 8.7% | 5.09% | 4 | 6357 |
| Wadi Al Safa 7 | 1028 | 13907 | 9.7% | 5.94% | 1 | 16400 |
| Ras Al Khor | 698 | 25129 | 6.0% | 2.40% | 4 | 3610 |
| Trade Center Second 2 | 695 | 51374 | — | 1.94% | 1 | 1881 |
| Al Kifaf | 588 | 23907 | 7.5% | 4.90% | 1 | 3922 |
| The Lake | 568 | 20342 | 11.6% | 5.74% | 1 | 29941 |
| Mudon | 527 | 16850 | 24.2% | 5.08% | 1 | 5803 |
| Jabal Ali Industrial 2 | 500 | 14548 | 4.4% | 7.52% | 1 | 3050 |
| Um suquaim | 489 | 30129 | 4.6% | 3.14% | 3 | 6142 |
| ‏Trade Center First | 397 | 39098 | — | 2.23% | 1 | 979 |
| The meadows  | 395 | 17604 | 15.5% | 4.08% | 1 | 28575 |
| Al Sousa second  | 365 | 19604 | -31.5% | 2.79% | 1 | 1714 |
| Saih Shuaib | 348 | 29196 | — | 1.98% | 1 | 4020 |
| Arabian Ranches 1 | 308 | 15371 | 14.1% | 3.95% | 1 | 18503 |
|  Jumeirah Scond | 301 | 45036 | 56.6% | 1.87% | 2 | 5089 |
| Mirdif | 232 | 13158 | 11.0% | 4.35% | 1 | 8848 |
| Palm Jebel Ali | 212 | 37515 | — | — | 1 | 1573 |
| Jumeirah Third | 197 | 78545 | 56.0% | 1.01% | 2 | 2032 |
| Al Quoz Industrial area 1&2&3 | 181 | 8950 | 5.0% | 8.28% | 9 | 5182 |
| Madinat Hind 4 | 171 | 12481 | -5.6% | 5.58% | 1 | 13917 |
| Barsha Heights(Tecom) | 130 | 15686 | 8.5% | 5.51% | 4 | 7920 |
| Al Barsha First | 117 | 19375 | 16.7% | 4.66% | 2 | 2052 |
| Al Qusais Industrial Aera 5 | 75 | 6458 | — | 8.21% | 1 | 344 |
| Nad Al Hamar | 73 | 11690 | 44.2% | 5.69% | 1 | 2447 |
| Al Safouh First | 67 | 17326 | 5.7% | 5.82% | 1 | 2021 |
| Muhaisnah 1 | 54 | 14694 | 14.9% | 5.77% | 1 | 1746 |
| Dubai Festival City | 53 | 16835 | -0.5% | 5.19% | 3 | 1250 |
| Al Rashidiya | 43 | 4239 | 28.2% | 13.96% | 3 | 1801 |
| Hessyan First | 27 | 8215 | 17.8% | 7.12% | 1 | 627 |
| Al Bada | 26 | 11088 | 56.9% | 4.66% | 1 | 1238 |
| Al Twar Fourth | 25 | 2557 | — | 17.07% | 1 | 501 |
| Al Warqa | 17 | 3678 | — | 14.75% | 4 | 6189 |
| Jumeirah island2 | 17 | 125814 | — | 0.45% | 1 | 925 |
| Muhaisnnah 3 | 14 | 6439 | — | 9.98% | 2 | 1119 |
| Al Jaffiliya | 12 | 7162 | — | 9.16% | 2 | 567 |
| Al Twar 2 | 12 | 3337 | — | 9.09% | 2 | 241 |
| World Islands | 12 | 28986 | — | — | 1 | 1112 |
| Um Al Sheif | 11 | 10979 | — | 7.09% | 1 | 1074 |
| Al Barsha Second | 10 | 5561 | — | 7.03% | 1 | 2338 |
| Al Barsha Third | 9 | 7347 | — | 5.59% | 1 | 2247 |
| Al Safa 1&2 | 7 | 9688 | — | 7.10% | 3 | 879 |
| Al Twar 1 | 7 | 3350 | — | 17.63% | 1 | 331 |
| Al Mizhar 1 | 6 | 3086 | — | 6.84% | 2 | 2138 |
| Al Mizhar 2 | 6 | 3499 | — | 12.04% | 1 | 1332 |
| Al Barsha South 2 | 3 | 4339 | — | 8.05% | 1 | 2015 |
| Al Manara | 3 | 10764 | — | 4.68% | 2 | 935 |
| Al Mankhool | 3 | 5857 | — | 12.42% | 1 | 932 |
| Al Qusais 2 | 3 | 2448 | — | 20.05% | 1 | 350 |
| Al Twar 3 | 3 | 3229 | — | 11.45% | 1 | 721 |
| Dubai Island E | 2 | 4851 | — | 12.15% | 1 | 655 |
| Al Aweer | 1 | 3072 | — | 14.15% | 3 | 4696 |
| Al Garhoud | 1 | 7351 | — | 9.42% | 1 | 463 |
| Al Khawaneej 1 | 1 | 3767 | — | 8.75% | 2 | 2785 |
| Abu Dhabi International Airport | — | — | — | — | 1 | 0 |
| Acres by meraas | — | — | — | — | 0 | 0 |
| Al Barari | — | — | — | — | 1 | 0 |
| Al Barsha South 1 | — | — | — | — | 0 | 0 |
| Al faqa | — | — | — | — | 0 | 0 |
| Al Hamriya | 0 | — | — | — | 1 | 679 |
| Al Hudaiba | — | — | — | — | 0 | 0 |
| Al Jadaf Waterfront  | — | — | — | — | 1 | 0 |
| Al Karama | 0 | — | — | — | 1 | 1009 |
| Al Khawaneej 2 | 0 | — | — | — | 2 | 2329 |
| Al Mamzar | — | — | — | — | 0 | 0 |
| Al Marmoom | 0 | — | — | — | 1 | 2 |
| Al Mina | — | — | — | — | 0 | 0 |
| Al Mizhar Third | 0 | — | — | — | 1 | 815 |
| Al Nahda | 0 | — | — | — | 4 | 1961 |
| Al Qusais1 | 0 | — | — | — | 2 | 556 |
| Al Qusais Indusdrial 2 | — | — | — | — | 0 | 0 |
| Al Qusais Industrial 1 | 0 | — | — | — | 2 | 172 |
| Al Qusais Industrial 3 | — | — | — | — | 0 | 0 |
| Al Qusais Industrial Area 4 | — | — | — | — | 0 | 0 |
| Al Raffa | 0 | — | — | — | 1 | 958 |
| Al Rowaiyah First | 0 | — | — | — | 1 | 57 |
| Al Rowaiyah Third | 0 | — | — | — | 1 | 10 |
| Al Safouh Second | — | — | — | — | 0 | 0 |
| Al Ttay | 0 | — | — | — | 1 | 294 |
| Arabian Ranches 2 | — | — | — | — | 0 | 0 |
| Arabian Ranches 3 | — | — | — | — | 0 | 0 |
| Athlon | — | — | — | — | 0 | 0 |
| Azizi Rivera at Maydan One | — | — | — | — | 1 | 0 |
| Beach front by Emaar | — | — | — | — | 0 | 0 |
|  Blue water  | — | — | — | — | 1 | 0 |
| Bukadra | — | — | — | — | 0 | 0 |
| Cherry wood | — | — | — | — | 1 | 0 |
| CityWalk | — | — | — | — | 1 | 0 |
| D3 Dubai Dsign District 3 | — | — | — | — | 1 | 0 |
| Damac Hills 2 | — | — | — | — | 0 | 0 |
| Damac Island | — | — | — | — | 0 | 0 |
| Damac Riverside | — | — | — | — | 0 | 0 |
| Desert Area & Labor camp | — | — | — | — | 0 | 0 |
| DIFC Dubai international financial center | — | — | — | — | 1 | 24 |
| Discovery gardens | — | — | — | — | 1 | 0 |
| DMCC | — | — | — | — | 1 | 0 |
| downtown&local area 外国人无法买卖 | — | — | — | — | 0 | 0 |
| Dubai Expo City | — | — | — | — | 0 | 0 |
| Dubai Harbour | — | — | — | — | 1 | 0 |
| Dubai hills | — | — | — | — | 1 | 0 |
| Dubai industrial City | — | — | — | — | 1 | 0 |
| Dubai Island B | — | — | — | — | 0 | 0 |
| Dubai island C | — | — | — | — | 0 | 0 |
| Dubai island D | — | — | — | — | 0 | 0 |
| Dubai Life style city | — | — | — | — | 1 | 0 |
| Dubai Rensidence complex | — | — | — | — | 1 | 0 |
| DWC Al Maktoum International Airport | — | — | — | — | 0 | 0 |
| DXB Dubai International Airport | — | — | — | — | 1 | 32 |
| Elwood | — | — | — | — | 0 | 0 |
| Emaar south | — | — | — | — | 1 | 0 |
| Emeriates Golf Club | — | — | — | — | 0 | 0 |
| Emirates Hills | — | — | — | — | 1 | 0 |
| Fahid Island（luxury apartment & Villa area） | — | — | — | — | 0 | 0 |
| Fahid island (高端海景公寓&别墅区) | — | — | — | — | 0 | 0 |
| Gradeer Al Taya | — | — | — | — | 0 | 0 |
| Grand Polo Club & Resort | — | — | — | — | 1 | 0 |
| Grayteesah | 0 | — | — | — | 1 | 20 |
| Hatta | 0 | — | — | — | 1 | 1 |
| Haven | — | — | — | — | 0 | 0 |
| Hessyan Second | — | — | — | — | 1 | 51 |
| Hudayriat island （Modon luxury villa and apartment） | — | — | — | — | 0 | 0 |
| Jamal Ali3 | — | — | — | — | 1 | 3 |
| Jbal Ali Indusdrial | 0 | — | — | — | 1 | 1177 |
| Jebel Ali Village | — | — | — | — | 0 | 0 |
| Jelbei Ali Indusrial 3 | — | — | — | — | 1 | 32 |
| JLT Jumeirah Lake tower | — | — | — | — | 1 | 0 |
| Jubail Island (luxury villa area) | — | — | — | — | 0 | 0 |
| Jumeirah bay(Bulgari island) | — | — | — | — | 0 | 0 |
| Jumeirah Beach Residence(JBR)  | — | — | — | — | 1 | 0 |
| Jumeirah First | — | — | — | — | 0 | 0 |
| Jumeirah Golf Estate | — | — | — | — | 1 | 0 |
| Jumeirah Heights | — | — | — | — | 1 | 0 |
| Jumeirah Park | — | — | — | — | 1 | 0 |
| Khalifa City (Local villa residential area) | — | — | — | — | 0 | 0 |
| Lanyan comminity | — | — | — | — | 0 | 0 |
| Latalia | — | — | — | — | 0 | 0 |
| Lehbab First | 0 | — | — | — | 1 | 38 |
| Living Legends | — | — | — | — | 1 | 0 |
| Local villa residential area | — | — | — | — | 0 | 0 |
| Madinat Hind 3 | 0 | — | — | — | 1 | 853 |
| Majan | — | — | — | — | 1 | 0 |
| Margham | 0 | — | — | — | 1 | 41 |
| Maryah island (ADGM Abu Dhabi Finacial center) | — | — | — | — | 0 | 0 |
| Masdar city | — | — | — | — | 0 | 0 |
| Maydan Distrct One West | 0 | — | — | — | 1 | 1634 |
| MBR City District 7 | — | — | — | — | 1 | 0 |
| MBR District11 (Medan South) | — | — | — | — | 0 | 0 |
| Mina Rashid | — | — | — | — | 1 | 0 |
| Mira Oasis | — | — | — | — | 1 | 0 |
| MJL(Madiant Jumeirah living ) | — | — | — | — | 1 | 0 |
| Muhaisnah 2 | 0 | — | — | — | 2 | 80 |
| Muhaisnah 4 | 0 | — | — | — | 1 | 190 |
| Mushif | 0 | — | — | — | 2 | 215 |
| Nad Al Sheba Gardens | — | — | — | — | 1 | 0 |
| Nadd Al Sheba 3 | 0 | — | — | — | 1 | 3247 |
| Nadd Al Sheba 4 | — | — | — | — | 0 | 0 |
| Nad Sheba | 0 | — | — | — | 1 | 248 |
| Paradise hills | — | — | — | — | 0 | 0 |
| Pearl Jumeirah | — | — | — | — | 1 | 0 |
| Port De La Mer | — | — | — | — | 1 | 0 |
| Qud Al Muteena | 0 | — | — | — | 1 | 1157 |
| Qud metha | 0 | — | — | — | 1 | 223 |
| RAHA Beach | — | — | — | — | 0 | 0 |
| Reem island (finacial center spill area) | — | — | — | — | 0 | 0 |
| Remraam | — | — | — | — | 1 | 0 |
| Rukan Community | — | — | — | — | 1 | 0 |
| Sadidyat Ialand （文化宝岛） | — | — | — | — | 0 | 0 |
| Scantury Sobha | — | — | — | — | 0 | 0 |
| Science Park | — | — | — | — | 1 | 0 |
| Serena Community | — | — | — | — | 1 | 0 |
| Shakhbout City | — | — | — | — | 0 | 0 |
| Sharjah | 0 | — | — | — | 2 | 40 |
| Shharrj | — | — | — | — | 0 | 0 |
| Sobha Heartland | — | — | — | — | 1 | 0 |
| Sun City | — | — | — | — | 0 | 0 |
| Sustainable city | — | — | — | — | 1 | 0 |
| The garden | — | — | — | — | 1 | 0 |
| The Greens | — | — | — | — | 1 | 0 |
| The Meadows | — | — | — | — | 0 | 0 |
| The Oasis by Emaar | — | — | — | — | 1 | 1882 |
| The spring | — | — | — | — | 0 | 0 |
| The Valley Emaar Properties | — | — | — | — | 1 | 0 |
| The Wilds | — | — | — | — | 0 | 0 |
| Tikal Al Ghaf | — | — | — | — | 1 | 0 |
| Town Square | — | — | — | — | 1 | 0 |
| Vacant Area | — | — | — | — | 0 | 0 |
| Villanova | — | — | — | — | 1 | 0 |
| Wadi Al Amardi | 0 | — | — | — | 1 | 541 |
| Wadi Alshabak | 0 | — | — | — | 1 | 858 |
| Wasl Gate | — | — | — | — | 1 | 0 |
| Yas island | — | — | — | — | 0 | 0 |
| Yas Island（亚斯娱乐岛） | — | — | — | — | 0 | 0 |
| Zayad City | — | — | — | — | 0 | 0 |
| Zayed Port 港口免税区 | — | — | — | — | 0 | 0 |

---

## 2. 未桥接的 DLD 地籍区(数据存在但没接到任何展示区 —— 需手动映射或手画)

共 43 个,合计 74,291 笔成交孤立。

| DLD 地籍区 | 成交量 |
|-----------|--------|
| Al Yelayiss 2 | 21,939 |
| Al Yelayiss 1 | 17,173 |
| Jabal Ali | 15,024 |
| Nad Al Shiba | 7,277 |
| Al Yufrah 2 | 5,194 |
| Al Yufrah 3 | 3,138 |
| Al Ruwayyah | 1,883 |
| Um Suqaim First | 1,048 |
| Al Suq Al Kabeer | 868 |
| Al Warsan Third | 225 |
| Al Warsan Second | 132 |
| Al Lusaily | 67 |
| Lehbab | 59 |
| Mena Jabal Ali | 46 |
| Zareeba Duviya | 25 |
| Saih Aldahal | 24 |
| Lehbab Second | 22 |
| Madinat Hind 1 | 21 |
| Madinat Latifa | 19 |
| Al-Raulah | 16 |
| Al Asbaq | 15 |
| Muragab | 14 |
| Al-Souq Al Kabeer (Deira) | 11 |
| Nazwah | 7 |
| Al-Zarouniyyah | 7 |
| Al Maha | 6 |
| Al Baharna | 5 |
| Al-Bastakiyah | 5 |
| Mugatrah | 4 |
| Muashrah Al Bahraana | 3 |
| Al Yufrah 4 | 2 |
| Al Rowaiyah Second | 1 |
| Al-Mustashfa West | 1 |
| Le Hemaira | 1 |
| Ghadeer Barashy | 1 |
| Yaraah | 1 |
| Madinat Hind 2 | 1 |
| Al Faga'A | 1 |
| Shandagha West | 1 |
| Al Layan1 | 1 |
| Al Fahidi | 1 |
| Remah | 1 |
| Al-Qiyadah | 1 |

---

## 3. 用到的 SQL 查询

### 每个可见区的指标 + 桥接状态(本报告主表)
```sql
SELECT da.name,
       m.sales_transaction_count AS tx,
       ROUND(m.median_price_sqm)::int AS price_sqm,
       m.price_growth_pct AS growth,
       m.rental_yield_pct AS yield,
       (SELECT COUNT(*) FROM dld_areas dla WHERE dla.dubai_area_id = da.id) AS bridges,
       (SELECT COALESCE(SUM(dla.transaction_count),0) FROM dld_areas dla WHERE dla.dubai_area_id = da.id) AS bridged_tx
  FROM dubai_areas da
  LEFT JOIN dubai_area_rolling_metrics m
    ON m.dubai_area_id = da.id
   AND m.period_end_month = (SELECT MAX(period_end_month) FROM dubai_area_rolling_metrics)
 WHERE da.visible
 ORDER BY COALESCE(m.sales_transaction_count, 0) DESC, da.name;
```

### 未桥接的 DLD 地籍区(孤立数据)
```sql
SELECT area_name, transaction_count
  FROM dld_areas
 WHERE dubai_area_id IS NULL AND COALESCE(transaction_count,0) > 0
 ORDER BY transaction_count DESC;
```

### 某个区为什么空 / 稀疏(以 Al Barsha South 1 为例)
```sql
-- 它有没有桥接、桥接的 area_id 有没有住宅成交
SELECT da.id, da.name,
       (SELECT COUNT(*) FROM dld_areas dla WHERE dla.dubai_area_id = da.id) AS bridges,
       (SELECT COUNT(*) FROM dld_transactions dt
          JOIN dld_areas dla ON dla.area_id = dt.area_id
         WHERE dla.dubai_area_id = da.id
           AND dt.trans_group='Sales' AND dt.property_usage='Residential'
           AND dt.property_type IN ('Unit','Villa')
           AND dt.instance_date > NOW() - INTERVAL '12 months') AS residential_sales_12m
  FROM dubai_areas da WHERE da.name = 'Al Barsha South 1';
```

### 重算指标(改了过滤/桥接后跑)
```sql
DELETE FROM dubai_area_rolling_metrics WHERE period_end_month = DATE_TRUNC('month', CURRENT_DATE);
SELECT calculate_area_rolling_metrics(CURRENT_DATE);
```
