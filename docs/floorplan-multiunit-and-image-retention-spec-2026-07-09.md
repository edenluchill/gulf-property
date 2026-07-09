# 户型图多户型切分 + 图片保留改造 spec (2026-07-09)

## 背景
用户两个诉求(2026-07-09 微信):
- **A 一页两户型**:有些 PDF 户型图页并排画两个户型(如 binghatti-wraith 的 STUDIO TYPE 02 | TYPE 01),整页当一张图 → 第二个户型丢失、第一个户型的图含两户型。
- **B 抽图别删非户型照片**:抽图给户型时,除户型图外的其他照片别删;户型保留图片,项目概览也保留(概览显示除户型平面图外的所有图),让 admin 在审核页自己决定删不删。

用户定的范围:
- A 用 **AI 自动切**,现在**只做 2/4/8 均衡等分切割**(横/纵/网格),不规则(如一页 3 户型)以后再说。
- B **完整实现**。

## 现状(调查结论,含文件行号)
- 抽图 = **整页渲染成一张图**(`utils/pdf/converter.ts` `pdfToImages`),不抽页面内嵌 figure。一页所有 `PageImage` 共用同一张整页图(`page-analyzer.agent.ts` `buildImages`)。
- 分类器每页只返回**一个** `unitTypeName`(`page-classifier.agent.ts` `ClassificationResult`)→ 同页第二户型丢失。
- **caller 已支持数组**:`chunk-processor.ts` L119-130 已 flatten `analyzePageWithAI` 的数组返回(多户型页展开)。`cropImage`(`utils/pdf/image-processor.ts`)、`generateImageVariantsFromBuffer`、`uploadToPdfCache`(`services/r2-storage.ts`)全部现成。
- 概览收集 `extract-project-images.ts`:已排除户型平面图,但也排除了户型页上的效果图/内景(那些只进户型)→ 概览 ≠ "除户型图外所有图"。`shouldUse===false` 的图被硬丢弃(`assign-images.ts` L102-106、`extract-project-images.ts` L58-60)。
- admin 审核页已能隐藏/恢复概览图(隐藏=事实删除)、户型↔图库移图(`SortableImageGrid.tsx`/`UnitTypeCard.tsx`)。

## 实现 A:2/4/8 均衡切分
1. `page-classifier.agent.ts`:
   - `ClassificationResult` 加 `multiUnit?: { count: 2|4|8; layout: 'horizontal'|'vertical'|'grid'; units: {unitTypeName, unitCategory}[] }`。
   - prompt(`PAGE_TYPE_CRITERIA` + JSON shape)加规则:unit_anchor 页若并排 **2/4/8 个等大户型**,返回 multiUnit,`units` 按**阅读顺序**(左→右、上→下)。不规则数量或不确定 → 不返回 multiUnit(退回单户型)。
2. `page-analyzer.agent.ts` `analyzePageWithAI`:返回类型改 `PageMetadata | PageMetadata[]`。检测到 `multiUnit`(且 count∈{2,4,8})时:
   - 拉 `imageUrls.original` 图 → sharp 读尺寸 → 按 layout 均衡等分成 count 块(horizontal=按宽等分、vertical=按高等分、grid=2×(count/2))。
   - 每块 `sharp(buf).extract(region)` → `generateImageVariantsFromBuffer` → 逐 variant `uploadToPdfCache(buf, pdfHash, 'p{page}_u{i}_{variant}.jpg')` 组 `ImageUrls`。
   - 每块产一个 `PageMetadata`(pageType=UNIT_ANCHOR、unitInfo 用 `units[i]`、`multiUnitSource={cropIndex:i,total:count}`、images=该 crop 的 FLOOR_PLAN)。跑 `extractUnitDetails` 拿各自 specs(可选:成本高,先用分类器名字兜底)。
   - 失败(拉图/裁剪异常)→ 退回原单页单 metadata(不阻断)。
   - **pdfHash**:`analyzePageWithAI` 的 `_pdfHash` 参数重新启用(caller 已传 `chunk.pdfHash`)。
3. 均衡切分几何:2→layout 决定横或纵二等分;4→2×2;8→2×4。crop[i] ↔ units[i] 按行主序。

## 实现 B:概览保留所有非户型图 + 别删
1. `extract-project-images.ts`:概览收集改为「**所有页的所有图片,排除 FLOOR_PLAN 类别**,按 imagePath 去重」。不再按边界/严格类别限制,不再因 `shouldUse===false` 硬丢(让 admin 决定)。→ 户型效果图/内景同时出现在户型和概览。
2. 户型侧 `assign-images.ts` 不变(户型仍保留平面图+效果图+内景);去掉 L102-106 的 `shouldUse===false` 丢弃(一并保留)。
3. 平面图继续只进户型不进概览(概览排除 FLOOR_PLAN 已满足)。
4. admin 删除沿用现有「隐藏」(可恢复,比硬删安全)。

## 验证
- type-check 前后端。
- 本地 `scripts/run-pdf-local.ts` 跑 binghatti-wraith-floor-plans.pdf:确认 STUDIO TYPE 01/02 各成独立户型、各自平面图不含对方;概览含效果图/内景不含平面图。
- 部署 worker(`docker build -f Dockerfile.worker` → push → 服务器 compose pull/up)。

## 风险
- AI 切分稳定性(当初 bbox 检测因区域行为差异被移除);均衡等分只依赖 count+layout(比 bbox 稳),且失败退回单页,不阻断。
- 概览图变多(admin 需多剪);符合用户「admin 自己管」意图。
