-- 客户反馈的区域中文名修正 (2026-06-11)
-- translations 是 JSONB: {"zh": {"name": "..."}}
-- 用 jsonb_set 只改 zh.name,保留其他语言

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"云溪港"', true)
WHERE name = 'Dubai Creek Harbour';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"首霸哈特兰"', true)
WHERE name = 'Sobha Heartland';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"首霸哈特兰二期"', true)
WHERE name = 'Sobha Hartland 2';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"首霸圣殿"', true)
WHERE name = 'Scantury Sobha';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"阿拉伯山庄一期"', true)
WHERE name = 'Arabian Ranches 1';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"阿拉伯山庄二期"', true)
WHERE name = 'Arabian Ranches 2';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"阿拉伯山庄三期"', true)
WHERE name = 'Arabian Ranches 3';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"达马克水晶湖"', true)
WHERE name = 'Damac lagoons';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"王子岛"', true)
WHERE name = 'Beach front by Emaar';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"德拉老城区"', true)
WHERE name = 'Deira';

-- Maydan 系列: 梅丹 → 美丹
UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"阿齐兹美丹河畔"', true)
WHERE name = 'Azizi Rivera at Maydan One';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"美丹一区西"', true)
WHERE name = 'Maydan Distrct One West';

UPDATE dubai_areas SET translations = jsonb_set(COALESCE(translations, '{}'::jsonb), '{zh,name}', '"MBR十一区（美丹南）"', true)
WHERE name = 'MBR District11 (Medan South)';

-- 验证
SELECT name, translations->'zh'->>'name' AS zh
FROM dubai_areas
WHERE name IN (
  'Dubai Creek Harbour','Sobha Heartland','Sobha Hartland 2','Scantury Sobha',
  'Arabian Ranches 1','Arabian Ranches 2','Arabian Ranches 3','Damac lagoons',
  'Beach front by Emaar','Deira','Azizi Rivera at Maydan One',
  'Maydan Distrct One West','MBR District11 (Medan South)'
)
ORDER BY name;
