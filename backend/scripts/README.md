# Dubai Areas Auto-Generation Scripts

## 📋 概述

这些脚本可以自动从 OpenStreetMap 获取迪拜区域的真实地理边界，并计算市场统计数据。

## 🚀 快速开始

### 1. 运行数据库迁移

首先添加统计字段到数据库：

```bash
# 进入后端目录
cd backend

# 运行迁移
psql -U your_username -d your_database -f db/migrations/add-dubai-areas-stats.sql
```

### 2. 生成区域边界数据

从 OpenStreetMap 获取真实的区域边界：

```bash
# 安装依赖（如果还没安装）
npm install axios

# 运行脚本
npx ts-node scripts/generate-dubai-areas.ts
```

**过程**:
- 脚本会从 Overpass API 获取 ~40 个迪拜主要区域的边界
- 每个请求间隔 2 秒（避免 API 限流）
- 预计耗时: 约 2-3 分钟
- 成功率: 通常 70-90%（部分区域可能在 OSM 中没有数据）

**输出示例**:
```
🚀 Starting Dubai Areas Generation from OpenStreetMap

📍 Total areas to fetch: 40

[1/40] Processing: Downtown Dubai
🔍 Fetching boundary for: Downtown Dubai...
   ✅ Found boundary for Downtown Dubai
   💾 Saved Downtown Dubai to database
   ⏳ Waiting 2 seconds...

[2/40] Processing: Dubai Marina
🔍 Fetching boundary for: Dubai Marina...
   ✅ Found boundary for Dubai Marina
   💾 Saved Dubai Marina to database
...

============================================================
📊 Summary:
   ✅ Success: 32
   ❌ Failed: 8
   📈 Success Rate: 80.0%
============================================================
```

### 3. 更新统计数据

计算并更新每个区域的市场统计：

```bash
# 使用区域名称匹配（推荐）
npx ts-node scripts/update-area-statistics.ts

# 或使用地理边界匹配（如果项目表有 location 字段）
npx ts-node scripts/update-area-statistics.ts --geo
```

**计算的统计数据**:
- ✅ `project_counts`: 从 `residential_projects` 表统计
- ✅ `average_price`: 从 `residential_projects.starting_price` 计算平均值
- ✅ `sales_volume`: 从 `residential_projects.starting_price` 计算总和
- ✅ `capital_appreciation`: 模拟数据（需要替换为真实数据源）
- ✅ `rental_yield`: 模拟数据（需要替换为真实数据源）

**输出示例**:
```
🚀 Starting Dubai Areas Statistics Update

📊 Found 32 areas to process

📍 Processing: Downtown Dubai
   📈 Projects: 15
   💰 Avg Price: 2,450,000 AED
   💵 Sales Volume: 36,750,000 AED
   📊 Capital Appreciation: 8.5%
   🏠 Rental Yield: 5.2%
   ✅ Updated

📍 Processing: Dubai Marina
   📈 Projects: 23
   💰 Avg Price: 1,850,000 AED
   💵 Sales Volume: 42,550,000 AED
   📊 Capital Appreciation: 7.8%
   🏠 Rental Yield: 6.1%
   ✅ Updated
...

============================================================
✨ Successfully updated 32 areas
============================================================
```

## 📊 API 使用

更新后的 API 现在返回统计数据：

### GET /api/dubai/areas

```json
{
  "id": "uuid",
  "name": "Downtown Dubai",
  "nameAr": "وسط مدينة دبي",
  "boundary": {
    "type": "Polygon",
    "coordinates": [[...]]
  },
  "areaType": "mixed",
  "wealthLevel": "luxury",
  "description": "Heart of Dubai...",
  "color": "#FFD700",
  "opacity": 0.35,
  
  // 新增统计字段 ⭐
  "projectCounts": 15,
  "averagePrice": 2450000,
  "salesVolume": 36750000,
  "capitalAppreciation": 8.5,
  "rentalYield": 5.2
}
```

### PUT /api/dubai/areas/:id

现在可以手动更新统计数据：

```bash
curl -X PUT http://localhost:3000/api/dubai/areas/{id} \
  -H "Content-Type: application/json" \
  -d '{
    "projectCounts": 20,
    "averagePrice": 2500000,
    "salesVolume": 50000000,
    "capitalAppreciation": 9.0,
    "rentalYield": 5.5
  }'
```

## 🔧 自定义配置

### 修改区域列表

编辑 `generate-dubai-areas.ts`:

```typescript
const DUBAI_AREAS = [
  'Downtown Dubai',
  'Dubai Marina',
  'Your Custom Area',  // 添加你想要的区域
  // ...
]
```

### 修改市场数据

编辑 `update-area-statistics.ts`:

```typescript
const MARKET_DATA: Record<string, {...}> = {
  'Downtown Dubai': { 
    capitalAppreciation: 8.5,  // 修改为真实数据
    rentalYield: 5.2 
  },
  // ...
}
```

### 修改区域样式

编辑 `generate-dubai-areas.ts`:

```typescript
const AREA_TYPE_MAP = {
  'Downtown Dubai': { 
    areaType: 'mixed', 
    wealthLevel: 'luxury', 
    color: '#FFD700',      // 修改颜色
    opacity: 0.35          // 修改透明度
  },
  // ...
}
```

## 📅 定时任务

建议设置定时任务每天更新统计数据：

### Linux/Mac (crontab)

```bash
# 编辑 crontab
crontab -e

# 添加定时任务（每天凌晨 2 点运行）
0 2 * * * cd /path/to/backend && npx ts-node scripts/update-area-statistics.ts >> /var/log/dubai-stats.log 2>&1
```

### Windows (Task Scheduler)

1. 打开任务计划程序
2. 创建基本任务
3. 设置触发器: 每天
4. 设置操作: 运行程序
   - 程序: `npx`
   - 参数: `ts-node scripts/update-area-statistics.ts`
   - 起始于: `C:\path\to\backend`

### PM2 (Node.js 进程管理)

```bash
# 安装 PM2
npm install -g pm2

# 创建定时任务
pm2 start scripts/update-area-statistics.ts --name "dubai-stats" --cron "0 2 * * *"
```

## 🔍 故障排除

### 问题 1: Overpass API 超时

**错误**: `Error: timeout of 60000ms exceeded`

**解决**:
- 增加超时时间 (在脚本中修改 `timeout: 120000`)
- 减少一次性获取的区域数量
- 使用不同的 Overpass API 镜像

### 问题 2: 某些区域找不到边界

**原因**: OSM 中可能没有该区域的数据，或名称不匹配

**解决**:
1. 在 https://www.openstreetmap.org 搜索该区域
2. 确认 OSM 中的准确名称
3. 更新脚本中的区域名称
4. 或手动在编辑器中绘制边界

### 问题 3: 统计数据不准确

**原因**: `residential_projects.area` 字段与 `dubai_areas.name` 不完全匹配

**解决**:
- 检查数据库中的区域名称是否一致
- 使用 `--geo` 参数进行地理匹配（需要项目有 location 字段）
- 手动标准化区域名称

## 📚 相关资源

- [Overpass API 文档](https://wiki.openstreetmap.org/wiki/Overpass_API)
- [OpenStreetMap Wiki](https://wiki.openstreetmap.org/)
- [GeoJSON 规范](https://geojson.org/)
- [PostGIS 文档](https://postgis.net/documentation/)

## 🎯 下一步

1. **获取真实市场数据**
   - 集成 Property Finder / Bayut API
   - 集成迪拜土地部门数据
   - 使用第三方房地产数据提供商

2. **改进边界数据**
   - 手动调整不准确的边界
   - 添加更多细分区域
   - 处理重叠区域

3. **自动化更新**
   - 设置定时任务
   - 添加数据验证
   - 发送更新通知

4. **可视化优化**
   - 根据统计数据动态调整颜色
   - 添加热力图层
   - 实现区域对比功能
