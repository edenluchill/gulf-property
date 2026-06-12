# 楼书处理 Flow 优化实施报告 — 2026-06-12

对应方案:`docs/pdf-flow-optimization-plan-2026-06-12.md`(全部落地,除两遍渲染——见末尾说明)。

## 已实施

### 1. PDF 文本层接入(后端)
- `langgraph/utils/text-layer.ts`(新):mupdf 提取每页文本,TextLayerRegistry 按 job 注册;`appearsInText` 反幻觉校验
- `langgraph/agents/text-insights-extractor.agent.ts`(新):一次 flash 调用扫全文,提取 developer/日期/付款计划(带日期)/service charge/库存表(数量+车位)/地标距离/amenities;`applyTextInsights` 合并(文本优先)
- workflow-executor:chunking 前提取文本(buffers 清空前),text pass 与 chunk 处理**并行**,最终装配时合并
- 分类 + 4 个提取 agent(unit-detail/pricing/project-info/payment-plan)的 prompt 附带该页文本层内容
- **反幻觉**:视觉提取的开发商名在文本层找不到依据时,用文本层的名字覆盖并记 warning

### 2. 批量分类(后端)
- `classifyPagesBatch`:每 chunk(5 页)一次调用替代逐页 5 次,分类调用数 **-80%**
- 失败/缺页自动降级单页分类;复用 withRetry + 容错 JSON 解析

### 3. submitReadiness 结构化(后端)
- `langgraph/utils/submit-readiness.ts`(新):单一事实来源,result-recorder 和 API 共用
- 放进 `buildingData.submitReadiness`(inline 和 worker 模式都能到达前端)
- 0 户型时给可操作提示(营销画册 → 请补充 fact sheet)

### 4. DB 新列 + submit 端点(已在生产库执行)
- `residential_projects.service_charge_per_sqft NUMERIC(8,2)`、`landmark_distances JSONB`
- `project_unit_types.parking_spaces NUMERIC(3,1)`
- migration: `backend/src/db/add-text-insights-columns.sql`(幂等,已跑)
- submit 端点写入三个新字段;库存数量复用已有 `unit_count`

### 5. 前端(/developer/upload)
- **SubmitReviewDialog**(新组件)替代 `window.confirm`:项目字段缺失、会被过滤的户型(blockers)、不完整但可提交的户型(warnings)、查重提示,blockers 存在时禁止提交
- **0 户型空态**:处理完成无户型时显示引导卡(后端 readiness.message)
- **查重**:处理完成后拉 `/meta/projects` 按归一化名称比对,命中显示黄色横幅 + dialog 内提醒
- **实时户型卡片**:已有机制(PROCESSING_PAGES 事件)保留,卡片处理中即逐步出现
- **新字段**:服务费可编辑输入框、地标距离 chips、户型卡车位徽标(🚗);全部进提交 payload
- checklist 的"无效户型"过滤规则与后端对齐(area<=0 **或 bedrooms 缺失**)
- i18n:zh-CN + en 各加 `readiness`/`reviewDialog` 文案

## 回归验证(3 本代表性楼书)

| 楼书 | 验证点 | 结果 |
|------|--------|------|
| ONE PARK CENTRAL | 开发商反幻觉 | ✅ "Ellington"(幻觉)→ **IMAN DEVELOPERS**;amenities 0→30;12 个地标;0 户型给出可操作提示 |
| City Walk Crestlane Briefing | 日期 + 付款计划 | ✅ Completion **APRIL 2030**(原为空);文本付款计划带逐期日期;amenities +25;10 户型全完整可提交 |
| Bay Grove Brokers Brief | 批量分类不丢 anchor + 车位 | ✅ 6/6 户型完整;handover **September 2028**(原为空);4/6 户型有车位配比;amenities +22 |

前端 `tsc --noEmit` 干净;后端 tsc 对改动文件无新错误。

## 未实施(后续可选)

- **两遍渲染**(大 PDF 提速 30-50%):渲染图同时用作项目展示图,低清化有画质风险,需要单独设计(如仅对 >100MB PDF 启用),暂缓
- City Walk 出现 "2BR + Maid" 与 "2BR+M" 两个近似类别未合并——category 归一化可再加 MAID 同义词处理,小问题

## 部署提醒

代码已 push;**生产 worker 需手动部署**:`.\hetzner-deploy-worker.ps1`(以及 API 服务器 `.\hetzner-deploy.ps1` 让 submit 端点新字段生效)。前端 Cloudflare Pages 随 push 自动部署。
