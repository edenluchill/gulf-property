-- 地标内容升级 (2026-06-12)
-- 1) 加 translations JSONB（与 dubai_areas 一致）
-- 2) 给现有地标填充中文名 + 面向客户的富描述（价值/就业/环境）
-- 3) 新增 7 个著名地标

ALTER TABLE dubai_landmarks ADD COLUMN IF NOT EXISTS translations JSONB DEFAULT '{}'::jsonb;

-- ── 现有地标内容 ────────────────────────────────────────────────────────────

UPDATE dubai_landmarks SET
  description = COALESCE(NULLIF(description, ''), 'The world''s tallest building at 828m, the centerpiece of Downtown Dubai. Surrounded by the Dubai Mall, Dubai Opera and the fountain, it anchors the city''s most prestigious address — properties with a Burj view command a significant premium.'),
  year_built = COALESCE(year_built, 2010),
  translations = jsonb_set(COALESCE(translations,'{}'::jsonb), '{zh}', '{"name":"哈利法塔","description":"世界第一高楼（828米），迪拜市中心的心脏。周边汇聚迪拜购物中心、歌剧院和音乐喷泉，是全城最高端的地址——能看到哈利法塔景观的房产有明显溢价，租赁需求常年旺盛。"}'::jsonb)
WHERE name = 'Burj Khalifa';

UPDATE dubai_landmarks SET
  description = COALESCE(NULLIF(description, ''), 'One of Dubai''s flagship malls, famous for Ski Dubai — a full indoor ski resort in the desert. It anchors the Al Barsha district and brings strong retail jobs and rental demand to surrounding communities.'),
  year_built = COALESCE(year_built, 2005),
  translations = jsonb_set(COALESCE(translations,'{}'::jsonb), '{zh}', '{"name":"阿联酋购物中心","description":"迪拜旗舰商场之一，以沙漠中的室内滑雪场 Ski Dubai 闻名。它是 Al Barsha 区的核心配套，带来大量零售就业，周边社区生活便利、租赁需求稳定。"}'::jsonb)
WHERE name = 'Mall of the Emirates';

UPDATE dubai_landmarks SET
  description = COALESCE(NULLIF(description, ''), 'Dubai''s iconic sail-shaped 7-star hotel on its own island. The Umm Suqeim / Jumeirah coastline around it is one of the city''s most exclusive low-rise beachfront areas.'),
  year_built = COALESCE(year_built, 1999),
  translations = jsonb_set(COALESCE(translations,'{}'::jsonb), '{zh}', '{"name":"帆船酒店","description":"迪拜地标性的七星级帆船酒店，矗立在专属人工岛上。它所在的朱美拉海岸线是全城最高端的低密度海滨区之一，周边别墅区环境安静、保值性强。"}'::jsonb)
WHERE name = 'Burj Al Arab';

UPDATE dubai_landmarks SET
  description = COALESCE(NULLIF(description, ''), 'DXB — one of the world''s busiest international airports and a massive employment hub. Areas nearby (Deira, Al Garhoud, Mirdif) offer strong rental yields from airport and aviation staff.'),
  translations = jsonb_set(COALESCE(translations,'{}'::jsonb), '{zh}', '{"name":"迪拜国际机场","description":"DXB 是全球最繁忙的国际机场之一，也是巨大的就业枢纽（航空、物流、免税零售）。周边的德拉、加尔胡德、米尔迪夫等区域靠机场员工租房需求，租金回报率出色。"}'::jsonb)
WHERE name = 'Dubai International Airport';

UPDATE dubai_landmarks SET
  description = COALESCE(NULLIF(description, ''), 'A seasonal multicultural festival park with pavilions from 90+ countries, drawing millions of visitors each winter. It anchors entertainment demand in the Dubailand corridor.'),
  year_built = COALESCE(year_built, 1997),
  translations = jsonb_set(COALESCE(translations,'{}'::jsonb), '{zh}', '{"name":"环球村","description":"每年冬季开放的多元文化主题公园，汇聚 90 多个国家展馆，季均客流数百万。它带动了 Dubailand 走廊的娱乐人气，周边新兴社区（如 Town Square、Remraam）价格亲民、适合首次置业。"}'::jsonb)
WHERE name = 'Global Village';

UPDATE dubai_landmarks SET
  description = COALESCE(NULLIF(description, ''), 'A 150m golden picture-frame structure in Zabeel Park, framing views of both old and new Dubai. It sits at the symbolic border between historic Deira/Bur Dubai and the modern city.'),
  year_built = COALESCE(year_built, 2018),
  translations = jsonb_set(COALESCE(translations,'{}'::jsonb), '{zh}', '{"name":"迪拜画框","description":"扎比尔公园里 150 米高的金色巨型画框，一面望老城、一面望新城。它正好站在老迪拜（德拉/老城区）与新迪拜的分界线上，是理解这座城市格局的最佳坐标。"}'::jsonb)
WHERE name = 'Dubai Frame';

UPDATE dubai_landmarks SET
  description = COALESCE(NULLIF(description, ''), 'The torus-shaped architectural icon on Sheikh Zayed Road, dedicated to future technology. It sits next to DIFC and the Trade Centre — the heart of Dubai''s white-collar employment corridor.'),
  year_built = COALESCE(year_built, 2022),
  translations = jsonb_set(COALESCE(translations,'{}'::jsonb), '{zh}', '{"name":"未来博物馆","description":"扎耶德大道上的环形建筑奇观，展示未来科技。它紧邻 DIFC 金融城和世贸中心——迪拜白领就业最密集的走廊，周边公寓面向高收入租客，长租需求稳定。"}'::jsonb)
WHERE name = 'Museum of the Future';

UPDATE dubai_landmarks SET
  description = COALESCE(NULLIF(description, ''), 'Abu Dhabi''s new flagship airport terminal with its dune-inspired roof, opened 2023. A major gateway and employment hub for the capital region.'),
  year_built = COALESCE(year_built, 2023),
  translations = jsonb_set(COALESCE(translations,'{}'::jsonb), '{zh}', '{"name":"扎耶德国际机场","description":"阿布扎比新旗舰航站楼，沙丘造型屋顶，2023 年启用。是首都圈的门户和就业枢纽，对阿布扎比方向的置业（如 Yas Island、Saadiyat）是重要配套。"}'::jsonb)
WHERE name = 'Zayad International Airport';

-- ── 新增著名地标 ────────────────────────────────────────────────────────────
-- 注意防重复：按 name 不存在才插入

INSERT INTO dubai_landmarks (name, name_ar, location, landmark_type, icon_name, description, year_built, color, size, display_order, visible, translations)
SELECT v.name, v.name_ar, ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography, v.landmark_type, v.icon_name, v.description, v.year_built, v.color, v.size, v.display_order, true, v.translations::jsonb
FROM (VALUES
  ('The Dubai Mall', 'دبي مول', 55.2796, 25.1972, 'mall', 'shopping-bag',
   'The world''s most-visited shopping and lifestyle destination (100M+ visits a year), home to the Dubai Aquarium and the fountain promenade. It is the single biggest driver of footfall, jobs and short-let demand in Downtown Dubai.',
   2008, '#db2777', 'medium', 10,
   '{"zh":{"name":"迪拜购物中心","description":"全球客流量第一的购物中心（年访问量超 1 亿人次），内有水族馆、直通音乐喷泉步道。它是迪拜市中心人气、就业和短租需求的最大引擎，周边公寓做民宿/短租表现突出。"}}'),
  ('Atlantis The Palm', 'أتلانتس النخلة', 55.1171, 25.1304, 'hotel', 'hotel',
   'The landmark resort crowning Palm Jumeirah, with the Aquaventure waterpark. It defines the Palm''s resort lifestyle — villas and apartments on the fronds enjoy world-class hospitality at their doorstep.',
   2008, '#7c3aed', 'medium', 11,
   '{"zh":{"name":"亚特兰蒂斯酒店","description":"棕榈岛之冠的传奇度假酒店，自带水上乐园 Aquaventure。它定义了棕榈岛的度假生活方式——岛上的别墅和公寓出门就是世界级酒店配套，是迪拜豪宅的代表性资产。"}}'),
  ('Ain Dubai', 'عين دبي', 55.1224, 25.0789, 'attraction', 'ferris-wheel',
   'The world''s tallest observation wheel (250m) on Bluewaters Island, overlooking JBR and Dubai Marina. The island around it is a premium waterfront residential enclave.',
   2021, '#0ea5e9', 'medium', 12,
   '{"zh":{"name":"迪拜眼","description":"全球最高摩天轮（250米），坐落于蓝水岛，俯瞰 JBR 海滩和迪拜码头。所在的蓝水岛本身就是高端海滨住宅区，步行可达海滩和码头夜生活带。"}}'),
  ('Dubai Miracle Garden', 'حديقة دبي المعجزة', 55.2447, 25.0610, 'park', 'flower',
   'The world''s largest natural flower garden with 150M+ blooms each season. It anchors family-friendly appeal in the Arjan / Dubailand area, where affordable new communities are growing fast.',
   2013, '#16a34a', 'small', 13,
   '{"zh":{"name":"迪拜奇迹花园","description":"全球最大的天然花卉公园，每季超 1.5 亿株鲜花。它让 Arjan/Dubailand 一带充满家庭友好氛围——这片区域新盘多、总价低，是预算型买家的热门选择。"}}'),
  ('Expo City Dubai', 'مدينة إكسبو دبي', 55.1510, 24.9618, 'attraction', 'globe',
   'The legacy district of Expo 2020 around the Al Wasl dome, now a tech and sustainability business hub next to Al Maktoum Airport. A long-term growth corridor for Dubai South.',
   2021, '#0d9488', 'medium', 14,
   '{"zh":{"name":"世博城","description":"2020 世博会原址，以 Al Wasl 穹顶为核心，现已转型为科技与可持续产业园区，紧邻在建的全球最大机场 Al Maktoum。迪拜南区的长线增长引擎，适合看 5-10 年潜力的投资者。"}}'),
  ('Dubai Gold Souk', 'سوق الذهب', 55.2961, 25.2702, 'attraction', 'landmark',
   'The historic gold market in Deira with 350+ jewellers — one of the world''s largest gold trading hubs. It keeps old Dubai''s commerce alive and underpins steady rental demand in the surrounding district.',
   1940, '#f59e0b', 'small', 15,
   '{"zh":{"name":"黄金市场","description":"德拉老城区的百年黄金市场，350 多家金店，是全球最大的黄金零售集散地之一。老城商贸常年兴旺，带来稳定的商铺与公寓租赁需求，租金回报率在全城名列前茅。"}}'),
  ('DIFC Gate', 'بوابة مركز دبي المالي', 55.2802, 25.2117, 'attraction', 'landmark',
   'The Gate Building is the symbol of Dubai International Financial Centre — home to 5,000+ financial firms and 40,000+ professionals. The single densest white-collar employment hub in the city.',
   2004, '#1e40af', 'small', 16,
   '{"zh":{"name":"迪拜国际金融中心","description":"Gate 大楼是 DIFC 金融城的象征——5000 多家金融机构、4 万多名金融从业者在此办公，是全城白领密度最高的就业核心。周边公寓面向高薪租客，长租市场非常稳健。"}}')
) AS v(name, name_ar, lng, lat, landmark_type, icon_name, description, year_built, color, size, display_order, translations)
WHERE NOT EXISTS (SELECT 1 FROM dubai_landmarks dl WHERE dl.name = v.name);

-- 验证
SELECT name, translations->'zh'->>'name' AS zh, landmark_type, size, visible
FROM dubai_landmarks ORDER BY display_order, name;
