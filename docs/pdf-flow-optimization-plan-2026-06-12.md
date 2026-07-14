# 楼书处理 Flow 优化分析 — 2026-06-12

现状基线(2026-06-12 全量测试):7 本楼书,21–80 秒/本,6/7 可直接提交。
当前流程:PDF → hash/R2 缓存检查 → mupdf 渲染全页(150dpi)+ 上传 R2 → 5 页/chunk、并发 10 → 每页:分类(gemini-3-flash-preview)→ 按类型条件提取(unit/pricing/amenity/payment-plan/project-info)→ 合并 + 修复兜底 → 描述生成(gemini-3-pro-preview)→ geocoding → 前端 SSE 进度 + 表单回填 → 人工 review → submit。

## 一、速度

### 1. 批量页面分类(收益最大,改动小)
现状:44 页 = 44 次独立 classify 调用(每次 1 图 1 请求)。
改法:每次请求塞 8–10 张缩略图(thumbnail 变体足够分类用),让模型返回数组。调用数降 ~85%,分类阶段时间和费用同步降。失败重试粒度变粗,但 withRetry 已兜底。

### 2. 两遍渲染策略(大 PDF 瓶颈在渲染+上传,不在 AI)
证据:214MB Crestlane 用了 80s,55MB ONE PARK 只要 26s——差距主要在图像生成/上传,AI 调用数相近。
改法:第一遍全页低清(72dpi)渲染做分类;只对 anchor/pricing 页二次渲染 150dpi 供提取。营销大图页(占比最高)永远不需要高清 AI 输入。预期大 PDF 时间砍 30–50%。

### 3. project-info 提前短路
项目名/开发商/地址通常在前 10 页就齐了,后续 chunk 不必再跑 project-info extractor。检查现状是否已条件化,没有就加"已齐全则跳过"。

### 4. 模型版本
全线在用 `gemini-3-flash-preview`,CLAUDE.md 指引是正式版 `gemini-3.5-flash`(preview 配额/限流更严,正式版更稳)。一行改动,顺手做。

## 二、获取更多信息

### 1. PDF 文本层利用(同时解决幻觉问题,优先级最高)
现状纯视觉,但多数楼书 PDF 有内嵌文本层,抽取几乎零成本。
用途:
- **反幻觉验证**:开发商名、价格、面积必须能在文本层找到才算 verified——直接修掉本次发现的 "Ellington Properties"(实际 BY IMAN)幻觉 bug;
- 辅助分类:有 "sqft / BR / AED / payment" 字样的页大概率是 anchor/pricing 页,可以做廉价预筛;
- 日期提取:7 本测试楼书 completion/launch/handover 全是空——briefing 里通常写了 handover 日期,文本层搜日期模式 + AI 确认,比纯视觉可靠。

### 2. 投资客关心但目前没提取的字段
service charge(AED/sqft)、view/朝向、楼层范围、车位、付款计划细节(目前只有 highlight)。这些是 Luna 给客户讲投资回报时的弹药。

### 3. 逐套库存表
很多 briefing 末尾有 unit-by-unit 价格表(楼层/朝向/逐套价格),目前 pricing-extractor 只取每类一条代表价。存完整库存表,未来能做"在售货量/价格梯度"展示。

### 4. 多文件互补(ONE PARK CENTRAL 场景)
pipeline 本来支持多 PDF 输入。营销画册 + fact sheet 一起传就能成项目。需要的是 UI 引导(见体验 #3),不是后端改动。

## 三、体验

### 1. SUBMIT READINESS 进前端(最高优先级)
现状:readiness 检查只存在于后端 txt 报告,前端用户提交后才发现户型被过滤。
改法:workflow 返回结构化 `submitReadiness` 字段(API 已有通道),review 表单顶部渲染 checklist:缺哪些项目字段、哪些户型不完整、哪些有 warning(如 Penthouse 缺价格)。用户现场补齐再提交。

### 2. 户型卡片实时流出
progress emitter 和 SSE 通道已存在,但提取结果是处理完一次性回填表单。把已完成的户型卡片实时推给前端,感知等待时间大幅缩短(80 秒盯进度条 vs 看着户型一张张出来)。

### 3. 空结果可操作文案
0 户型时不要泛泛失败,明确说:"这本是营销画册,缺平面图/价格页 —— 请补充 fact sheet 或户型手册一起处理",并支持往当前任务追加文件。

### 4. 重复项目查重
BayGrove 4 本楼书提取出的项目名几乎相同("Baygrove Residences"),直接提交会建出重复/混淆的项目。提交前按 名称+开发商+区域 查重,命中时提示"合并到现有项目 / 这是新 phase"。

### 5. 提交确认升级
现在是 `window.confirm`,换成正式 review dialog,内嵌 readiness checklist(和 #1 一体做)。

## 建议落地顺序

| 批次 | 内容 | 理由 |
|------|------|------|
| 1 | 体验#1 readiness 进前端 + 体验#5;信息#1 文本层反幻觉 | 直接消灭"提交后才发现丢户型"和幻觉 bug,改动面小 |
| 2 | 速度#1 批量分类 + 速度#4 模型正式版;体验#3 空结果文案 + 体验#4 查重 | 半天级别的活,收益立竿见影 |
| 3 | 速度#2 两遍渲染;体验#2 实时户型卡片 | 改动较大,但大 PDF 体验质变 |
| 4 | 信息#2/#3 新字段与库存表 | 需要配套前端展示和 DB schema,单独立项 |

## 相关

- 测试基线:`docs/reports/2026-06-12-test-brochure-processing.md`
- 本轮已合入的可靠性修复:commit `020c6c5`
- 注意:worker 未部署,线上生效需跑 `.\hetzner-deploy-worker.ps1`
