# Luna 体验重构与拓展 Proposal

> 日期：2026-06-25 · 作者：Claude（基于三路代码探查）
> 目标：把 Luna 从"语音搜索框"升级成"会带看的 AI 经纪"。回答用户提出的所有问题，并给出分期落地方案。

---

## 0. TL;DR（我的判断）

1. **能力层已经接好了。** Luna 现有 **24 个工具，全部连通、无 stub**（搜索 / 区域指标 / 投资测算 / POI / 测距 / amenity 评分 / 可负担 / 租买对比 / 跳项目详情…）。问题**不在"能不能做"，在"怎么表达"**。
2. **问题在表达层：** ① 文字滞后（200ms 节流 + 无打字机 + 音文不同步）；② 显示比点开 areablock 粗糙（无走势图 / 无成交列表 / 缩水卡片）；③ 台词和数据全挤在一个小气泡里；④ 移动和桌面几乎一样。
3. **你的"序列化导览点"想法非常对 —— 而且 80% 已经造好了。** `frontend/src/luna-tour/` 里有完整的 `TimelineEngine`（单时钟驱动相机+音频+overlay 锁步）、overlay 体系（`progress_dots`、`distance_line`、`amenity_spokes`、`roi_card`、`property_card`…）、相机轨道编译器、分段 `seekToSegment`、协作直播广播。**它现在服务于 B2B2C 预生成分享导览产品，还没接到主地图上的实时对话 Luna。** 把这两者打通，就是你要的东西。
4. **建议方向：** Luna 升级成三种形态 —— **快问快答（优化现状）/ 引导带看序列（你的想法，复用 luna-tour）/ 跳页展示（带你去详情/分析页）**。分三期落地，P0 是 1–2 天的快赢。

---

## 1. 现状盘点：接好了吗？

### 1.1 能力（✅ 全连）
模型 `gemini-2.5-flash-native-audio-preview-12-2025`，语音 Aoede，纯 audio modality，ephemeral token（密钥不出后端）。工具执行返回 `{ result, summary, mapAction }`，`mapAction` 驱动前端地图。

**24 个工具分组：**
| 组 | 工具 |
|---|---|
| 发现 | `search_projects` `recommend_by_budget` `highlight_projects` `navigate_to_project` `open_project_detail` `reset_map` `add_to_favorites` |
| 区域 | `fly_to_area` `get_area_info` `compare_areas` `analyze_area_amenities` |
| 地图叠加 | `show_nearby_pois` `show_transport` `measure_distance` |
| 投资分析 | `get_investment_breakdown` `area_investment_report` `compare_market` `check_affordability` `project_value_check` `purchase_costs` `rent_vs_buy` |

> 关键文件：`backend/src/services/voice-assistant-tools.ts`（定义+执行）、`voice-assistant.ts`（Gemini 连接、tool-call 处理）、`routes/voice-token.ts`（system prompt）。

### 1.2 显示（🟡 偏弱）
- UI：右下 pill 按钮 + 3 种气泡（thinking / 回答 / 用户字幕），绝对定位在 pill 左侧、向上生长。
- 富内容：4 种附件卡 —— `projects`（CompactProjectCard + InvestmentChart）、`area_info`（2×2 指标格）、`comparison`、`investment`。
- 文件：`components/voice-assistant/VoiceAssistantButton.tsx`、`contexts/VoiceAssistantContext.tsx`。

### 1.3 已有但没接上的"金矿"（⭐）
`frontend/src/luna-tour/`：`engine/TimelineEngine.ts`、`engine/cameraTrack.ts`、`map/mapTourHandle.ts`、`types.ts`（`TourScript / Act / Beat / Overlay`，16 种 overlay 含 progress_dots）、`collab/protocol.ts`（goto / select / mapAction / cam 广播）。**这正是"序列带看"的现成地基。**

---

## 2. 问题诊断（为什么"效果一般"）

| 症状 | 根因（已定位） | 文件 |
|---|---|---|
| **文字读得慢/滞后** | `BUBBLE_FLUSH_MS = 200ms` 批量刷新（5 帧/秒）；无打字机；音频已在说、文字还在攒；无 "typing…" 反馈 | `VoiceAssistantContext.tsx:37, 596-614` |
| **显示不如点开 areablock** | 气泡用的是**缩水卡**：无 12 个月 sparkline、无成交/租约列表、无 tab、无"如何计算"。而点开 areablock 有 `AreaTrendGrid`+`AreaRecentTx`+6 格指标 | 对比 `AreaDetailDialog.tsx` vs Luna 卡片 |
| **她飞过去但打不开详情** | Luna 只能 `fly_to`，**无法程序触发 `handleAreaClick()`**（打开 AreaDetailDialog），用户还得自己点 | `MapPage.tsx:860` |
| **台词+数据挤一个气泡** | 语音台词应短，视觉应承载细节；现在都堆在 w-64 气泡里 | — |
| **移动/桌面几乎一样** | 仅 pill 位置、气泡宽高不同；卡片组件完全相同 | `VoiceAssistantButton.tsx` |

---

## 3. 愿景：Luna = 会带看的 AI 经纪

把 Luna 从"你问一句、她答一句 + 飞一下"升级成有三种形态的助手：

1. **快问快答（Ask）** — 现有模式，优化文字与卡片（P0）。
2. **引导带看序列（Guide）** — 你的想法：她说"这个项目不错"，弹出 3 个进度点，一步步带你看 区域优势 → 环境+测距 → 最近成交，每步一句短台词 + 一个镜头 + 一个卡片（P1，核心）。
3. **跳页展示（Show）** — 她能把你带到项目详情某个 tab、分析页、对比页、报告页，并高亮重点，再带回地图（P2）。

贯穿原则（你明确要求）：**不霸屏** —— 面板可收起、序列可跳过/快进、台词短、一屏一焦点。

---

## 4. 核心：引导带看序列（你的 idea，强烈推荐）

### 4.1 体验
> Luna："Dubai Marina 这个项目挺适合你，我带你看三个点。"
> → 地图上浮出 **3 个进度点 ①②③**，相机飞到项目。
> **① 区域优势**：短台词 + 区域卡（回报/增长/中位价，复用真组件）。
> **② 环境 & 通勤**：相机拉到周边，`amenity_spokes` 画出到地铁/学校/医院的连线 + 距离（`measure_distance` 已支持）。
> **③ 最近成交**：相机回项目，弹出该开发体最近 DLD 成交列表（复用我们刚做的 project transactions）。
> 用户可**点任意点跳转**、**暂停插话提问**（live 已有 `asking` 态）。

### 4.2 为什么可行（地基已在）
- `Beat`/`Act`/`Overlay` 结构 + `TimelineEngine` 单时钟锁步（暂停=全冻结，防重渲染坑已解决）。
- `progress_dots` overlay 已存在；`distance_line`/`amenity_spokes`/`roi_card`/`property_card` 已存在。
- `seekToSegment(i)` 可点点跳转。

### 4.3 怎么接（关键工作）
现有 luna-tour 是**预生成脚本 + 预生成音频**的离线产品。实时 Luna 需要一个**轻量版 runner**：
- 新增 1 个工具 `start_guided_tour({ project_id?, area?, stops: Stop[] })`，Luna 自己编排 2–4 个 stop。
- `Stop = { kind: 'area'|'environment'|'transactions'|'roi'|'compare', say: string, camera, overlayRef }`。
- 前端 `LiveTourRunner`（基于 `TimelineEngine` 简化）：**不预生成音频**，每个 stop 用 live 语音逐段说 `say`，说完 + 相机到位 → 显示该 stop 的 overlay/卡片 → 等用户（自动停留或手动 next）。
- 复用 `mapTourHandle` 的 `flyTo/pulseAt/showAmenitySpokes/setPropertyPins`。

> 这样台词被天然拆成多段、不再一口气塞完，且每段都有对应的好看展示 —— 正好解决你说的"不用把话挤在一句说完"。

---

## 5. 显示层重构：台词与数据优雅分离

**核心思路：语音台词归台词（小、瞬时、会消失），数据展示归"Luna 面板"（结构化、可停留、复用真组件）。**

- **桌面**：右侧常驻 **Luna Dock**（可收起），地图保持大。台词浮在 dock 顶部一行，下面是数据卡（区域 = `AreaTrendGrid` 缩略 + 关键 6 格；成交 = `AreaRecentTx`；投资 = `InvestmentScorecard`）。**不再做缩水卡，直接复用点开 areablock/项目详情的真组件。**
- **移动**：底部 **Luna Sheet**（半屏，可下滑收起），进度点在顶部，卡片全宽，一屏一 stop。
- 让 Luna 能程序化触发 `handleAreaClick(area)` / 打开项目某 tab —— 即"她展示的就是你点开看到的那套好东西"。

---

## 6. 文字 & 台词优化（直接解决"读得慢"）

1. **文字即时化**：`BUBBLE_FLUSH_MS` 200→~60ms 或改成 token 到达即 append；加**打字机/淡入**动画 + "typing…" 指示。
2. **音文同步**：文字推进节奏跟随音频播放进度，而不是各跑各的。
3. **台词规范（改 system prompt）**：每段 ≤ 1–2 句；需要展开的内容走"引导序列"分多 stop 说；保留现有禁词规则（不说"抱歉/无法"）。
4. **每个工具配一句"展示台词模板"**：让回答风格统一、信息密度稳定（例如投资类必带"指示性，不是保证 + 回本年数"）。

---

## 7. 地图上她该做的 / 分析整合 / 跳页

- **地图（已能 + 待加）**：已能 飞行/测距/amenity 评分/POI/通勤/heatmap。**新增**：程序化开 `AreaDetailDialog`、画区域对比、跑引导序列。
- **分析帮忙（高价值）**：她已能调 `area_investment_report` / `recommend_by_budget` / `check_affordability` / `compare_market` —— 把结果**渲染成分析页同款图表**，或直接 **`navigate` 带你跳到 `/transactions`、`/compare`、`/report` 并高亮重点**，看完一句"带你回地图"。
- **跳页能力**：把 `navigate` 正式化成"去任意页 + 高亮 + 可返回"，让 Luna 真正能在页面间带你走。

---

## 8. 分期 Roadmap

### P0 — 快赢（~1–2 天，立刻提升观感）
- 文字即时化 + 打字机 + typing 指示（改 `VoiceAssistantContext`）。
- 台词收短（改 system prompt）。
- Luna 卡片**换成真组件**（`AreaTrendGrid`/`AreaRecentTx`/`InvestmentScorecard`）。
- 给 Luna 一个程序入口**直接打开 AreaDetailDialog / 项目 tab**。

### P1 — 核心：引导带看序列（你的想法）
- `LiveTourRunner`（基于 TimelineEngine 简化，live 语音逐段说）。
- 新工具 `start_guided_tour(stops[])` + 进度点 UI + 点点跳转 + 暂停插话。
- 先做 3 种 stop：区域优势 / 环境+测距 / 最近成交。

### P2 — 拓展
- 桌面 Dock vs 移动 Sheet 差异化。
- 跳页展示（分析/对比/报告页）+ 高亮 + 返回。
- 区域/项目对比可视化；收藏序列；"为什么这么算"解释层。

---

## 9. 风险 & 原则
- **不霸屏**（你的硬要求）：Dock/Sheet 可收起、序列可跳过/快进、台词短、一屏一焦点。
- **性能**：序列相机走 luna-tour 单时钟（已防重渲染）；复用真组件注意懒加载，序列时隐藏 DOM marker 海（沿用既有 perf 规矩）。
- **不藏数据**：延续既有原则，展示按口径可切换，标注 DLD 来源与"指示性"。
- **复用优先**：能复用 luna-tour 引擎和真组件就不重造；新代码集中在"实时桥接层"。

---

## 10. 建议的下一步
P0 全是低风险高收益的"观感提升"，建议先做。P1 是你那个想法的真正落地，价值最大但需要新建 runner + 工具。**要不要我先把 P0 做了**（文字即时化 + 真组件卡片 + 能开 dialog），让你马上看到 Luna 变好看？然后再一起细化 P1 的 stop 编排。
