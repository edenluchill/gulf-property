# 实时协作地图 + AI 地图导览：竞争环境评估（坏消息优先版）

日期：2026-07-18 ｜ 评估对象：A) 实时协作空间会话  B) AI 生成电影感地图导览

## 结论先行

- A（多人光标/标注/相机同步 + 语音视频）**不是一个品类，是一个已被商品化的功能**。Liveblocks 等 SDK $25/月即可加上；Felt/Atlas 已把它当默认能力。
- B（AI 生成地图动画视频）**2026 年已至少 3 家专做**（mapanimation.io / animaps.ai / mapimator），且上游有 Google Earth Studio（免费）、Mapbox Storytelling（开源）、ArcGIS StoryMaps；房产侧 AI 视频已跌到 $2.90/条。
- 该品类**反复有人做、反复失败**：Placemark(2023 关停)、Mapzen(2018)、Mapbox(SPAC 失败+大裁员)、Remine($53.5M→$1.5M)、Spatial.io(2026 关停 3D 协作)。
- **独立产品生存空间：小。置信度 ~85%。** 作为垂直 SaaS（迪拜期房经纪）里的差异化功能：可行，但价值来自 DLD 数据 + CRM 工作流 + 分销，不来自地图技术本身。

## 1. 实时协作地图：谁在做

| 产品 | 定价 | 定位 | 融资 |
|---|---|---|---|
| Felt | Team $200/月起（$2,400/年，3 editors） | "Figma for maps"，现主打能源/公用事业垂直 | $19.5M，2025-07 拿 $15M；44 人 |
| Atlas.co | Free / $39 per user/月 / $89 per user/月 | AI-native GIS，实时多人编辑为卖点 | 未披露 |
| Maptive | $1,250/年（个人）/ $2,500/年（团队） | 扁平定价 | — |
| Atlist | 第一个成员免费，+$5/人/月，views $0.009/次 | 嵌入式地图 | — |
| GISOwl | 扁平价（10 人团队 $15 vs Felt $250） | 明确打价格战 | — |
| Google My Maps | 免费 | 低端吸走一切 | — |

要点：实时多人协作已经是**默认功能**，不是卖点。Atlas 甚至把它写成一篇 "Introducing: Collaborate in Real-Time" 博客后就当基础能力。价格带从免费到 $200/月全被占满，且新进者（GISOwl）在用 1/16 的价格砸。

## 2. AI 地图导览视频：谁在做

- mapanimation.io — 文字 prompt → 完整脚本化定时地图动画，3 条免费，商用授权无版税。**无语音解说**。
- animaps.ai — 29 种动画类型、67,000+ 地点库、含卫星样式，按渲染扣 credit，宣称比 freelancer($50-500) 便宜 300 倍。**无语音解说**。
- mapimator.com — "AI Director" 从纯文本生成路线/标记/运镜，4K 导出。
- Google Earth Studio — **免费**，卫星影像 + 3D flyover + 相机路径。
- Mapbox Storytelling — 开源模板，scroll-driven 3D 运镜。
- ArcGIS StoryMaps — Esri 免费/捆绑，政府/教育/企业主力。
- 房产侧 AI 视频：VideoTour.AI **$2.90/条**、DroneView AI $15 起、MeltFlex <2 欧/房间、AutoReel、PhotoAIVideo。

结论：B 的"AI 生成 + 运镜"部分已被抄平。**唯一还没被这批工具覆盖的是：语音解说 + 数据浮层 + 异步分享链接的组合**——这是缝隙，不是护城河。

## 3. 死亡名单（重点）

- **Placemark**（2023-11 关停，2024-01 开源）。创始人 Tom MacWright 原话：高端被 Esri 锁定、低端被 Google/QGIS 免费补贴，中间层用户期望"analytics、editing、social features 全都要且要简单"，无法组合成简单产品。他自评最大错误是做通用产品而非"一个行业里的一类具体客户"。并指出地理空间**至今没有 Notion/Figma 级别的成功案例**。
- **Mapzen**（2018-01 关停）。全开源、有顶级团队、有 Samsung 输血，仍然关。
- **Mapbox**：SoftBank 2017 投 $164M（事后看"钱太多、期望太高"），2021 SPAC 失败，2020 两轮裁员，2023-01 一次裁 64 人。
- **Remine**：2021 年 4 家大 MLS 以 **$53.5M** 收购的地图化房产数据平台；2025-03 走 ABC 破产程序，**$1.5M** 被 Place 拍走。覆盖从 60 个市场 1.2M 经纪跌到 40 个市场 600K。**从未盈利**。
- **Spatial.io**：9 年做多人 3D 空间协作，2026 关掉 Creator 平台，理由是多人 3D 世界托管成本长期上涨，团队转去做 VR 游戏。同期 Rec Room 6/1 关停、Meta Horizon Worlds 转移动端。→ **"多人同处一个空间"这个卖点本身被市场验证为不足以支撑独立产品**。

## 4. 功能非产品风险：高

Google Maps Platform 2026 路线图明说：Gemini 驱动的 **"Ask Google Earth"** 自然语言查卫星/街景、KML/GeoJSON 导入做 "single source of truth"、把 Earth 定位为 **"a canvas for your geospatial storytelling"**、并推出**面向建成环境专业人士的新专业版套餐**。同时 Gemini Omni 已能生成 30-60 秒**带旁白的 narrated video overview**。

也就是说：A 的"单一真相源 + 多方对齐"和 B 的"带解说的地图叙事视频"，**两条都在 Google 2026 的公开路线图上**。Esri 侧 StoryMaps 已免费捆绑。

## 5. 判断

**作为独立产品：生存空间小，置信度 85%。**
理由：(1) 品类死亡率极高且死因一致——中间层没有支付意愿；(2) 两项能力都已被免费/极低价对手覆盖；(3) 两家平台巨头的 2026 路线图直接压过来。

**作为垂直 SaaS 的差异化功能：可行。**
但要清醒：付费理由是 **DLD 独家数据 + 经纪 CRM 工作流 + 分销/转介**，地图技术只是交付层。MacWright 的教训精确对应——不要做通用地图产品，要做"一个行业里一类具体客户"的产品。你已经在做后者，别退回前者。

**最危险的动作**：把 A 或 B 抽出来做通用 SaaS 卖给非房产客户。那是直接走进 Placemark 的死法。
