# Luna Tour 现状审计 —— 2026-07-12

> 优化前的交接文档。**先别优化 pipeline —— 先让它停止撒谎。**

---

## 结论先说

| | |
|---|---|
| **有史以来生成的 tour** | **7 个** |
| **生成者** | **100% 是 `demo-agent@luna.tour`（你自己的 smoke test）** |
| **真实经纪生成过的** | **0 个** |
| **最后一次生成** | 2026-06-22 |
| **完播** | 2 次（来自 1 个访客，2026-06-07 之后再没有） |
| **CTA 点击 / ❤️** | **0 / 0** |

7 个里 6 个叫「EN Test」「Smoke Test」「Mr Bean」。

**而这套没人用的东西，正在对每一个客户播报编造的投资回报，并告诉中国客户最近的地铁是一家 11 公里外的药房。**

---

## 🔴 P0-A：每一份 tour 的 ROI 数字都是编的，而且完全相同

```ts
// session-builder.ts:24-25
const PLACEHOLDER_YIELD_PCT = 6.5
const PLACEHOLDER_GROWTH_PCT = 7
```

DB 里 **全部 16 条 property 快照**（跨 7 个 tour）：

```
name                              buy       growth  yield  payback
City Walk Crestlane I             2620000   73      6.5    15
Dubai Design District (d3)        2000000   73      6.5    15
113 RESIDENCES                    1800000   73      6.5    15
Palm Central Private Residences   2500000   73      6.5    15
```

**73 / 6.5 / 15，一模一样。** 而 AI 把它当成事实播报给客户：

> 「以180万迪拉姆的初始投资为例，**预计五年后价值可达 310万9593 迪拉姆，增长率高达 73%**，同时拥有 6.5% 的租金回报率。」

`y7kjn7` 那条甚至把毛租金回报说成「**年化收益率为 6.5%**」（真实年化是 ~11.6%）——概念都是错的。

**最讽刺的地方**：prompt 里明明写着「**NEVER invent or estimate any number**」，guardrail 里写着「不要承诺或保证任何回报率或升值」——**两条都被严格遵守了**。因为**造假发生在上游的 TypeScript 里**，然后被当作 ground truth 喂给模型。

> **模型没有幻觉。它在忠实地为我们的造假洗白。**

而且设计里**本来有诚实的出口**：`[PLACEHOLDER]` 机制（`tour-generator.ts:67`）——但 `session-builder` **从来没给任何东西设过 `placeholder: true`**，`TourPropertyInvestment` 类型里**压根没有这个字段**。唯一的逃生舱**接在了空气上**。

**23 个项目里只有 11 个有价格**（48%）。剩下 12 个 `investment: undefined` → 模型只能靠感觉编：「代表着早期投资的战略机遇…未来价值增长值得关注」——**正是 guardrail 禁止的那种无凭据升值承诺**。

**修**：`yield_pct`/`growth_pct` 从 `get_dubai_area_metrics()` 按区域取（这个函数已经存在，地图在用）。取不到 → **整个 `investment` 对象直接省略，砍掉 numbers beat**。**绝不发射合成常量。**

---

## 🔴 P0-B：地铁是一家药房，11 公里外

demo tour 的真实数据：

```
Palm Central   🚇 地铁（صيدلية لايف）        11.05 km   ← "Life Pharmacy"
Palm Central   🏫 学校（Jebel Ali Primary）   13.19 km
113 RESIDENCES 🚇 地铁（مدينة دبي للإنترنت）  0.91 km
```

三个 bug 叠在一起：
1. **1,817 个 amenity POI 里有 196 个只有阿拉伯语名** → 原样塞进中文 tour 的旁白和地图标签
2. **`dubai_pois` 分类是错的** —— 一家药房被标成 `metro_station`
3. **`fetchNearby` 没有半径上限**（`session-builder.ts:66-76`）→ 13 公里外的学校被当成「配套」
   ⚠️ 前端的**同名实现 caps at 10km**（`amenities.ts:42`）→ **地图上显示的和旁白说的不是同一份数据**

而 AI 拿到 `amenity_score: 0` 还得硬圆：「虽然…相对偏远，但…未来的基础设施建设将极大地提升其价值」——**又一句无凭据的升值承诺**。

**修**：`ST_DWithin` 按每个 spec 的 `zero` km 卡半径；名字不是 tour 语言的**直接丢弃**；`metro_station` 必须能对上迪拜地铁的 90 个站。标签退化成「🚇 地铁 0.9 km」——**还是真的，只是不荒谬**。抽一份共享 spec，别让前后端再漂移。

---

## 🔴 P0-C：匿名用户可以白嫖（钱在漏）

`currentAgentId()` 在**没有 token 时 fallback 到 `demoAgentId()`**（`agent-router.ts:82-108`）。而配额门是 `if (isLoggedIn(req))`（`:1016`）——**匿名 = 不登录 = 跳过配额**。

于是开放互联网上任何人都可以：
- `POST /sessions/create` → **无限制烧 Gemini + TTS**（每次 ~$0.15-0.40）
- `GET /sessions` → 列出 demo agent 的全部 session
- `DELETE /sessions/:id` → **删掉 demo tour**

**修**：`/api/luna/agent/*` 的写路由全部 `requireAuth`。demo 只读，走显式 `?demo=1`，**绝不能当作 auth 的 fallback**。

---

## 🔴 P0-D：客户行为永远回不到 CRM（核心承诺结构性未接线）

`POST /sessions/create` 收了 `client: {name}`，**但从不把 `client_id` 传给 `createSession`**（`agent-router.ts:1033`）——而 `session-builder.ts:136` **是接受这个参数的**，`seed-demo-session.ts:91` 是**唯一**传了它的调用方。

DB 确认：**只有 `demo` 有 `client_id`，UI 建的全是 NULL。**

再加上：**`lt_engagement_events` 在 `luna-tour/` 之外零读取**（grep 过了）——它不进 `leadEngine`、不进 `lt_client_interactions`、不进客户雷达、不进 admin dashboard。

> **「客户行为回传给你」这个核心卖点，止步于一个可折叠面板。**

**修**：从真实的 `lt_clients` 选择器把 `client_id` 传下去；`tour_complete`/`cta_whatsapp`/`feedback` 时 fire-and-forget 写一行 `lt_client_interactions` → tour 就出现在客户的时间线上。

---

## 🟠 P1：`tour-generator` 根本没用 responseSchema

```ts
// tour-generator.ts:191-198
config: {
  responseMimeType: 'application/json',   // ← 就这一行
  temperature: 0.7,
}
```

**比我刚修的 optional-schema 问题更糟** —— 连 schema 都没有。TourScript 的「schema」是 prompt 里的一段**散文描述**（`:123-147`），zod 是**事后**校验（`tour-script.types.ts:212`）。所以模型可以自由地漏字段、改名、乱发明，代码得靠一个**error-feedback 修复重试循环**（`:339-357`）来擦屁股。

zod schema 本身也全是 optional，真内容可以静默消失：
`Beat.kind` optional(`:182`) · `CameraKeyframe.center/zoom/pitch/bearing` **全 optional**(`:27-31`) · `RoiCard.yield_pct` optional(`:131`) · `PropertyCard.fields: z.any()`(`:99` —— 注释自己承认「模型在这里吐 string/object/array 不一致」)

**还没有 `thinkingConfig`** → `gemini-3.5-flash` 默认 `medium` thinking，**按 output 价 $9/1M 计费**，每次白烧 ~1440 token，重试时 ×2。`auto-config`/`auto-match`/`revise` 同样漏了。

**修**：真 `responseSchema`，**全字段 required + 允许 null**（见 `docs/reports/2026-07-12-gemini-model-lineup.md`）；`temperature: 0`；`thinkingConfig: { thinkingLevel: 'low' }`；`maxOutputTokens`。**重试循环可以整个删掉，成本减半。**

✅ 模型 ID 已经是对的（`gemini-3.5-flash`），我上一轮的修复覆盖到了这里。

---

## 🟠 P1：TTS 模型是**同一个**过期 ID 的坑

```ts
// tts.ts:20-25
['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts']
```

2.5 系列**最早 2026-10-16 关停**，而 `resolvedModel` 会**缓存第一个能用的**（`:58`）——如果 #1 是 404，整个产品**已经在静默地骑着一个将死的 2.5 preview**。

**这和我刚给文本模型修的是同一类 bug。**

**修**：`ai.models.list()` 验证真实 TTS ID，钉 GA 的那个，**全部解析失败要大声报错**（不是 `continue`）。

---

## 🟠 P2：其余

| # | 问题 | 位置 |
|---|---|---|
| 生成无持久状态 | `genJobs` 是**内存 Map**；API 重启后 `/gen-status` 对任何有 DB 行的 session 都报 `ready`——包括在音频阶段崩掉的。无重试、无死信。「生成中」进度条前三个节点是**每 3.5 秒自动前进的假动画** | `agent-router.ts:47,1191`；`AgentTours.tsx:291` |
| 播放器违反自己的性能铁律 | rAF tick **每 ≤80ms 就 `setSnap`** → 运镜时 ~12 次/秒的全量 React 重渲染，而 `docs/luna-tour-performance-rules.md` **明令禁止**这个形状。`useCountUp` 再叠一层每帧 `setVal`。欢迎页 60fps 无限空转 | `TimelineEngine.ts:592`；`OverlayLayer.tsx:235`；`TourOverlay.tsx:295` |
| 音频静默降级 + 8MB WAV | 单个 beat 失败 → `audio_url` 空 → **中途掉回浏览器 `speechSynthesis`**（两段 Aoede 中间夹一句机器人音），而**经纪端毫无提示**。7 个 session 里 1 个零音频。未压缩 24kHz WAV ≈ **720KB/beat × 11 ≈ 8MB** 推给手机 | `audio-pipeline.ts:114`；`audioTrack.ts:83` |
| **OG image 全 NULL** | 一个**唯一分发渠道就是往 WhatsApp 里粘链接**的产品，**分享出去是空白预览** | 7/7 session `og_image_url = NULL` |
| snapshot 字段名撒谎 | `elapsed_ms` / `total_ms` 里装的是 **beat 索引，不是毫秒** | `TimelineEngine.ts:603-604` |
| dwell 系统性少计 | `property_dwell` 只在**切段时**触发 → 最后一个 beat 永不记录；关标签页丢失当前 beat（无 `pagehide` flush） | `useTourTelemetry.ts:49` |

---

## ⚠️ 战略问题：修完这些也未必有人用

**两个可能致命的结构性障碍**（在修 bug 之前值得先想清楚）：

1. **`luna_tours` = 100 积分 + `minPlan: 'agent'`**（`credits.ts:48`）
   → **rookie 档经纪根本无法生成**。而 rookie 是大多数人所在的档。

2. **整个可选库存只有 `residential_projects` 的 23 行。**
   → 经纪自己的房源**大概率不在里面**。他为什么要用一个不含自己房子的工具？

> 现在的数据无法区分「因为它撒谎所以没人用」还是「因为它不含我的房子所以没人用」——**因为我们从来没让真实经纪用过。**

---

## 建议的顺序

1. **P0-C 安全**（匿名白嫖）—— 钱在漏，先堵
2. **P0-A + P0-B 停止撒谎**（编造 ROI / 地铁是药房）—— 合规 + 品牌，**这是可以让你被投诉的东西**
3. **P0-D 接线**（client_id + 行为回 CRM）—— 核心卖点目前是假的
4. **P1 schema + TTS 模型** —— 成本减半，静默失败消失
5. **然后**才谈 gate / 库存 / 播放器性能

**在 #1-#3 修完之前，不要给任何真实经纪推这个功能。**
