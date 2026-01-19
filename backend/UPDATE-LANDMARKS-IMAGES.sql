-- ============================================================================
-- 更新现有地标的照片URL
-- 将Unsplash照片添加到数据库中
-- ============================================================================

-- 更新 Burj Khalifa（哈利法塔）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1582672060674-bc2bd808a8b5?w=400&h=400&fit=crop'
WHERE name = 'Burj Khalifa';

-- 更新 Burj Al Arab（帆船酒店）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=400&h=400&fit=crop'
WHERE name = 'Burj Al Arab';

-- 更新 Dubai Mall（迪拜购物中心）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1567449303183-3e2e3e8ae753?w=400&h=400&fit=crop'
WHERE name = 'Dubai Mall';

-- 更新 Museum of the Future（未来博物馆）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1645906883260-9e08e0f7a08a?w=400&h=400&fit=crop'
WHERE name = 'Museum of the Future';

-- 更新 Mall of the Emirates（阿联酋购物中心）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=400&h=400&fit=crop'
WHERE name = 'Mall of the Emirates';

-- 更新 Jumeirah Beach（朱美拉海滩）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400&h=400&fit=crop'
WHERE name = 'Jumeirah Beach';

-- 更新 Kite Beach（风筝海滩）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1590523741831-ab7e8b8f9c7f?w=400&h=400&fit=crop'
WHERE name = 'Kite Beach';

-- 更新 Dubai Opera（迪拜歌剧院）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1545128485-c400e7702796?w=400&h=400&fit=crop'
WHERE name = 'Dubai Opera';

-- 更新 Dubai Fountain（迪拜喷泉）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1518684079-3c830dcef090?w=400&h=400&fit=crop'
WHERE name = 'Dubai Fountain';

-- 更新 La Mer
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1580674285054-bed31e145f59?w=400&h=400&fit=crop'
WHERE name = 'La Mer';

-- 更新 Dubai International Airport（迪拜国际机场）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&h=400&fit=crop'
WHERE name = 'Dubai International Airport';

-- 更新 Dubai Marina Mall（迪拜码头购物中心）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1518632089693-17fe5d935c9e?w=400&h=400&fit=crop'
WHERE name = 'Dubai Marina Mall';

-- 更新 Zabeel Park（扎比尔公园）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=400&h=400&fit=crop'
WHERE name = 'Zabeel Park';

-- 更新 Global Village（全球村）
UPDATE dubai_landmarks 
SET image_url = 'https://images.unsplash.com/photo-1533094602577-198d3beab8ea?w=400&h=400&fit=crop'
WHERE name = 'Global Village';

-- 验证更新
SELECT name, image_url 
FROM dubai_landmarks 
WHERE image_url IS NOT NULL
ORDER BY name;

-- 统计
SELECT 
    COUNT(*) as total_landmarks,
    COUNT(image_url) as landmarks_with_images,
    ROUND(COUNT(image_url)::numeric / COUNT(*)::numeric * 100, 2) as percentage
FROM dubai_landmarks;
