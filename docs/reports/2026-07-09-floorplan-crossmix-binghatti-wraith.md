# 户型图串图/丢户型诊断 — Binghatti Wraith (job_1783627788287_afboj)

日期：2026-07-09
现象：审核页 STUDIO TYPE 02 卡片显示一张 "STUDIO TYPE 01" 的户型图；STUDIO TYPE 05 显示 "STUDIO TYPE 06"；还夹带深色 "STUDIOS"/"ONE BEDROOM APARTMENTS" 分隔页；出现幽灵户型 "TYPE 01"。用户判断"户型被丢/串了"。

## 结论（已抓真实图核对）

**多户型自动切分本身没坏。** 真正根因是：这个任务**同时上传了两个 PDF**，它们含同一批户型图但排版不同，pipeline 按"户型名 + 页码范围"合并两边图片时相互污染。

两个源 PDF：
- `binghatti-wraith-floor-plans.pdf`（hash `dffb4ae5…`，全局页 4–22）—— 专用户型图册，每页并排两个**等大**户型图。**切分完全正确**：抓图核对 `p4_u0`=STUDIO TYPE 02(341.22 sqft)、`p4_u1`=STUDIO TYPE 01(396.11 sqft)，与卡片面积一致。
- `binghatti-wraith-brochure.pdf`（hash `47c01b6a…`，全局页 26–43）—— 完整营销楼书。户型图夹在深色分隔页（"STUDIOS"、"ONE BEDROOM APARTMENTS"）之间，且有"**分隔页 + 单个户型图**"的组合整页。

两个 PDF 每页的户型配对方式不同：
- 图册：`(T02|T01) (T03|T04) (T05|T06)` …
- 楼书：`分隔+T01(整页26)` → `(T02|T03)页27` → `(T04|T05)页28` → `T06+分隔(整页29)` …

## 三个具体失效

1. **组合整页没被切分 → 按页码范围塞进错误户型。**
   楼书 `page.26`（左=STUDIOS 分隔页，右=STUDIO TYPE 01 户型图）只有一个户型图，不满足 2/4/8 等分条件，`multiUnit` 不触发 → 整页留下。随后被 `assign-images.ts` 的**页码范围兜底**（`claimed===undefined && inRange`）吸进了**相邻的 STUDIO TYPE 02** 边界。
   → 就是用户截图看到的 "TYPE 02 卡片里是 TYPE 01 的图"。`page.29`（T06 + ONE BEDROOM 分隔）同理落到 STUDIO TYPE 05。

2. **分隔页被当成户型平面图。**
   深色 "STUDIOS"/"ONE BEDROOM APARTMENTS" 分隔页被分类成 UNIT_ANCHOR / floor_plan，泄漏进户型图廊；`page.43 + page.22` 两张分隔页甚至拼成一个纯幽灵户型 **"TYPE 01"**。

3. **跨 PDF 错位一格。**
   楼书因开头多一张"分隔+T01"整页，之后每页配对整体相对图册**偏移一格**，跨 PDF 按名合并时同一户型收到不对应的 crop（如 2BR：图册 `p17→(01,02)` 干净，楼书 `p39→(02,03)` 偏移）。

## 证据

- DB：`pdf_processing_tasks.result_data->buildingData->units`（31 户型），逐户型 floorPlanImages 文件名见排查记录。
- 每户型都是"图册 crop + 楼书 crop/整页"成对出现（doubled）。
- 抓图核对 `p4_u0/u1`(图册，正确) 与 `page.26`(楼书整页，错串) 已确认。

## 建议

### 立即修复本项目（最省事、结果最干净）
重新处理时**只用 `binghatti-wraith-floor-plans.pdf`**（它的 crop 已证明正确、无分隔页污染），得到干净的每户型单张户型图。楼书 PDF 仅用于抽项目概览图/配套图，不参与户型图分配。

### Pipeline 加固（防复发）
- **分隔页可靠识别**：深色纯标题页（STUDIOS / ONE BEDROOM APARTMENTS 等系列名封面）必须判为 `section_divider`（`shouldUse:false`），不进户型平面图。
- **整页 UNIT_ANCHOR 禁止跨名范围吸收**：一个整页若自身标签是 "TYPE 01"，绝不能被范围兜底塞进 "TYPE 02" 边界——范围归属前先比对该页自身 unitTypeName 与目标边界名，不一致则拒绝。
- **同项目多 PDF 去重**：户型图重叠的多个 PDF 应按户型图标签文字去重合并，而非按页码范围合并；或对"专用户型册 + 完整楼书"这类组合，户型图只取自户型册。
- **"分隔页+单户型"组合整页**：识别为单户型页并裁掉分隔部分（或至少按其自身户型标签正确归属，不做范围兜底）。

## 已实施修复(2026-07-10)

- **Fix #1 `page-classifier.agent.ts`**：深色纯系列名封面 → `section_divider`(shouldUse:false,不进户型图);"装饰系列名+单户型图"组合页 → `unit_anchor` 按平面图**自身标签**命名、禁设 isSectionStart;multiUnit units 顺序=物理阅读顺序、读每块自己的标签(JSON 示例也改成左→右)。
- **Fix #2 `assign-images.ts`**：整页锚点(main 角色)若自身户型名与目标边界名**冲突**,禁止范围兜底吸收(无名孤儿平面图页仍按范围/孤儿吸收,不破坏 PJA 版式)。

### 验证(本地重跑归档 PDF,新代码)
- 只用户型图册:31 户型,每个 1 张正确 crop,分隔页全排除,找回原丢的 3BR TYPE 01,无幽灵 TYPE 01。
- **两个 PDF 一起(硬案例)**:`page 26` 现被正确识别为 `unit_anchor STUDIO TYPE 01`,归入 **STUDIO TYPE 01**(不再串到 TYPE 02);31 户型全部正确命名,楼书配套/付款/33 张营销图全保留。每户型 2 张户型图(两 PDF 各一张、均为该户型自己的图)。

### 部署
- `quick-deploy.ps1` 已上线 API+worker(tag 20260710-084825,健康)。
- 本项目已用 `scripts/repair-wraith-task.ts` 把干净 buildingData 写回 task `job_1783627788287_afboj`(审核页同 URL 直接刷新即可)。

### 仍待办(可选)
- **跨 PDF 同户型图去重**:同一户型来自两个 PDF 的两张图视觉相同,目前都保留(admin 可删)。真正按内容去重是 Fix #3,风险高,暂缓,已单 PDF/双 PDF 两条路都可用兜底。
- **无关既有 bug**:项目描述生成用了已废弃 `gemini-3-pro-preview`(404),应换 `gemini-3.1-pro`。

## 相关代码
- `backend/src/langgraph/agents/page-analyzer.agent.ts` — `buildMultiUnitPages`（切分，正确）
- `backend/src/langgraph/algorithms/assign-images.ts` — L90-97 范围兜底（污染来源）
- `backend/src/langgraph/agents/page-classifier.agent.ts` — 分隔页 vs unit_anchor 判定
