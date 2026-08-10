# API failures 巡检 + 修复（2026-08-10）

数据源：生产库 `perf_alerts` / `perf_minute` / `api_calls` / `app_events`（经 ssh →
`docker exec pinzos-api node` 查询，本机直连 5432 仍是 ETIMEDOUT）。

## 一句话结论

**近 14 天 21 条 5xx，全部集中在 08-09 的两次事故，且全部是我自己的测试脚本打的 —— 零真实客户。**
但巡检顺带挖出一个更值钱的洞：**客户浏览器里整页崩溃这件事，我们的告警系统完全不管**，
导致一个真实客户崩了 4 次、跨三周、没有任何人知道。三件事今天都已修复并部署。

## 一、5xx 分布（perf_minute，14 天）

| 日期 | 请求 | 5xx | 4xx | max_ms |
|---|---|---|---|---|
| 08-10 | 1935 | **0** | 39 | 1060 |
| 08-09 | 3763 | **21** | 134 | 1400 |
| 08-08 … 07-27 | 每天 400–6700 | **全 0** | 25–748 | 最高 6342 |

出现 5xx 的分钟只有 4 个：08-09 09:17（14 条）、10:01/10:02/10:03（共 7 条）。

## 二、两次事故都不是客户 —— 但取证过程值得记下来

判断"是不是真人"**不能看 `api_calls`**（它只记 visitor_id，看不出是谁）。
真正的证据在 `app_events` 的 `ua` + `ip_hash`：

**事故 #703 `GET /api/agent-match` 500 × 14**（08-09 09:16）
→ 受影响 `qa-visitor-1…10`，是 agent-match 派单改造时的 QA 跑分。现在复测返回 400。

**事故 #704 `GET /api/residential-projects/:id/insights` 500 × 7**（08-09 10:00–10:02）
→ 5 个 visitor **全部** `HeadlessChrome/148` + **同一个** `ip_hash 199b18aa…` + 路径全是
`/project/undefined` —— 我自己的 playwright 详情页巡检。

**近 24 天没有一个真人吃到过我们的 5xx。** 上一次真人 5xx 是 07-17 `1723545835@qq.com`
传头像的 500（事故 #684，已修）；07-14 那批 503 撞的是百度爬虫、部署重启期间。

### 但 #704 的 bug 是真的，而且当时还活着

`backend/src/routes/project-insights.ts` **没有 UUID 守卫**。非法 id 直接进 `WHERE id = $1`
→ Postgres uuid 转型报错 → catch 成 500。

这是 2026-07-11 事故 #666 **只修了一半**：当时给 `residential-projects` 主路由加了
`router.param('id')`，但 `project-insights` 是**单独注册、且挂在主路由之前**的第二个 router
（`index.ts:150`），`router.param` 不跨 router 生效，于是它下面三个路由一个守卫都没有。

**教训（写进记忆）：`router.param` 的守卫是 per-router 的。同一个 URL 前缀下挂了几个
router，就得加几次。**

## 三、真正被漏掉的东西：客户页面崩了，没有任何告警

`app_events` 里 30 天有 **18 条 `render_crash`**，其中真实客户：

| 客户 | 次数 | 页面 | 报错 |
|---|---|---|---|
| `1758494342@qq.com` | **4 次**（07-22 / 07-27 / 07-30 / 08-03） | `/map`、首页 | `removeChild / insertBefore: not a child of this node` |
| `l13541347198@gmail.com` | 3 次（07-15） | `/agent/plans`、`/choose-role` | `The object can not be found here`（iOS） |
| `huayingzeng8866@gmail.com` | 1 次（07-13） | 首页（iPad） | 同上 |

服务端 5xx 有一整套事故机制（立案、发邮件、永不自动恢复、必须写根因才能关），
**但客户端崩溃一条告警都不响** —— 它只静静躺在 `app_events` 里。
所以那位客户崩了四次、跨三个前端版本，直到今天手工翻表才发现。

**根因判断（高度怀疑，非定论）**：浏览器翻译插件 × React。
翻译器把文本节点摘走换成自己的 `<font>`，React 手里还攥着旧引用，下次 re-render
调 `removeChild` 时节点已不在原父节点下 → `NotFoundError` → 整棵树炸 → 弹到
`AppErrorBoundary` 的"出错了"卡片。iOS Safari 上同一个病叫 `The object can not be found here`。
受害者用 Edge + qq 邮箱，Edge 自带翻译对英文界面默认就翻。

**注意**：客户看到的**不是白屏**（`AppErrorBoundary` 早就存在，会显示一张"出错了 + 刷新"卡片），
但正在逛地图的人页面突然变成一张报错卡，体验依然是断的。

## 四、今天做的三件事（全部已部署 + 已验证）

### ① UUID 守卫（服务端 + 客户端双保险）

- `backend/src/routes/project-insights.ts` 加 `router.param('id')` UUID 校验，非法 id 返 404
- `frontend/src/lib/api.ts` 加 `isProjectId()`，`fetchProjectInsights` /
  `fetchNearbyCompare` / `fetchProjectTransactions` 在 id 不是 UUID 时**根本不发请求**
  （省一个必然失败的往返，也不再污染错误监控）

生产实测（部署后，容器内）：

```
/api/residential-projects/undefined/insights        -> 404  ✅（原 500）
/api/residential-projects/undefined/nearby-compare  -> 404  ✅（原 500）
/api/residential-projects/undefined/transactions    -> 404  ✅（原 500）
/api/residential-projects/not-a-uuid/insights       -> 404  ✅
/api/residential-projects/<真实 id>/insights         -> 200  ✅（没误伤）
```

### ② DOM 守卫 —— 直接掐掉那 6 次崩溃的病灶

新增 `frontend/src/lib/domGuard.ts`，在 render 之前包一层 `Node.prototype.removeChild` /
`insertBefore`：目标节点已经不在这个父节点下面时**不抛错，直接返回**。
对 React 来说"节点已经不在了"和"我摘掉了"结果一样，树不会炸；**翻译功能照常可用**
（没有粗暴地 `translate="no"` 把翻译能力砍掉）。

守卫命中时**每个会话上报一条遥测**（`kind: 'dom_mutation_guard'`），带翻译器指纹
（Edge 的 `_msttexthash` / Google 的 `translated-ltr` / 其他）。
**这条数据就是下次的证据** —— 上一个客户崩了四次我们查了三周才猜到原因，就是因为没有它。

### ③ 客户端崩溃立成事故（和 5xx 同等级）

新增 `backend/src/services/clientCrashIncidents.ts`，挂在 `eventIngest` 的
fire-and-forget 路径上（立案失败绝不能让客户那条上报请求失败）：

- `kind = 'CLIENT_CRASH'`，去重键 `页面|报错前80字`
- 重复命中累加 `count` + 追加 `victims`（去重、上限 10），**不刷屏**
- **永不自动恢复** —— 语义完全对齐 API_5XX
- 立案即发邮件；Admin「性能负载」tab 显示为「客户页面崩溃」并走事故文案
- 顺手把散在两处的字面量 `kind <> 'API_5XX'` 收成单一真源
  `backend/src/services/alertKinds.ts` —— 这个名单漏一处，后果就是**事故被状态机
  当成"已恢复"自动关掉**，正是当初要根治的病

生产端到端实测：POST 一条合成 `render_crash` → 立案 ✅、发邮件 ✅（`emailed=true`）；
再打两条 → 仍是 1 行、`count` 累到 3、`victims` 去重成 2 个 ✅。
**测试行已删除**（`perf_alerts` 1 行 + `app_events` 3 行），生产库无残留。

## 五、顺带清理

- **#703 / #704 的根因已补写回 `detail`**。两条在今早 07:24:48 被**批量关闭且没记根因**
  （毫秒级同一时间戳 = 一次 UPDATE，不是 dashboard 逐条 ack）。
  这违反 [[alerts-are-incidents-not-state]] 定的规矩：5xx 事故关闭时必须写清根因，
  否则就是"告警关了、bug 没动"。现在两条都带 `rootCause` / `fix` / `impact` / `closedBy`。
- **`DLD_SOURCE_STALE` 仍开着**（唯一未关闭的告警）。实测
  `dld_transactions.load_timestamp` 最新 = **2026-08-07 18:24 UTC**，最新成交日期 2026-08-06
  → **DLD 源头已 ~62 小时没发新数据**。不是我们坏了，但接近该找 DLD 问的时长。

## 六、还没做 / 留给下次

- **`network` 类失败 14 天 78 条 / 11 个真人**（`Load failed` / `Failed to fetch`）。
  这些请求根本没到我们服务器，所以永远不进 5xx 统计。绝大多数看起来是"用户切走/断网导致
  在途请求被取消"的良性噪音，**但没有逐条坐实**。顺带暴露一个真问题：
  **同一页面同一毫秒发了 3 个一模一样的 `GET /api/me/profile`** —— 重复请求本身该收掉。
- **翻译插件的根因没有复现坐实**。DOM 守卫是"无论根因是什么都该有"的兜底，
  真正的确认要等 `dom_mutation_guard` 遥测攒到数据（带翻译器指纹）。
