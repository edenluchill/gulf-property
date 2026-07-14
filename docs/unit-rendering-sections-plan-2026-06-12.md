# 户型多页效果图归属 + 多 PDF 价格合并 — 分析与实现方案

日期:2026-06-12
**状态:✅ 三个 Phase 已全部实现(2026-06-12),含提交落库闭环(B7)。**
**回归脚本:`cd backend && npx ts-node scripts/test-boundary-assignment.ts`(4 个场景 20 条断言全过;backend/frontend `tsc --noEmit` 均通过)。**
**v2 修复(2026-06-12 晚,解决"户型图丢失 + 面积=0"):**
- **根因**:旧的事件驱动扫描依赖分类器给页面打的 `isUnitStart` 标记,非确定性极强——同一份 PDF,户型图页(有面积)有时被识别为 anchor、有时照片页被误判为 unit start。生产跑出现两种坏结果:(a) 户型图页被漏在户型范围外 → 户型无户型图、面积=0;(b) 照片和户型图被拆成两个户型(10→20)。
- **确定性信号**:PJA 每页文本层有角标 "BEACH VILLA A / BLUE HORIZON - <房间>",每节固定 = `INSPIRED BY` 分隔页 → 照片×N → 1 页户型图(有面积,但文本无 villa 名)。户型图永远是每节最后一页。
- **重写 `scanUnitBoundaries` 为按节分组**(`scan-boundaries.ts`):分隔页/PDF切换切节;每节内数锚点(unit_anchor/floorplan)——**1 个锚点→整节合成 1 个户型**(PJA),**N 个锚点→按锚点拆 N 个、每锚点认领后面跟随的照片**(Palm Central)。照片页不再能单独起户型 → 不会拆分。
- **孤儿户型图吸收 `absorbOrphanAnchors`**:任何带户型图/面积却不在任何区间内的锚点页,确定性并入前面相邻(同节、无分隔页)的户型。兜底分类失误。
- **防拆分护栏**(`page-registry.ts` getFinalResult):AI section 重建只在"覆盖更多锚点"或"平局且户型数不超过本地"时才采用;重建拆分(户型数暴涨)时拒绝、回退确定性本地扫描。
- 回归:`scripts/test-boundary-assignment.ts` 加场景5(孤儿吸收+不跨分隔页);本地 run5 实测 **10 个 villa 全部 1 户型图 + 3-5 外观 + 4-6 室内 + 面积 + 6BR/5BR 类别**,66 秒。
- **前端手动移图**(UnitTypeCard + PropertyWorkspace):户型图/效果图下各一排管理缩略图,× 退回项目图库、+ 从图库移入(真"移动");AI 归错可人工纠正。作为确定性归属的兜底。

**真实 PDF 回归(2026-06-12,本地完整跑通):**
- PJA 211MB/140页:10 个 villa 全识别(系列名+5/6BR+面积),每个 1 平面图 + 2-5 外观 + 4-5 室内;全局重建被采用(锚点覆盖 10/10);缓存命中后全程 **72 秒**
- Palm Central 双 PDF(平面图册+价格单页):26 户型全出,跨 PDF 价格按档位全部正确匹配(1BR 2.5M / 2BR 4.26M / 3BR 7.51M / 4BR 12.62M / 5BR 17.58M / TH 14.18M / PH 31.81M,已对照文本层核实),payment plan 双提取生效;**51 秒**
- 本地直跑工具:`npx ts-node --transpile-only scripts/run-pdf-local.ts <pdf...>`;脏缓存清理:`scripts/purge-pdf-cache.ts`

**性能根因修复(处理"卡 10 分钟"问题):**
- **进度黑洞**:worker 进程上没有 SSE client,`progressEmitter.emit` 直接 return 连 DB 都不写 → 前端永远卡在 job-processor 写的 6%。已改为无 client 也节流写 DB(`progress-emitter.ts`)
- **mupdf WASM 内存崩溃**:211MB JPEG2000 楼书在 mupdf 路径 `malloc failed`,140 页只出 49 页。worker 镜像没装 poppler → `Dockerfile.worker` 已加 `poppler-utils`(本地 scoop 已装)
- **页码错位**:转换器跳页时,chunk 重命名/上传页码按数组下标推导 → 内容页码全体错位且**错图进 R2 缓存后永不覆盖**。三处已改为从文件名解析真实页码(converter-poppler / converter.ts / pdf-image-generator),并加缺页单页兜底重试
- **转换提速 14 倍**:pdftoppm 单进程 18 分钟 → 按页范围(-f/-l)8 进程分片并行,实测 140 页 **75 秒**
- **重建后名称失配**:全局重建给户型加系列前缀后,batch-processor 按严格相等找锚点失败 → specs 全空被提交过滤。已改归一化包含匹配 + pageRange 兜底;价格匹配同样加了包含匹配(`findPriceForUnit` 2.5 步)

**实现中新发现并已修复:**
- **B7**:提交落库时 `unit_images` 只放 floorPlanImage(`residential-projects.ts` 有 TODO),效果图字段前端类型/UI/payload 全程缺失 → 已打通 UnitTypeCard 展示("户型效果图"轮播)+ buildSubmitPayload 透传 + POST/PUT 两条入库路径合并 floorPlan+rendering+interior+balcony 去重入 `unit_images`
- **页码不是全局的**:`chunking.ts` 每个 PDF 从 1 重新编号,`page-metadata.ts` 旧注释"全局页码跨PDF唯一"是错的(已更正)→ 边界匹配、项目图提取全部加了 pdfSource 校验,PDF 切换强制关闭边界
样本:`C:\Users\lzp65\Desktop\pinzos 项目2`(4 个 PDF,均走 /developer/upload)

## 一、样本 PDF 结构分析

### 1. Palm Jebel Ali Project Brief Presentation.pdf(211MB,140 页)⭐ 核心难点
- p1–24:项目级内容(master plan、location、The Crown / Crescents / Spine / Fronds 分区介绍)
- p25–28:Beach Villa Collection 发售页,含小型价格表
- p29–135:**按 villa 户型分 section**,每个 section 结构固定:
  ```
  [分隔页:只有户型名,如 "BLUE HORIZON" / "INDIGO OCEAN" / "CYAN SKY" / "PACIFIC BREEZE" / "CORAL" / "BAJA SUN" / "CRYSTAL SPRINGS" / "PALM CREST" / "BLUE JAY" ...]
  → 外观渲染图 ×2–4 页(角标 "BEACH VILLA — N BEDROOM ...")
  → 室内渲染图 ×3–6 页(客厅/卧室/浴室)
  → 户型平面图页 ×1–2(小 plan + specs 面板)← 锚点在 section 末尾!
  ```
  约 13 个 villa 户型,每个 8–12 页,渲染图远多于平面图
- p136–140:interior colour scheme、注册流程

**关键特征:unit_anchor(平面图)出现在每个 section 的最后,前面全是该户型的效果图。**

### 2. Palm Central Floor Plans.pdf(64MB,35 页)
经典"一页一户型":每页 = key plan + 平面图 + 面积表,标题 "1 BEDROOM | TYPE A" 等。还有 4 页材质/标题分隔页。现有 flow 可处理。

### 3. Palm Central Prices and Payment Plan.pdf(13MB,1 页)
**单页同时包含两块内容**:
- STARTING PRICES(按 category:1-Bedroom 2.5M / 2-Bedroom 4.26M / 2-Bedroom With Maid 5.22M / 3-Bedroom 7.51M / 3-Bedroom Large 8.48M / 4-Bedroom 12.62M / 5-Bedroom 17.58M / Penthouse 31.01M / Townhouse 14.81M)
- PAYMENT PLAN(20% down + 8 期 + 30% handover Aug 2029)

### 4. Nad Al Sheba Gardens Phase11(45MB,44 页)
与 PJA 同模式但更轻:divider("3-BEDROOM TOWNHOUSE" / "4-BEDROOM VILLA" / "5-BEDROOM VILLA")→ 多页渲染 → 平面图。同样是"锚点在尾部"。

## 二、现有 Pipeline 能力评估

链路:`langgraph-progress.ts /start`(最多 10 个 PDF,单 jobId,全局页码)→ worker `job-processor.ts` → `workflow-executor.ts`(5 页/chunk 并行)→ `chunk-processor.ts`(classifyPagesBatch 一次分类整个 chunk → analyzePageWithAI 条件提取)→ `PageRegistry`(scanUnitBoundaries → assignImagesByBoundaries → mergeSameNameUnits → mergePricesIntoUnits → extractProjectImages)→ `batch-processor.ts` convertAssignmentToAggregatedData → 落库。

### 已具备 ✅
- 多 PDF 单 job 合并(全局页码跨 PDF 唯一,`page-metadata.ts:203`)
- 数据模型支持一户型多图:`UnitImageAssignment.{floorPlanImages,renderingImages,interiorImages,balconyImages}[]`(`assignment-result.ts`)
- 跨 PDF 价格匹配:`PricingEntry` + `findPriceForUnit` 五级级联(`unit-name-matcher.ts`)
- 前端 UnitTypeCard 已有多图轮播(`floorPlanImages` carousel)

### 缺口 ❌

| # | 缺口 | 位置 | 影响 |
|---|------|------|------|
| B1 | **边界算法只认"锚点开头"**:unit 从 `isUnitStart`(=unit_anchor 平面图页)开始;PJA 渲染图全在锚点**之前**、divider 之后 → 不落入任何 boundary → 被 `extractProjectImages` 收进项目图库 | `scan-boundaries.ts:32-134` | PJA/NAS 每个户型 6–10 页效果图全部丢到 project images,户型卡片只有平面图 |
| B2 | unit_rendering/unit_interior 页**不提取 unitTypeName**(只有 UNIT_ANCHOR 跑 extractUnitDetails);渲染页角标 "BEACH VILLA — 6 BEDROOM" 的文本层被忽略 | `page-analyzer.agent.ts:85` | 无法按标签归属,只能靠页码范围 |
| B3 | `mapImageCategory` 缺 `unit_rendering`、`unit_interior`、`unit_interior_bathroom` 等 key → 落到 UNKNOWN;UNKNOWN 在 `assignImagesByBoundaries` 的 switch 进 default,**不进 renderingImages/interiorImages**;且 UNKNOWN 在 extract-project-images 里被收进项目 renderings | `page-analyzer.agent.ts:365-382`、`assign-images.ts:80-103` | 即使页码在 boundary 内,渲染图也进不了户型的 rendering/interior 数组 |
| B4 | classifier 的 `imageInfo.category` 词表没约束(prompt 只写 "floor_plan, building_exterior, etc.")| `page-classifier.agent.ts:186-190` | 模型随意返回类别字符串,放大 B3 |
| B5 | 分类按 5 页 chunk 独立并行,无全局上下文;"BLUE HORIZON" divider 是 villa 名还是章节名、其后渲染页属于谁,单页/单 chunk 不可判定 | `chunk-processor.ts` | section 归属本质上需要全局视角 |
| A1 | **单页含 pricing + payment plan 只提取一种**:pageType 单值,page-analyzer 按 type 二选一跑 extractor;Palm Central 价格页正是两者同页 | `page-analyzer.agent.ts:155-193` | 丢 starting prices 或丢付款计划 |
| A2 | 价格 category 归一化:"2-Bedroom With Maid"/"3-Bedroom Large" vs 户型 "2BR"/"3BR",`normalizeCategory` 可能折叠不同价格档(2BR 4.26M vs 2BR+Maid 5.22M 二选一错配)| `unit-name-matcher.ts` | 需验证;Palm Central 9 档价格只有 7 个 bedroom 数 |
| B6(小)| pages 按 `pdfSource` 字母序排序,但 boundary 用全局页码范围匹配所有 PDF 的页;最后一个 unit 的 endPage = 排序后最后一页 → 可能吞掉其他 PDF 的页 | `page-registry.ts:160`、`scan-boundaries.ts:137-149` | 多 PDF 时尾部 unit 偶发吞图 |

**结论:现在的 flow 做不到把 PJA 的多页外观/室内效果图归到户型。** 不是数据模型问题(数组都在),是边界方向(B1)+ 类别映射断链(B3/B4)+ 全局归属缺失(B5)三处断点。

## 三、实现方案(三阶段,从便宜到智能)

### Phase 1 — 确定性修复(~1 天,纯代码,无新 AI 调用)

1. **修类别映射断链(B3/B4)**
   - `page-classifier.agent.ts`:CLASSIFICATION_JSON_SHAPE 里把 `imageInfo.category` 锁成显式枚举(floor_plan / unit_exterior / unit_interior_living / unit_interior_bedroom / unit_interior_kitchen / unit_interior_bathroom / unit_balcony / building_exterior / building_aerial / location_map / master_plan / amenity_* / logo / unknown),并写明:unit_rendering 页若是外观→unit_exterior,室内→unit_interior_*
   - `page-analyzer.agent.ts` mapImageCategory:补 `unit_interior_bathroom`、`unit_rendering`→UNIT_EXTERIOR、`unit_interior`→UNIT_INTERIOR_LIVING、`master_plan`、`building_entrance`、`amenity_garden/lounge/other` 等兜底
   - `assign-images.ts`:default 分支不再丢弃——pageType 为 UNIT_RENDERING/UNIT_INTERIOR 的页,其 UNKNOWN 图按 pageType 兜底进 renderingImages/interiorImages

2. **scan-boundaries 支持"锚点在尾部"(B1 核心修复)**
   - 维护 `pendingSectionPages`:自上一个 sectionStart/unit 结束以来、pageType ∈ {UNIT_RENDERING, UNIT_INTERIOR, SECTION_DIVIDER后内容} 的连续页
   - 当 unit_anchor 触发 isUnitStart 时,若 pending 页紧邻锚点(中间无其他边界事件),把 boundary.startPage **回溯**到 pending 的第一页
   - divider 的 startMarkerText("BLUE HORIZON")作为 section 上下文并入户型名(现有 combineWithSectionContext 思路扩展:不只 bedroom 词,任何短标题 divider 都可作为 collection 名,生成 "BLUE HORIZON — 6BR" 这类唯一名)

3. **pricing/payment 同页双提取(A1)**
   - classifier 返回独立布尔 `hasPricingTable` / `hasPaymentPlan`(与 pageType 解耦)
   - page-analyzer:两个布尔各自触发 extractor(两个调用本来就并行,成本可忽略)

4. **B6 防御**:assignImagesByBoundaries 匹配范围时同时校验 `page.pdfSource ∈ boundary.pdfSources`;最后一个 unit 的 endPage 截断到该 PDF 的最后一页

### Phase 2 — 渲染页打户型标签(~1 天)

5. classifier 对 unit_rendering / unit_interior 页也返回 `unitTypeName`(指示模型读角标/标题,文本层辅助,读不到就留空,**禁止猜**)
6. page-analyzer 为这些页写入 `unitInfo = { unitTypeName, roleInUnit: 'supplementary' }`(不跑 extractUnitDetails,零额外调用)
7. assign-images 升级为**标签优先**:有 unitTypeName 标签的图先按标签归属(归一化匹配同 merge-units),无标签的再按页码范围;标签与范围冲突时标签赢

### Phase 3 — 全局 section 重建 pass(推荐,~2 天)⭐ 解决 B5 根因

8. 所有 chunk 分类完成后、`getFinalResult()` 之前,加一次**纯文本**全局调用(gemini-3.5-flash,无图片):
   - 输入:每页一行 `页码 | pdfSource | pageType | startMarkerText | unitTypeName | 文本层前 80 字`(140 页 ≈ 几千 token)
   - 输出:`sections: [{ unitTypeName, unitCategory, startPage, endPage, anchorPage?, confidence }]`
   - 这是人翻楼书的方式——全局看目录结构。单页无解的"这 8 页属于 Blue Horizon"在全局序列里是显然的
9. 融合策略:AI sections 提供范围与归属;本地锚点页提供 specs 事实(页码、面积、卧室数)。section 内必须含 ≥1 个 unit_anchor 才采信;低 confidence 或与锚点冲突时回退 Phase 1 的本地扫描结果
10. 失败语义:这次调用失败/超时 → 直接用 Phase 1 结果,不阻塞 job

### 验证(回归样本就用这 4 个 PDF)
- PJA 140 页:期望 ~13 个 villa 户型,每个 6–10 张 rendering/interior + 1–2 张平面图;项目图库不再混入 villa 效果图
- Palm Central(2 个 PDF 一次上传):35 页平面图全部出户型;**且**每户型匹配到对应档位价格(2BR 与 2BR+Maid 不串)、payment plan 9 期完整
- Nad Al Sheba:3BR TH / 4BR Villa / 5BR Villa 各自带多页渲染图
- 工具:job 输出在 `backend/uploads/langgraph-output/job_{jobId}/`,对照 analysis-report JSON 的 units[].renderingImages 数量

### 改动文件清单
| 文件 | Phase |
|------|-------|
| `backend/src/langgraph/agents/page-classifier.agent.ts` | 1(枚举锁定+双布尔)、2(渲染页 unitTypeName) |
| `backend/src/langgraph/agents/page-analyzer.agent.ts` | 1(映射表+双提取)、2(supplementary unitInfo) |
| `backend/src/langgraph/algorithms/scan-boundaries.ts` | 1(回溯)、3(融合入口) |
| `backend/src/langgraph/algorithms/assign-images.ts` | 1(default 兜底+pdfSource 校验)、2(标签优先) |
| `backend/src/langgraph/core/page-registry.ts` | 3(全局 pass 接线) |
| `backend/src/langgraph/agents/section-reconstructor.agent.ts`(新) | 3 |
| `backend/src/langgraph/utils/unit-name-matcher.ts` | 1(category 归一化加 +Maid/Large 变体,待验证后定) |
