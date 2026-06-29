# POI 富化(照片/评分/介绍)实施 Spec — 全免费方案

> 起因:地图 POI 弹窗只有名称+类型+导航,无照片/评分/介绍。根因是数据库无此字段(数据源 OSM 不提供)。
> 约束(用户 2026-06-28 确认):**不用 Google**(贵 + ToS 禁缓存);要**几乎免费**;先覆盖**学校/大学 + 医院/诊所**。

## 数据规模(生产库实数)
| category | 数量 | 有 website | 有 name_ar |
|---|---|---|---|
| clinic | 339 | 62 | 15 |
| school | 216 | 46 | 56 |
| hospital | 87 | 27 | 18 |
| university | 53 | 23 | 15 |
| **合计** | **695** | | |

## 评分现实
- 真实星级评分只在 Google/TripAdvisor/Foursquare 等付费 API,无免费源。
- **学校/大学**:用 **KHDA 官方评级**(Outstanding/Very Good/Good/Acceptable/Weak),免费公开,迪拜家长择校核心 → 比 Google 星级更值钱,是差异化卖点。
- **医院/诊所**:无免费评分源 → 不放假星级,改放官方信息 + 介绍。

## 成本
- KHDA 抓取:$0(公开数据)
- Wikidata/维基百科:$0(免费 API,无需 key,照片 CC 可商用)
- Gemini 兜底介绍:695 个 × gemini-3-flash 一次性 ≈ 几美分~$1
- **关键**:免费源允许"一次性抓取、永久存库",无 Google ToS 的长期缓存禁令 → prefetch 不贵。

## 全免费数据栈
| POI | 评分 | 照片 | 介绍 |
|---|---|---|---|
| 学校/大学 | KHDA 官方评级 | Wikidata | Wikidata → 缺则 Gemini |
| 医院/诊所 | 无(放官方信息) | Wikidata | Wikidata → 缺则 Gemini |

---

## Phase 1 — 纯免费、高覆盖、零风险

### 1.1 DB:新增字段(`dubai_pois` 或关联表 `dubai_poi_enrichment`)
建议关联表(避免主表频繁改 + 便于重跑):
```sql
CREATE TABLE dubai_poi_enrichment (
  poi_id        UUID PRIMARY KEY REFERENCES dubai_pois(id) ON DELETE CASCADE,
  description    TEXT,             -- 介绍(中性,1-3 句)
  description_zh TEXT,             -- 中文介绍(目标客户)
  photo_url      TEXT,             -- Wikidata/Commons 图片 URL
  photo_credit   TEXT,             -- 图片来源/授权标注(CC 合规)
  opening_hours  TEXT,             -- 若 OSM/Wikidata 有
  source         VARCHAR(30),      -- 'wikidata' | 'gemini' | 'mixed'
  khda_rating    VARCHAR(20),      -- Phase 2 填:Outstanding/...
  khda_year      INT,
  khda_url       TEXT,
  updated_at     TIMESTAMPTZ DEFAULT now()
);
```

### 1.2 批处理脚本 `backend/scripts/enrich-pois.ts`
对 695 个目标 POI:
1. **Wikidata 匹配**:用 name(+ name_ar)+ 坐标半径,查 Wikidata SPARQL / `wbsearchentities`;命中取 image(P18)、描述、official website。图片转 Commons 缩略图 URL。
2. **Gemini 兜底**:无 Wikidata 命中者,gemini-3-flash 按 `name + category + area + address` 生成中性介绍(中英),提示词禁止编造评分/数字,只描述定位与特点。
3. 写入 `dubai_poi_enrichment`,记 source。可重跑(UPSERT)。

### 1.3 API:`backend/src/routes/dubai-pois.ts`
- `/all` 与 bbox/near 查询 LEFT JOIN enrichment,返回 description/photo_url 等(轻量字段)。
- 或新增 `GET /api/dubai-pois/:id/details` 懒加载详情(若 /all 体积顾虑)。

### 1.4 前端
- `frontend/src/hooks/useDubaiPois.ts`:`Poi` 接口加 `description?`、`description_zh?`、`photo_url?`、`photo_credit?`、`opening_hours?`、`khda_rating?`。
- `frontend/src/pages/MapPage.tsx`(1498-1697 弹窗,移动+桌面):
  - 顶部照片 banner(有则显示,无则保持现状色块)
  - 介绍段落(中文优先)
  - 营业时间(有则显示)
  - 图片来源标注(CC 合规)
  - 保留导航/电话/网站按钮
  - 加载骨架(若走懒加载端点)

## Wikipedia 匹配教训(Phase 1 踩坑)
迪拜 POI 常以**所在社区命名**(Al Qusais Health Centre / Al Nahda Polyclinic / Dr Joy Karama),
geosearch 近邻里就有该社区的 Wikipedia 条目,单 token(qusais/nahda/karama)含 area 名时
containment 得分=1.0 → **误配到区域条目**(照片是区域、Gemini 把介绍写成讲社区)。
两道防线:
1. normalize 把 `al/el` 当停用词去掉(迪拜版 "the")。
2. 抓 Wikidata 短描述(`pageterms`),命中 `community/neighbourhood/locality/metro/station/road...`
   → **判定为地点直接拒绝**,只认 "Hospital in Dubai" / "School in UAE" 这类机构描述。
原则:**宁缺毋滥**——照片稀疏但永远对,错图比无图更伤信任。

## Phase 2 — KHDA 学校评级(差异化,需先验证;调研已完成)
**评级为 6 档**(best→worst):Outstanding / Very Good / Good / Acceptable / Weak / **Very Weak**。
`khda_rating VARCHAR(20)` 已能容纳;前端 `getKhdaStyle()` 已实现 6 档配色+中文标签。

**数据源(调研结论):**
- ⭐ 首选 **Dubai Pulse** 开放数据集 `khda_private_schools_erc-open`,含 校名(EN/AR)/坐标/curriculum/
  overall rating/inspection year/enrollment/capacity/报告链接。
  - school_search.csv 直链:`https://www.dubaipulse.gov.ae/dataset/2ae67e78-833f-4638-9b6f-9f5a3f40ba44/resource/062647ff-ac22-4fe4-a1ab-cbbef6037c90/download/school_search.csv`
  - ⚠️ **仅 UAE IP 可达**(与 DDA 同坑,本机 ECONNREFUSED/证书错)→ **从迪拜盒子 curl**。
- Plan B(本机即可,静态 HTML,~200 校 6 档,无坐标需按名匹配):
  `https://whichschooladvisor.com/uae/school-news/the-complete-list-of-khda-ratings-for-dubai-private-schools-2026`
- 督导在 2024-25/25-26 **暂停**,现存为 2023-24 快照 → 入库存 `khda_year` 并在 UI 标注「截至 2023-24」。

**步骤:** 抓取 → 按 name 匹配 216 学校 + 53 大学(exact→strip→overlap)→ 写 `khda_rating/khda_year/khda_url`
→ 弹窗 KHDA 徽章(已在前端就位,等数据)。

## 部署
- 后端改完跑 `backend/quick-deploy.ps1`(改了 API 容器)。
- 批处理脚本本地直连生产库跑一次(写 enrichment 表)。
- 前端 push 自动 Cloudflare Pages 部署。

## 合规
- Wikidata/Commons 图片标注来源+授权(CC)。
- 无 Google 依赖 → 无 ToS 缓存问题。
- AI 介绍不含编造评分。
