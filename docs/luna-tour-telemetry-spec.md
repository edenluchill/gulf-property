# Luna Tour — 遥测 / 客户行为分析 spec

> 2026-05-31 · 状态:设计 + 实现中(v1)
> 目标:客户点开分享链接后,把他的行为回传,用于 ①线索情报(给经纪) ②体验/产品优化(给我们)。
> share_code 是 join key(当初加 session code 的核心原因)。

## 0. 头号铁律:完全解耦 / fail-safe(不许影响主体验)

**这个功能挂了/慢了/报错了,tour 和网站必须毫发无伤。** 实现上硬性约束:

1. **前端 fire-and-forget**:所有上报用 `navigator.sendBeacon`(不阻塞、不等返回、页面跳转也能发完);降级用 `fetch(..., {keepalive:true}).catch(()=>{})`。**绝不 `await`、绝不 throw**——整个 telemetry 模块包在 try/catch 里,任何异常被吞掉。tour 代码**从不读它的返回值**。
2. **不碰回放引擎**:`TimelineEngine` 保持纯净,**不知道遥测存在**。由 `TourOverlay` 用 `useEffect` 观察 snapshot 变化来发事件——引擎零耦合。
3. **后端旁路**:独立 `POST /api/luna/public/v/:code/event` 端点,与只读 `GET /v/:code`(看 tour 用的)互不影响;best-effort 插入,任何错误就地吞掉,**永远快速返回 204**,不把 500 传到客户端(客户端本来也不看)。
4. **可一键移除**:删 `frontend/src/luna-tour/telemetry.ts` + `TourOverlay` 里那几个 effect + 后端那个端点 = 功能消失,tour 行为**完全不变**。

## 1. 两层价值(拆开做)

| 层 | 给谁 | 用途 | 例子 |
|---|---|---|---|
| 线索情报 | 经纪 | 知道客户倾向 → 精准跟进 | "Sarah 在 Marina ROI 停 40s + 点❤️ + 问租金回报" → David 带着答案打电话 |
| 体验/产品优化 | 我们 | 找漏斗断点、无聊段、脚本盲区 | "80% 在第 2 套弃看" / "很多人问学校但脚本没讲" → 改产品 + 改模板 |

## 2. 数据落点(schema 已就绪,无需迁移)

- **`lt_engagement_events`**:`session_id / visitor_id / event_type / project_id / dwell_ms / payload jsonb / ua / ip_hash / created_at`
- **`lt_client_feedback`**:`reaction(love/like/dislike/maybe) / comment`(❤️ 回流)
- **`lt_session_lead_scores`**(物化视图):自动聚合 opens / 完看 / 重看 / CTA / 总停留 / lead_score(定时 `REFRESH MATERIALIZED VIEW CONCURRENTLY`)

## 3. 事件清单

### v1(当前回放即可采,不依赖 Live/explore)
| event_type | 触发 | 带什么 |
|---|---|---|
| `open` | 观看页加载到 session | — |
| `tour_play` | 点「开始」 | — |
| `property_dwell` | 离开某楼盘的幕时 | `project_id` + `dwell_ms`(在这套房停了多久) |
| `chart_view` | 进入「数字」beat(看到 ROI 图) | `project_id` |
| `tour_complete` | 播到 ended | — |
| `tour_replay` | 点「再看一遍」 | — |
| `cta_whatsapp` | 点 CTA 联系经纪 | — |
| `feedback` | 点 ❤️ | `project_id` + `reaction`(同时写 `lt_client_feedback`) |

### v1.5+(依赖后续阶段)
- `ask` —— 客户问了 AI 什么(依赖 Phase 1 切 Live,payload 存问题文本)
- `property_view` / `explore` 点击 —— 暂停时点楼盘/查附近(依赖 Phase 2「暂停自己玩」)

## 4. 端点契约

```
POST /api/luna/public/v/:code/event
body: { visitor_id, event_type, project_id?, dwell_ms?, payload? }
→ 204 (永远;校验失败也 204,best-effort)
```
- 服务端按 `share_code` 查 `session_id`(索引快;查不到→204 忽略,避免 re-seed 后旧 session_id 脏写)。
- `event_type` 必须在白名单内,否则忽略。
- `ip_hash` = sha256(真实IP + 盐),**不存明文 IP**;真实 IP 取 `cf-connecting-ip / x-forwarded-for`。
- `ua` 存截断后的 user-agent。
- `payload` JSON 体积上限(防滥用)。
- `feedback` 事件额外 upsert `lt_client_feedback`。

## 5. 隐私 / 合规
- 匿名 `visitor_id`(客户端 localStorage 生成),`ip_hash` 不可逆。
- 真上线给真实客户:链接/落地页加一句轻量告知(顾问会看浏览行为以更好服务);涉 GDPR 区域客户尤其。低成本,避免后患。

## 6. 杀手级衍生:"客户正在看"实时提醒
`lt_session_lead_scores` + SSE/轮询 → 经纪手机弹"Sarah 正在看你发的导览" → 趁热打电话。Phase 1.5 做。

## 7. 阶段
- **v1(现在做)**:`telemetry.ts`(前端 fire-and-forget)+ event 端点 + TourOverlay 埋点(open/play/dwell/chart/complete/replay/cta/feedback)。
- **v1.5**:经纪面板看单 session 行为时间线 + lead_score 排序;"正在看"提醒。
- **v2**:聚合分析(漏斗、弃看点、问题词云)给产品迭代;`ask` 事件(切 Live 后)。
