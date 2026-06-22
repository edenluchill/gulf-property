# AI 找房助手（Generative UI）— Spec

> 目标:把"帮客户算账 + 找到合适房产"从**只在 Luna 语音里**升级为一个 **smooth 的可视体验**。
> 不做传统填表计算器(一堆输入框,客户不懂填什么)。走 **一句话意图 → AI 调现成工具 → 结果渲染成可视卡片 + 地图联动**。
> 背景:外部 AI 评价说我们"缺财务计算"——其实后端能力全有(8 个 `/api/ai/analytics/*` 路由,公开无 auth),缺的是可视入口。

## 核心交互

入口:地图页常驻一个"找房助手"面板(也可由 Luna 语音触发)。

1. **意图输入**:一个聊天式输入框 + 3-4 个引导 chips(「我有 X 预算想收租」「月入 X 能买哪」「这区值不值得买」「租好还是买好」)。打字或语音都行,不强迫开口。
2. **AI 解析意图** → 调对应后端工具,自动填客户不懂的参数(DLD 4%、利率 4.5%、首付 20%)并在结果里**注明假设**。
3. **结果 = 动态生成的可视卡片**(不是一段文字),按意图类型渲染不同卡片(见下)。
4. **地图联动**:结果里出现的区域,点一下/hover 地图飞过去高亮;推荐区直接在地图打点。
5. **可调微调**:卡片上留 2-3 个控件(预算滑块、目标切换 自住/收租/增值、首付比例),拖动即时重算(重新调用路由)。
6. **(进阶)主动式**:基于客户在地图上看过的区,主动浮出"这区你预算能买 2 居,净回报 X%,看 3 个匹配盘?"

## 复用的后端路由(已存在,公开)

| 意图 | 路由 | 卡片 |
|---|---|---|
| 月收入/现金 → 能买多少 | `GET /api/ai/analytics/affordability` | 可负担卡:max 总价、首付、月供、可买区域 |
| 预算 + 目标 → 推荐区 | `GET /api/ai/analytics/recommend` | 推荐区列表(yield% / growth% / 置信度)+ 地图打点 |
| 某区投资分析 | `GET /api/ai/analytics/investment` 或 `/report` | 投资卡:中位价、毛/净回报、CAGR、5年ROI、回本年 |
| 租 vs 买 | `GET /api/ai/analytics/rent-vs-buy` | 对比卡:买入净成本 vs 租金总额、verdict |
| 购房成本 | `GET /api/ai/analytics/costs` | 成本明细卡:DLD 4% + 中介 2% + 登记费 |
| 项目报价是否合理 | `GET /api/ai/analytics/project-value` | 比价卡:vs 片区中位、溢价% |

**关键升级**:`investment`/`recommend` 的回报要用 **Net Yield**(扣 service charge),不再是 gross。后端聚合见 Phase 1。

## 前端结构(建议)

- `FindHomeAssistant.tsx`:面板容器 + 意图输入 + chips + 结果流。
- 意图路由:轻量——前端先用规则/关键词把 chip→固定意图;自由文本走 Luna 的意图解析(或一个 `/api/ai/analytics/parse-intent` 薄封装,可选)。MVP 先只做 chips + 结构化输入(预算/收入/区域下拉),自由文本后置。
- `result-cards/`:每种意图一个卡片组件(AffordabilityCard / RecommendCard / InvestmentCard / RentVsBuyCard / CostsCard),统一 props = 对应路由的返回 JSON。
- 地图联动:复用现有 `flyTo`/区域高亮(MapViewMapLibre 已有能力)。
- i18n:沿用 en + zh-CN。金额走 `lib/money.ts` + DirhamSymbol。

## MVP 范围(第一刀)

1. **可负担计算器卡**(affordability)——Google 点名缺的,最高优先。结构化输入(月收入 或 现金 + 目标)→ 卡片 + 可买区域打点。
2. **预算找房卡**(recommend)——预算 + 目标 → 推荐区列表 + 地图打点 + 点击进区域详情。
3. 这两个跑通后再加 rent-vs-buy / costs / investment 卡,以及自由文本意图解析。

## 验收

- 不登录可用(路由公开)。
- 移动端可用(地图页底部 sheet)。
- 回报数字是 **Net Yield**(扣 service charge)且注明数据来源/假设。
- 结果区域与地图联动(点了飞过去)。
