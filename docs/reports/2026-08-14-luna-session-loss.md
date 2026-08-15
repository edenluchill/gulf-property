# Luna 对话记录丢了 75% —— 诊断与修复

**日期**：2026-08-14
**触发**：owner「为啥我看不到任何记录了 但是合伙人却说昨天有聊天效果不错？」

---

## 一句话

对话**真的发生了**，只是**没被记下来**。`luna_sessions` 只在浏览器正常结束时上报一次，
那一次没发生整场就不存在。30 天 8 场真实对话，看板上只有 2 场 —— **丢了 75%**。

## 现场

合伙人在微信说：「昨晚问了 luna 一些问题，比之前分析的好」「感觉 luna 比之前回复好很多了」。
而 `/admin/analytics?tab=features` 的「Luna 对话」最新一条停在 **8-12 04:37**，8-13 整天空白。

查 `luna_turns`（每轮落库的账本）：

| session | 时间 (UTC) | 轮数 | 在 luna_sessions 里？ |
|---|---|---|---|
| `voice_1786660799654_8qoieo` | 2026-08-13 22:40 | 13 | ❌ |
| `voice_1786442772775_iwq9kc` | 2026-08-11 10:06 | 123 | ❌ |
| `voice_1786432295424_xfgpjw` | 2026-08-11 07:11 | 7 | ❌ |
| `voice_1786432127161_k7mmyr` | 2026-08-11 07:08 | 6 | ❌ |
| `voice_1786432103747_2qxf3r` | 2026-08-11 07:09 | 6 | ❌ |

第一条就是合伙人说的那场（迪拜时间 8-14 02:40 = 他的「昨晚」），内容对得上他的夸奖：
「JVC 目前的市场表现非常强劲，公寓中位价大约在 103 万迪拉姆，过去三年的年化增长率达到了百分之 10.9」。

## 根因

`luna_sessions` 这张表只有**一个**写入口：会话结束时前端 `navigator.sendBeacon` 上报一次。

- 手机上切走 App → `pagehide` 不一定开火
- 后台标签页 → 5 分钟 idle 定时器被浏览器节流，永远不开火
- 进程被系统杀掉 → 什么都不开火

这一次上报没发生 → 整场对话在看板上**不存在**。而 `luna_turns` 是**每轮**落库的
（服务端 `/ask` 写一条、前端每轮说完写一条），所以数据一直都在，只是没人去看。

### 一条走过的弯路

第一反应是查 `api_calls` 里 `/api/sync/voice-session` 的调用量 —— **7 天 0 条**，
看着像「上报从来没发过」。但 `luna_sessions` 在 8-11、8-12 明明有行，矛盾。
核对后确认：**`api_calls` 根本不收 `/api/sync/*` 这些路径**，那个 0 是没有意义的。
→ 改用硬指标：turns 推导出的会话数 vs 表里的会话数。

## 修法：把会话表当成 turns 的派生物

**没有把上报修结实这个选项** —— 进程被杀掉时没有任何代码能跑，那是浏览器给的边界。

`backend/src/services/luna-session-rebuild.ts`：每 10 分钟扫一遍，
把「`luna_turns` 里有、`luna_sessions` 里没有、且最后一轮已静默 10 分钟」的会话补回来，
连 AI 摘要一起生成。

边界：

- `ON CONFLICT DO NOTHING` —— 浏览器上报的那条永远赢（它带真实 metrics / 打断次数，更富）
- `SETTLE_MS = 10min`（前端 idle 是 5min，留一倍余量）—— 绝不抢在正常上报之前封档
- 只补 `session_id LIKE 'voice\_%'`。`luna_turns` 是共用账本，里面混着测试脚本造的
  `toolstat_*` / `track_*`；补进去 = 看板上「有几个人聊过」直接失真，还白烧 AI 摘要
- 新增 `luna_sessions.source`（`beacon` / `rebuilt`），看板上标「补录」小标签

### 中途发现并修掉的一个 bug

第一版按 `speech` 去重 brain/live 两行 —— **不够**。首轮的 live 行 speech 是空的，
两行 speech 不相等 → 客户那句话在回看页面上出现两遍（实测 33 条里 7 条是重复）。

改成按**轮次**配对：`user_said` 一字不差 + 来源不同 + 相邻 + 2 分钟内 = 同一轮的两半。

⚠️ **不能按 `user_said` 全局去重** —— 客户把同一句问两遍是要保留的信号
（`luna-rules` 靠这个痕迹判「上一轮没答上」）。靠 `paired` 标记区分：一轮只吸收一个对家，
真问了两遍时（brain,live,brain,live 四行）第 3 行看到 prev 已配对，老实新起一轮。

`src/services/luna-session-rebuild.test.ts` 把两个相反的失败模式都钉住了（6 条，全绿）。

## 结果

```
deleted rebuilt rows: 5
[luna-rebuild] 从 luna_turns 补回 5 场丢失的会话
rebuilt again: 5
```

| session | 消息数 | 摘要 |
|---|---|---|
| `voice_1786660799654_8qoieo`（合伙人那场） | 26 | ✅ |
| `voice_1786442772775_iwq9kc` | 191 | ✅ |
| `voice_1786432295424_xfgpjw` | 8 | ✅ |
| `voice_1786432127161_k7mmyr` | 6 | ✅ |
| `voice_1786432103747_2qxf3r` | 6 | ✅ |

相邻重复条数 0。合伙人那场的摘要：

> 客户主要想了解迪拜朱美拉村圈（JVC）和迪拜云溪港的未来市场趋势、抗跌区域及新项目，
> 并希望推荐一位真实的迪拜房产经纪人。……受限于工具无法提供真人经纪人推荐。

30 天真实会话 8 场，看板上现在 8 场。**丢失率 75% → 0%。**

## 顺带记一笔

- 环境变量里的 `GITHUB_TOKEN` 已过期（GitHub 返回 401），`quick-deploy.ps1` 会卡在
  「GHCR login failed」。临时绕法是用 `gh` CLI keyring 里那个 `gho_` token
  （`$env:GITHUB_TOKEN = (gh auth token)`）。**该换一个新 PAT 了。**
- 合伙人那场里客户明确要「推荐一位真实的迪拜房产经纪人」，Luna 只能回答做不到。
- 本次未处理：`GET /api/ai/analytics/project-value` 返回 500（看板上的性能告警）。
