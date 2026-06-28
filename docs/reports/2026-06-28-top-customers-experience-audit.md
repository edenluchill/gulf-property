# Top Customers Experience Audit — 2026-06-28

数据窗口：`app_events` 2026-06-17 ~ 06-28（11 天，1977 事件）。来源表：`app_events`、`leads`、`luna_sessions`、`voice_sessions`。

## 1. 最有价值的 10 个客户（按参与度打分）

打分 = property_view×5 + luna_open×8 + search×4 + 总事件数。

| # | visitor (前8位) | 身份 | 页面 | 看房 | Luna | 搜索 | 会话 | api_error | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ce2a07df | **内部** lzp6529（你） | 392 | 17 | 6 | 0 | 16 | 15 | 大多是 /admin 自测 |
| 2 | 2fb881e0 | **内部** lzp6529 | 321 | 26 | 3 | 0 | 43 | 1 | |
| 3 | 83be2c8e | **内部** lzp6529 | 312 | 14 | 7 | 0 | 31 | 0 | |
| 4 | 4f16ace7 | shelldubai26（同事/经纪) | 132 | 20 | 3 | 1 | 53 | 0 | 真高意向使用者 |
| 5 | 8ded682d | **真实匿名访客** | 65 | 13 | 0 | 0 | 8 | 0 | 没用 Luna |
| 6 | 63889ccb | 内部 lzp6529 | 63 | 2 | 6 | 0 | 4 | 0 | |
| 7 | ad391edd | **真实访客** | 15 | 0 | 0 | 9 | 1 | 0 | 纯靠搜索探索 |
| 8 | c4ef81e7 | **真实访客** | 10 | 3 | 1 | 0 | 1 | **3** | 撞到 500 bug |
| 9 | 508771a7 | 真实匿名 | 16 | 2 | 0 | 0 | 1 | 0 | |
| 10 | da18410e | 真实匿名 | 5 | 3 | 0 | 0 | 3 | 0 | |

**重要现实**：榜单前列被内部测试账号（`lzp6529@gmail.com`=你本人、`shelldubai26@gmail.com`）占据。真正的外部潜在客户量还很小（8ded682d、ad391edd、c4ef81e7…）。

## 2. 漏 track 的信息（缺口）

1. **`leads` 表 0 行** —— 有 lead 引擎但零产出。根因：前端**只在 Luna 语音助手收集到联系方式时**才建 lead（`/api/leads/contact`）。没有被动留资表单，也不会把高意向行为信号（重复看房、长会话）转成 lead。结果：53 次会话/20 次看房的 shelldubai26 这种高意向用户永远不进 lead 池。
2. **无转化/联系意图事件**：没有 `whatsapp_click` / `phone_click` / `contact_click` / `report_view` / `save_favorite` / `lightbox_open` / tour 互动。看得到客户「看了什么」，看不到「想不想联系」。
3. **无停留时长 / 滚动深度**：`page_view`、`property_view` 只记一次曝光，没有 dwell time，无法衡量单页兴趣深度（Luna/voice 有 duration，普通页没有）。
4. **`luna_open` / `search` 不带 project_id 上下文**（`property_view` 已带，127/127 ✅，可正常关联项目）。

> 建议优先级：①把 lead 捕获从「仅语音」扩成「高意向行为自动建 lead + WhatsApp/电话点击留资」；②加联系意图事件；③加 dwell time。这些是新功能，未实现，仅作建议。

## 3. 体验问题与修复

### ✅ 已修复：项目详情页 area-insights 返回 500（真实客户撞到）
- **现象**：visitor `c4ef81e7` 与 `0eae2413` 在 `/project/f11a4ae4…`（City of Arabia）反复触发 `GET /api/market/area-insights?areaId=466 → HTTP 500`。详情页「位置/区域行情」区块直接报错。
- **根因**：`projectInsights.ts` 的 **Tier 1（development）** 把 `area.id` 设成了 DLD 整数 `area_id`（`String(resolvedAreaId)` = "466"），而 Tier 2/3 用的是 `dubai_areas` 的 **uuid**。前端 `LocationTab` 拿这个 id 去打 area-insights，后端用整数和 uuid 列比较 → Postgres `invalid input syntax for type uuid` → 500。
- **修复**：
  1. `backend/src/services/projectInsights.ts` — Tier 1 改用 `areaMetrics?.area_id ?? null`（uuid），与 Tier 2/3 统一；无 rolling metrics 时回落 null（前端跳过请求，安全降级）。
  2. `backend/src/routes/market.ts` — area-insights 端点加 uuid 正则校验，非 uuid 返回 **400** 而非 500，杜绝整类「整数 → Postgres uuid 报错 → 500」。
- **生产验证**（已部署 tag `20260628-151140`）：
  - `/insights` 现返回 `area.id=6d4f9f96-…`（uuid）✅
  - area-insights uuid → **HTTP 200**（City of Arabia 含 5550 条成交，数据正常）
  - area-insights 整数 466 → **HTTP 400**（不再 500）

### ⚠️ 已知未在本次处理（属更大改造，已有 proposal）
- **Luna 高延迟导致放弃**：22 个 Luna 会话中 7 个单轮（32% 开了就走）；voice 日志显示首响 5s、回复延迟 9–12s。见 memory `luna-experience-redesign`。
- **Lead 捕获缺口**：见上 §2.1。

## 部署
- 已 `quick-deploy.ps1 -SkipWorker`，API 健康。**改动尚未 git commit**（quick-deploy 从工作区构建镜像，生产已生效但 git 未留痕）—— 需要的话我可以补一个 commit。
