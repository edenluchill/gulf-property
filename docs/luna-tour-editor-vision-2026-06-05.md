# Luna Tour — 编辑/创作能力 愿景 + 落地计划(2026-06-05)

> 来源:真机验收后,用户提出下一阶段方向 —— 从"能看的 demo"进化为"经纪能创作、客户能验证"的工具。
> 本文 = 战略判断 + TourScript v2→v3 模型扩展 + DB 新表 + 分阶段路线。代码纪律仍遵守 `luna-tour-progress.md`(隔离、`lt_` 前缀、可删除)。

## 0. 核心论点

- **当前 = 震撼 demo;下一步 = 可被验证的投资顾问工具。** 质变点在**可信度**。
- **护城河 = 证据可溯源**。我们手里有竞品没有的弹药:**`dld_transactions` 150 万条真实迪拜土地局成交(最新 2026-05-17)** + `dld_rent_contracts`。客户能当场点链接核验每个数字 → "营销片"变"决策工具"。
- 三维度是一条价值链:**编辑(③)是经纪表达意图的入口 → 驱动内容(①)与自由度(②)的生产**。一起设计,分阶段交付。

## 1. 三个维度(用户原话 + 设计)

### ① 内容丰富度(证据优先)
- **数据皆带出处**:屏幕上每个数字(价格/ROI/成交量/距离)挂 `source { label, url, as_of }`,客户点「核验 →」。
- **真实成交证据**(`dld_transactions`):"该楼盘/区域近 30 天成交 N 套、中位 ㎡价 AED X、可比成交列表"。全部可溯源到 DLD。
- **媒体嵌入**:海景/室内/配套视频(经纪上传 R2 或外链 YouTube/Vimeo),`media` overlay,**预加载防卡顿**。

### ② 自由度(地点叙事)
- `act`(绑 `property_id`)→ 泛化为 **stop**(房源 | 海滩 | 学校 | 商场 | 地标 | 观景点)。引擎已能飞任意坐标;缺脚本模型 + 生成器 + 编辑器对非房源停靠点的支持。
- 路线/路径:"距海滩 5 分钟车程"可画路线。
- 价值:"海滩→码头→学区→你的家"的社区故事 >> 3 个房源转圈。海滩 stop + 海景视频 = ①+② 合体。

### ③ 编辑度(评论驱动 AI 改稿 = 杀手级)
- **生成简单**(已有:一句话→AI 生成)。
- **预览时暂停 → 留 comment → AI 应用**:评论锚定时间轴(`beat_id` + `at_ms`)。"这段太长/强调海景/这个数字应是X/这里加视频" → AI 只改受影响 beat + 只重生成那段音频。
- **手动故事板**:改旁白/重排/删/加 stop/换媒体/直接地图摆位捕捉镜头/开关数据卡。
- **直接操纵镜头**:摆好地图一键「设为此 beat 视角」。

## 2. 用户可能漏掉的(已纳入计划)

1. **合规/免责**:投资预测(RERA/广告法)需免责声明。可信 ≠ 越界承诺;证据层配免责。
2. **分析→编辑闭环**:`lt_engagement_events` 已有遥测 → "第3段流失"反馈经纪并建议改。
3. **版本/撤销**:编辑自由度高必须能回滚 → `lt_tour_scripts` 存版本。
4. **多语言**:EN/ZH/RU/AR 按客户语言生成 tour+音频(规模化关键)。
5. **可验证 fact-sheet 导出**:带出处的事实清单(PDF/链接),信任工具 + 强 lead 钩子。
6. **视频性能护栏**:视频不得破坏运镜(预加载、与单时钟引擎协调,遵守 perf rules)。
7. **成本计量**:视频 R2 出流量 + 每次 AI 改稿调用成本 → `lt_usage_counters`。

## 3. 模型扩展(TourScript v2 → v3,向后兼容)

> 原则:新增字段 optional,旧脚本仍能播;`stop` 是 `act` 的超集。

```jsonc
// 顶层:acts → stops(act 仍可用,内部映射为 kind:'property' 的 stop)
{
  "version": 3,
  "stops": [
    {
      "id": "stop-1",
      "kind": "property" | "place",
      "property_id": "uuid|null",        // place 时为 null
      "place": { "name": "JBR 海滩", "coords": [lng,lat], "category": "beach" }, // place 专用
      "beats": [ /* Beat v3 */ ],
      "transition_out": { "type": "flyover", "duration_ms": 2500 }
    }
  ]
}

// Beat v3:新增 media + evidence overlay;narration 不变
// Overlay 新增:
{ "type": "media", "at_ms": 0, "duration_ms": 8000,
  "media_kind": "video"|"image", "url": "r2://...|https://youtube...",
  "fit": "cover"|"contain", "muted": true, "caption": "实拍海景" }

{ "type": "evidence", "at_ms": 0, "duration_ms": 9000,
  "claim": "近30天本区成交 42 套,中位 1,850 AED/sqft",
  "metric": "sales_volume_30d"|"median_psf"|"comparable"|...,
  "value": { /* 结构化 */ },
  "source": { "label": "Dubai Land Department", "url": "https://...", "as_of": "2026-05" },
  "disclaimer": "历史成交不代表未来表现" }
```

- 现有 overlay(property_card/roi_card/amenity_spokes/distance_line/cta…)统一可挂 optional `source`。
- 前端 `types.ts` + 引擎 `OverlayLayer`/`mapTourHandle` 加 `media`/`evidence` 渲染;媒体走预加载。

## 4. DB 新表(均 `lt_` 前缀,teardown 可删)

- `lt_media_assets`(经纪上传的视频/图:session_id, beat_id, kind, r2_key, url, status, bytes, duration_ms)。
- `lt_edit_comments`(预览评论:session_id, beat_id, at_ms, body, status[open/applied/dismissed], created_by, created_at)。
- `lt_tour_script_versions`(版本快照:script_id, version_no, script jsonb, note, created_at)——撤销/回滚。
- 复用 `lt_usage_counters` 计 AI 改稿次数 + 媒体存储/出流量。
- 证据数据**读** `dld_transactions`/`dld_rent_contracts`(只读,不复制)。

## 5. 后端能力

- **证据服务** `evidence.ts`:`getMarketEvidence(area|project, window)` → 近 N 天成交量/中位㎡价/可比成交,带 source+as_of。基于 `dld_transactions`。
- **媒体上传** `POST /api/luna/agent/media`(复用 `uploadBufferToR2`,放开 video/mp4 + 大小上限;校验类型)。外链则只存 URL。
- **评论** CRUD `POST/GET/PATCH /sessions/:id/comments`。
- **AI 改稿** `POST /sessions/:id/revise`:收集 open comments + 当前 script → Gemini 结构化输出**仅受影响 beat 的 patch** → 校验 → 写新版本 → 只重生成受影响 beat 音频(复用 audio-pipeline 的单 beat 合成)。
- **逐 beat 重生成** `POST /sessions/:id/beats/:beatId/regen`。
- **版本** `GET /sessions/:id/versions` + `POST .../revert`。

## 6. 前端

- **故事板编辑器**(`/agent/tour/:id/edit`):stop/beat 列表(拖拽重排)、改旁白、加/删 stop(房源 picker + 地点 picker 复用 POI/geocode)、挂媒体、开关数据卡、地图摆位捕捉镜头、每段「重生成」。
- **预览+评论**(复用 `TourOverlay`,加编辑层):播放中暂停→评论框(锚 beat+at_ms)→评论列表→「用 AI 应用全部评论」。
- **证据/媒体渲染**:`OverlayLayer` 加 `evidence` 卡(数字+出处+核验链接+免责)与 `media`(视频/图,预加载)。

## 7. 分阶段路线(建议顺序)

- **E1 证据层(护城河,数据已就绪)**:`evidence.ts`(DLD 近30天成交量+中位㎡价+可比) → `evidence` overlay + 现有数据卡挂 source/核验链接 + 免责。**最高战略价值,相对独立。**
- **E2 评论驱动 AI 改稿**:`lt_edit_comments` + 预览评论 UI + `/revise`(单 beat patch + 单段音频) + 版本表。**编辑体验核心。**
- **E3 地点 stop + 媒体**:v3 模型(stop 泛化)+ 地点 picker + `media` overlay + 媒体上传/外链 + 预加载护栏。**自由度 + 视频。**
- **E4 手动故事板深编辑**:拖拽重排、地图摆位捕捉镜头、逐 beat 重生成 UI。
- **E5 放大**:多语言、分析→编辑闭环、fact-sheet 导出、配额/成本门。

## 8. 待用户拍板

1. **先做哪一阶段**(建议 E1 证据层:弹药已就绪、护城河、独立)。
2. **视频托管**:经纪上传到 R2(我们托管,可控但有出流量成本) / 外链(YouTube/Vimeo,零成本但依赖第三方) / 两者都要。
3. **成交量证据口径**:按"区域(area_name)"还是"楼盘(project_name)"为主(数据两者都有,楼盘更精准但样本少)。

## 9. 风险/护栏

- 视频不得破坏运镜(单时钟引擎 + 预加载;遵守 `luna-tour-perf-rules`)。
- DLD 数据口径需谨慎(成交含车位/转让等 procedure;要过滤 trans_group/procedure 以免误导)。
- 免责声明随投资/预测类证据强制出现(合规)。
- 所有新代码进 `luna-tour/`,DB 新表进 teardown,保持可删除。
