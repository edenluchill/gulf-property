-- Fix missing Chinese (zh) names and broken/placeholder descriptions for Dubai areas.
-- Background: 38 areas had no translations.zh.name -> map fell back to English label.
-- 19 of those also had placeholder English descriptions ("Auto-added from official
-- Dubai Municipality community boundary (xxx)") and no Chinese description at all.
--
-- This script (per user decision):
--   * Adds translations.zh.name to all 38 areas. Does NOT touch the English `name` column.
--   * For the 19 placeholder-description Dubai areas, writes a real EN description
--     (into both the `description` column and translations.en.description) and a real
--     ZH description (translations.zh.description).
--   * Merges into existing JSONB so other locales/keys are preserved.
--
-- Frontend only supports en + zh-CN, so Arabic is intentionally out of scope.

BEGIN;

-- =====================================================================
-- GROUP A: 19 real Dubai areas with placeholder English descriptions.
-- Add zh.name + real EN/ZH descriptions.
-- =====================================================================

UPDATE dubai_areas SET
  description = 'Al Hamriya is an established waterfront neighbourhood in eastern Deira, anchored by Al Hamriya Port and a long-standing local residential community. It appeals to investors seeking affordable, high-occupancy rental stock close to old-Dubai commerce. ~3km to Dubai Gold Souk, ~5km to Dubai International Airport.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Al Hamriya is an established waterfront neighbourhood in eastern Deira, anchored by Al Hamriya Port and a long-standing local residential community. It appeals to investors seeking affordable, high-occupancy rental stock close to old-Dubai commerce. ~3km to Dubai Gold Souk, ~5km to Dubai International Airport.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','哈姆利亚','description','哈姆利亚是德拉东部一处成熟的滨水社区，依托哈姆利亚港和长期稳定的本地居住人口。适合寻求高出租率、价格亲民租赁房源、贴近老迪拜商圈的投资者。距黄金市场约 3km、迪拜国际机场约 5km。'))
WHERE name = 'Al Hamriya';

UPDATE dubai_areas SET
  description = 'Al Marmoom is home to the Al Marmoom Desert Conservation Reserve — Dubai''s largest unfenced nature reserve — known for eco-tourism, cycling tracks and camel racing rather than residential development. Land here is primarily for leisure, conservation and long-horizon master-plan plays. ~30km southeast of Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Al Marmoom is home to the Al Marmoom Desert Conservation Reserve — Dubai''s largest unfenced nature reserve — known for eco-tourism, cycling tracks and camel racing rather than residential development. Land here is primarily for leisure, conservation and long-horizon master-plan plays. ~30km southeast of Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','马尔穆姆','description','马尔穆姆坐拥迪拜最大的无围栏自然保护区——马尔穆姆沙漠保护区，以生态旅游、骑行道和骆驼赛事闻名，几乎没有住宅开发。此处土地以休闲、生态保护及远期总体规划为主。位于迪拜市中心东南约 30km。'))
WHERE name = 'Al Marmoom';

UPDATE dubai_areas SET
  description = 'Al Mizhar Third is a quiet, low-density villa enclave on Dubai''s eastern edge near Mirdif, favoured by local Emirati families. It suits investors targeting stable, family-oriented villa rentals away from the high-rise core. ~7km to Mirdif City Centre, ~12km to Dubai International Airport.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Al Mizhar Third is a quiet, low-density villa enclave on Dubai''s eastern edge near Mirdif, favoured by local Emirati families. It suits investors targeting stable, family-oriented villa rentals away from the high-rise core. ~7km to Mirdif City Centre, ~12km to Dubai International Airport.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','米兹哈尔三区','description','米兹哈尔三区是迪拜东缘、邻近 Mirdif 的低密度别墅社区，深受本地阿联酋家庭青睐。适合瞄准稳定家庭型别墅租赁、远离高层核心区的投资者。距 Mirdif City Centre 约 7km、迪拜国际机场约 12km。'))
WHERE name = 'Al Mizhar Third';

UPDATE dubai_areas SET
  description = 'Al Rowaiyah First is a sparsely developed desert-fringe district on Dubai''s southern outskirts near Al Qudra, characterised by open land, farms and emerging low-density plots. It is mainly a long-term land-banking and master-plan opportunity. ~25km from Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Al Rowaiyah First is a sparsely developed desert-fringe district on Dubai''s southern outskirts near Al Qudra, characterised by open land, farms and emerging low-density plots. It is mainly a long-term land-banking and master-plan opportunity. ~25km from Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','罗瓦亚一区','description','罗瓦亚一区位于迪拜南部外围、邻近 Al Qudra，开发稀疏，以开阔土地、农场和新兴低密度地块为主。主要是远期囤地与总体规划机会。距迪拜市中心约 25km。'))
WHERE name = 'Al Rowaiyah First';

UPDATE dubai_areas SET
  description = 'Al Rowaiyah Third sits on Dubai''s southern desert fringe near Al Qudra, an open, low-density area of farmland and undeveloped plots. Value here is driven by future master-planning and land appreciation rather than current rental demand. ~27km from Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Al Rowaiyah Third sits on Dubai''s southern desert fringe near Al Qudra, an open, low-density area of farmland and undeveloped plots. Value here is driven by future master-planning and land appreciation rather than current rental demand. ~27km from Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','罗瓦亚三区','description','罗瓦亚三区位于迪拜南部沙漠边缘、邻近 Al Qudra，是以农地和未开发地块为主的开阔低密度区域。价值来自未来总体规划与土地增值，而非当前租赁需求。距迪拜市中心约 27km。'))
WHERE name = 'Al Rowaiyah Third';

UPDATE dubai_areas SET
  description = 'Al Ttay is a rural, low-density district on Dubai''s eastern outskirts near Al Aweer, dominated by farms, warehouses and open land. It appeals to buyers seeking inexpensive land with long-term growth potential. ~20km from Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Al Ttay is a rural, low-density district on Dubai''s eastern outskirts near Al Aweer, dominated by farms, warehouses and open land. It appeals to buyers seeking inexpensive land with long-term growth potential. ~20km from Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','塔伊区','description','塔伊区位于迪拜东部外围、邻近 Al Aweer，是以农场、仓库和开阔土地为主的低密度乡郊区域。适合寻求低价土地、看重远期增值的买家。距迪拜市中心约 20km。'))
WHERE name = 'Al Ttay';

UPDATE dubai_areas SET
  description = 'Al Twar Fourth is an established mid-market residential community near Dubai International Airport, offering villas and low-rise homes popular with long-term local tenants. Its airport proximity supports steady rental demand. ~4km to Dubai International Airport, ~9km to Deira City Centre.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Al Twar Fourth is an established mid-market residential community near Dubai International Airport, offering villas and low-rise homes popular with long-term local tenants. Its airport proximity supports steady rental demand. ~4km to Dubai International Airport, ~9km to Deira City Centre.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','图瓦尔四区','description','图瓦尔四区是邻近迪拜国际机场的成熟中端住宅社区，以别墅和低层住宅为主，受长期本地租客欢迎。临近机场带来稳定租赁需求。距迪拜国际机场约 4km、Deira City Centre 约 9km。'))
WHERE name = 'Al Twar Fourth';

UPDATE dubai_areas SET
  description = 'Al Yufrah 1 is a remote desert district in Dubai''s far interior, largely undeveloped open land with minimal infrastructure. It is strictly a speculative long-horizon land play. ~45km from Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Al Yufrah 1 is a remote desert district in Dubai''s far interior, largely undeveloped open land with minimal infrastructure. It is strictly a speculative long-horizon land play. ~45km from Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','优夫拉一区','description','优夫拉一区是迪拜深处的偏远沙漠区域，多为未开发的开阔土地，基础设施稀少。属于纯粹的远期投机性土地投资。距迪拜市中心约 45km。'))
WHERE name = 'Al Yufrah 1';

UPDATE dubai_areas SET
  description = 'Grayteesah is a remote desert district in Dubai''s southern interior, consisting almost entirely of open, undeveloped land. Investment interest is limited to long-term land banking ahead of any future master-planning. ~40km from Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Grayteesah is a remote desert district in Dubai''s southern interior, consisting almost entirely of open, undeveloped land. Investment interest is limited to long-term land banking ahead of any future master-planning. ~40km from Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','格雷提萨','description','格雷提萨是迪拜南部内陆的偏远沙漠区域，几乎全为未开发的开阔土地。投资价值仅限于远期囤地、等待未来总体规划。距迪拜市中心约 40km。'))
WHERE name = 'Grayteesah';

UPDATE dubai_areas SET
  description = 'Hadaeq Sheikh Mohammed Bin Rashid — better known as Mohammed Bin Rashid (MBR) City — is one of Dubai''s most prestigious master-planned districts, home to District One, Crystal Lagoon villas and high-end apartments minutes from Downtown. It is a prime target for luxury capital-appreciation and premium rental strategies. ~5km to Downtown Dubai and Burj Khalifa.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Hadaeq Sheikh Mohammed Bin Rashid — better known as Mohammed Bin Rashid (MBR) City — is one of Dubai''s most prestigious master-planned districts, home to District One, Crystal Lagoon villas and high-end apartments minutes from Downtown. It is a prime target for luxury capital-appreciation and premium rental strategies. ~5km to Downtown Dubai and Burj Khalifa.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','谢赫穆罕默德·本·拉希德花园区','description','谢赫穆罕默德·本·拉希德花园区，即著名的穆罕默德·本·拉希德城（MBR City），是迪拜最高端的总体规划片区之一，坐拥 District One、水晶泻湖别墅与高端公寓，距市中心仅数分钟。是奢华增值与高端租赁策略的核心标的。距迪拜市中心及哈利法塔约 5km。'))
WHERE name = 'Hadaeq Sheikh Mohammed Bin Rashid';

UPDATE dubai_areas SET
  description = 'Hatta is a mountain exclave of Dubai in the Hajar Mountains, prized for eco-tourism, the Hatta Dam, hiking and weekend resorts rather than mainstream residential investment. Opportunities centre on holiday homes, hospitality and government-backed tourism development. ~130km east of Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Hatta is a mountain exclave of Dubai in the Hajar Mountains, prized for eco-tourism, the Hatta Dam, hiking and weekend resorts rather than mainstream residential investment. Opportunities centre on holiday homes, hospitality and government-backed tourism development. ~130km east of Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','哈塔','description','哈塔是迪拜位于哈贾尔山脉中的山区飞地，以生态旅游、哈塔水坝、徒步和周末度假闻名，而非主流住宅投资。机会集中在度假屋、酒店业及政府主导的旅游开发。位于迪拜市中心以东约 130km。'))
WHERE name = 'Hatta';

UPDATE dubai_areas SET
  description = 'Hessyan First is an emerging district near Jebel Ali and the Expo / Dubai South corridor, transitioning from industrial land toward new master-planned development. It suits investors positioning early in a growth corridor backed by major infrastructure. ~15km to Expo City, ~20km to Al Maktoum International Airport.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Hessyan First is an emerging district near Jebel Ali and the Expo / Dubai South corridor, transitioning from industrial land toward new master-planned development. It suits investors positioning early in a growth corridor backed by major infrastructure. ~15km to Expo City, ~20km to Al Maktoum International Airport.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','赫西扬一区','description','赫西扬一区位于 Jebel Ali 与世博/迪拜南部走廊一带，正从工业用地向新的总体规划开发转型。适合提前卡位重大基建支撑的增长走廊的投资者。距世博城约 15km、阿勒马克图姆国际机场约 20km。'))
WHERE name = 'Hessyan First';

UPDATE dubai_areas SET
  description = 'Lehbab First is a red-desert district on Dubai''s southeastern outskirts, known for desert camps, dune-bashing and farmland rather than residential density. It is primarily a leisure and long-term land opportunity. ~30km from Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Lehbab First is a red-desert district on Dubai''s southeastern outskirts, known for desert camps, dune-bashing and farmland rather than residential density. It is primarily a leisure and long-term land opportunity. ~30km from Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','莱赫巴卜一区','description','莱赫巴卜一区是迪拜东南外围的红沙漠区域，以沙漠营地、冲沙和农地闻名，住宅密度低。主要是休闲与远期土地机会。距迪拜市中心约 30km。'))
WHERE name = 'Lehbab First';

UPDATE dubai_areas SET
  description = 'Madinat Hind 3 is an outlying district on the southern edge of Dubailand, currently open desert land earmarked for future low-density and master-planned growth. Value is driven by long-term development rather than present-day demand. ~35km from Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Madinat Hind 3 is an outlying district on the southern edge of Dubailand, currently open desert land earmarked for future low-density and master-planned growth. Value is driven by long-term development rather than present-day demand. ~35km from Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','欣德城三区','description','欣德城三区位于 Dubailand 南缘的外围区域，目前为开阔沙漠土地，规划用于未来低密度与总体开发。价值来自远期发展而非当前需求。距迪拜市中心约 35km。'))
WHERE name = 'Madinat Hind 3';

UPDATE dubai_areas SET
  description = 'Madinat Hind 4 lies on the far southern fringe of Dubailand, comprising open desert land positioned for long-horizon master-planned expansion. It is a speculative land-banking play rather than an income asset. ~37km from Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Madinat Hind 4 lies on the far southern fringe of Dubailand, comprising open desert land positioned for long-horizon master-planned expansion. It is a speculative land-banking play rather than an income asset. ~37km from Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','欣德城四区','description','欣德城四区位于 Dubailand 最南缘，多为开阔沙漠土地，面向远期总体规划扩张。属于投机性囤地，而非现金流资产。距迪拜市中心约 37km。'))
WHERE name = 'Madinat Hind 4';

UPDATE dubai_areas SET
  description = 'Margham is a remote desert district in Dubai''s interior, known mainly for its gas fields and vast open land with negligible residential development. It holds value only for very long-term strategic land plays. ~50km from Downtown Dubai.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Margham is a remote desert district in Dubai''s interior, known mainly for its gas fields and vast open land with negligible residential development. It holds value only for very long-term strategic land plays. ~50km from Downtown Dubai.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','马尔加姆','description','马尔加姆是迪拜内陆的偏远沙漠区域，主要以天然气田和大片开阔土地著称，几乎无住宅开发。仅对极长期的战略性土地投资具价值。距迪拜市中心约 50km。'))
WHERE name = 'Margham';

UPDATE dubai_areas SET
  description = 'Wadi Al Safa 3 is part of the fast-growing Dubailand corridor, surrounded by popular villa communities such as Arabian Ranches and Villanova. It offers investors mid-market villa and townhouse stock with strong family-rental demand. ~25km to Downtown Dubai, ~20km to Expo City.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Wadi Al Safa 3 is part of the fast-growing Dubailand corridor, surrounded by popular villa communities such as Arabian Ranches and Villanova. It offers investors mid-market villa and townhouse stock with strong family-rental demand. ~25km to Downtown Dubai, ~20km to Expo City.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','瓦迪·萨法三区','description','瓦迪·萨法三区属于快速成长的 Dubailand 走廊，周边环绕 Arabian Ranches、Villanova 等热门别墅社区。为投资者提供中端别墅与联排房源，家庭租赁需求旺盛。距迪拜市中心约 25km、世博城约 20km。'))
WHERE name = 'Wadi Al Safa 3';

UPDATE dubai_areas SET
  description = 'Wadi Al Safa 7 sits in the heart of the Dubailand growth corridor near Town Square and Arabian Ranches, an area of expanding affordable villa and townhouse communities. It appeals to investors chasing capital growth and family-rental yield in a maturing suburb. ~28km to Downtown Dubai, ~18km to Expo City.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','Wadi Al Safa 7 sits in the heart of the Dubailand growth corridor near Town Square and Arabian Ranches, an area of expanding affordable villa and townhouse communities. It appeals to investors chasing capital growth and family-rental yield in a maturing suburb. ~28km to Downtown Dubai, ~18km to Expo City.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','瓦迪·萨法七区','description','瓦迪·萨法七区位于 Dubailand 增长走廊核心，邻近 Town Square 与 Arabian Ranches，是亲民别墅与联排社区快速扩张的区域。适合在成熟中的近郊追逐增值与家庭租赁回报的投资者。距迪拜市中心约 28km、世博城约 18km。'))
WHERE name = 'Wadi Al Safa 7';

UPDATE dubai_areas SET
  description = 'The World Islands are an archipelago of man-made islands off Dubai''s coast shaped like a world map, home to ultra-luxury resorts and waterfront villa projects such as The Heart of Europe. It is a niche, high-ticket play centred on hospitality and trophy second-homes. ~4km offshore from Jumeirah, reached by boat.',
  translations = COALESCE(translations,'{}'::jsonb)
    || jsonb_build_object('en', COALESCE(translations->'en','{}'::jsonb) || jsonb_build_object('description','The World Islands are an archipelago of man-made islands off Dubai''s coast shaped like a world map, home to ultra-luxury resorts and waterfront villa projects such as The Heart of Europe. It is a niche, high-ticket play centred on hospitality and trophy second-homes. ~4km offshore from Jumeirah, reached by boat.'))
    || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','世界群岛','description','世界群岛是迪拜近海一组形似世界地图的人工岛屿，坐拥 The Heart of Europe 等超豪华度假村与滨水别墅项目。属于小众高门槛投资，聚焦酒店业与标志性度假豪宅。距朱美拉海岸约 4km，需乘船抵达。'))
WHERE name = 'World Islands';

-- =====================================================================
-- GROUP B: 19 areas that already have a Chinese description.
-- Only add translations.zh.name (preserve existing zh.description).
-- =====================================================================

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','阿布扎比国际机场'))
WHERE name = 'Abu Dhabi International Airport';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','沙漠区及劳工营'))
WHERE name = 'Desert Area & Labor camp';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','本地城区（外国人不可购）'))
WHERE name = 'downtown&local area 外国人无法买卖';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','法希德岛（高端公寓别墅区）'))
WHERE name = 'Fahid Island（luxury apartment & Villa area）';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','法希德岛（高端海景公寓别墅区）'))
WHERE name = 'Fahid island (高端海景公寓&别墅区)';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','胡代里亚特岛（Modon 豪华别墅公寓）'))
WHERE name = 'Hudayriat island （Modon luxury villa and apartment）';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','朱拜勒岛（豪华别墅区）'))
WHERE name = 'Jubail Island (luxury villa area)';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','哈利法城（本地别墅住宅区）'))
WHERE name = 'Khalifa City (Local villa residential area)';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','本地别墅住宅区'))
WHERE name = 'Local villa residential area';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','马里亚岛（ADGM 阿布扎比金融中心）'))
WHERE name = 'Maryah island (ADGM Abu Dhabi Finacial center)';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','马斯达尔城'))
WHERE name = 'Masdar city';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','拉哈海滩'))
WHERE name = 'RAHA Beach';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','里姆岛（金融中心外溢区）'))
WHERE name = 'Reem island (finacial center spill area)';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','萨迪亚特岛（文化宝岛）'))
WHERE name = 'Sadidyat Ialand （文化宝岛）';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','沙赫布特城'))
WHERE name = 'Shakhbout City';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','亚斯岛'))
WHERE name = 'Yas island';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','亚斯岛（娱乐岛）'))
WHERE name = 'Yas Island（亚斯娱乐岛）';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','扎耶德城'))
WHERE name = 'Zayad City';

UPDATE dubai_areas SET
  translations = COALESCE(translations,'{}'::jsonb) || jsonb_build_object('zh', COALESCE(translations->'zh','{}'::jsonb) || jsonb_build_object('name','扎耶德港（港口免税区）'))
WHERE name = 'Zayed Port 港口免税区';

COMMIT;
