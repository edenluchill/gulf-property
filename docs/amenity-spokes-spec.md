# 功能说明:区域配套放射图(analyze_area_amenities)

## 目标
让语音助手 Luna 能在客户问「这个区域好不好 / 生活方便吗 / 离医院学校多远」时,
自动从区域中心向最近的 医院/学校/商场/地铁/超市 画带距离的连线,并给出
0–100 的生活便利度评分 + 等级,方便 AI 口语化描述地段优劣。

## 后端

### 工具 `analyze_area_amenities`
- 文件:`backend/src/services/voice-assistant-tools.ts`
- 参数:`area_name`(string,必填)
- 流程:
  1. `/api/ai/areas/match?q=` 解析区域中心点(复用 measure_distance 的解析)
  2. `/api/dubai-pois/near?lat&lng&radius=10000&categories=...` 取 10km 内 POI
  3. 每类取最近一个,haversine 算直线距离
  4. 加权衰减评分(见下),得 0–100 分 + 等级
- 返回:`result`(结构化)+ `summary`(中文,供 AI 朗读)+ `mapAction`(`amenity_spokes`)

### 评分模型(可调)
每类配套:距离 ≤ `ideal` km 得满分,到 `zero` km 线性降为 0,乘权重后求和 ×100。

| 配套 | category | ideal(km) | zero(km) | 权重 |
|------|----------|-----------|----------|------|
| 地铁 | metro_station | 1.5 | 5  | 0.25 |
| 医院 | hospital      | 2   | 10 | 0.20 |
| 学校 | school        | 1.5 | 6  | 0.20 |
| 商场 | mall          | 3   | 8  | 0.20 |
| 超市 | supermarket   | 1   | 4  | 0.15 |

等级:≥75 优秀 / ≥55 良好 / ≥35 一般 / 其余 偏远。

### 系统提示
`backend/src/routes/voice-token.ts` 增加触发规则 + 调用后如何口语描述
(先说总分等级,再挑 1–2 亮点引导客户)。

## 前端
- `hooks/voice-assistant/types.ts`:`MapAction` 增加 `amenity_spokes` + 字段
- `contexts/VoiceAssistantContext.tsx`:放行该 action 类型
- `pages/MapPage.tsx`:落数据 + 自动取景(中心+所有配套点 fitBounds)+ reset 清除;与手动测距互斥
- `components/MapViewMapLibre.tsx`:
  - 放射连线(琥珀虚线 `#f59e0b` + 沿线距离标签,字体 Open Sans Bold)
  - 中心绿点 `#059669` / 配套橙点 + 中心名标签
  - 左下便利度评分卡(等级配色 + 可 X 关闭),新数据来自动重新显示

## 部署
- 前端:push main → Cloudflare 自动
- **后端:需手动 `hetzner-deploy.ps1`** —— 工具与系统提示在后端,
  不部署后端则 Luna 不会调用该工具(前端只是接住 mapAction)

## 可迭代点
- POI 数据覆盖度依赖 `dubai_pois` 表;某区域缺类目则该项不计入(分母不变 → 分偏低,
  可改为「按命中类目归一化」让数据稀疏区不被低估)
- emoji 仅在 HTML 评分卡显示(地图字体不含 emoji,标签用纯文字)
- 评分权重/阈值为产品默认值,可按迪拜买家偏好调
- 后续可加:步行分钟数估算、公园/海滩等更多类目、点击连线高亮对应配套
