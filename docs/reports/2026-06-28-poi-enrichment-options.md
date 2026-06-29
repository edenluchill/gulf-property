# POI 体验优化调研与方案 — 2026-06-28

## 触发
用户在 pinzos.com 地图点击 POI(示例:GEMS World Academy,类型 School),弹窗只显示名称 + 类型标签 + "导航前往" + "关闭"。无照片、无评分、无介绍。疑问:是没数据还是没显示?如何从客户视角优化?

## 结论:是「没数据」,不是「没显示」

POI 数据全部来自 OpenStreetMap (OSM),经 Overpass API 抓取导入。`dubai_pois` 表字段:
`name, name_ar, location, category, subcategory, address, phone, website, osm_id, osm_type, data_source, created_at`

**缺失字段**:rating、photo/image、description、opening_hours、reviews。
三处一致缺失(数据库表 → API 返回 → 前端 `Poi` 接口),弹窗自然无内容可渲染。OSM 本质是地理底图,不提供结构化评分/照片。

### 关键文件
| 功能 | 路径 |
|---|---|
| POI 弹窗 JSX(移动+桌面内联) | `frontend/src/pages/MapPage.tsx` (1498-1697) |
| POI 数据类型 `Poi` + 23 类型定义 | `frontend/src/hooks/useDubaiPois.ts` |
| 后端 API 路由(/all、bbox、/near) | `backend/src/routes/dubai-pois.ts` |
| 数据库表 | `backend/src/db/dubai-pois-schema.sql` |
| OSM 导入脚本 | `backend/scripts/import-osm-pois-from-file.ts` |
| 地标 3D 扣图(与 POI 独立,仅 15 个著名地标) | `backend/scripts/gen-landmarks.js` |

### 支持的 23 种 POI 类型(7 大类)
- Healthcare: hospital, clinic, pharmacy
- Education: school, university
- Shopping: mall, supermarket
- Dining: restaurant, cafe
- Finance: bank, atm
- Leisure: hotel, park, gym, beach, cinema
- Services: gas_station, mosque, church, police, fire_station, post_office, embassy

## 客户视角:价值判断
- 迪拜买家(尤其华人家庭)**学校是头号选房因子**。
- 迪拜有 **KHDA 官方学校评级**(Outstanding / Very Good / Good / Acceptable / Weak),每年政府督导,家长择校核心依据。竞品(Bayut 等)未把 KHDA 与地图打通 → 真正差异化卖点。
- 医院/商场:Google 照片 + 评分 + 营业时间已足够提升信任感。

## 数据来源方案对比
| 方案 | 拿到什么 | 成本 | 风险/约束 |
|---|---|---|---|
| A. Google Places 懒加载(点击时取,后端代理 + 短缓存) | 照片、星级、评论数、营业时间、editorial summary | 按被点击 POI 计费,极低(绝大多数 POI 无人点) | Google ToS 禁长期缓存照片/评分 → 24h 短缓存 + 标注 "powered by Google";需 place_id 匹配 |
| B. KHDA 学校官方评级 + Google 补充 | 学校官方评级、课程体系、学费、语言;照片走 Google | KHDA 公开数据,主要是抓取/匹配工程量 | 仅覆盖学校;医院/商场仍依赖 Google |
| C. 纯 AI(Gemini)生成介绍 | 一两句中性介绍文字 | 近乎免费 | 无真实评分/照片;有杜撰风险,仅作兜底文案 |

## 推荐:分层组合
1. **重点 POI(学校/医院/商场)**:Google Places 懒加载 → 照片 + 评分 + 营业时间。
2. **学校额外叠加**:KHDA 官方评级(差异化核心)。
3. **其余小 POI**:维持现状,或 C 兜底一句 AI 介绍。

懒加载只为真正被点开的 POI 付费,几乎零成本即可让体验"活"起来,且天然规避 ToS 长期缓存问题。

## 实施轮廓(待方向确认后细化为 spec)
1. 后端新增 `GET /api/dubai-pois/:id/details` 懒加载端点:首次匹配 Google place_id 持久化,调用 Place Details + Photos,结果写入短缓存表(24h TTL)。
2. (学校)KHDA 评级:一次性抓取 → 落 `dubai_pois` 新增列或关联表,按 name 匹配。
3. 前端 `Poi` 详情态 + 弹窗:点击后 fetch details,展示照片 banner / 评分星 / KHDA 徽章 / 营业时间 / 介绍;加载骨架屏。
4. 合规:Google 数据标注来源,缓存 ≤ 内容字段 ToS 上限。

## 待用户确认
- 数据方案(A / B / 组合 / C)
- 优先 POI 类型范围(只做学校+医院,还是全部重点类型)
- Google Places API key 是否已有 / 预算态度
