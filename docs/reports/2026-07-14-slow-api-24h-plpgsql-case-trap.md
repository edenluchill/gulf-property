# 过去 24 小时慢接口全面排查 —— 三个根因,一个是我自己造的

**日期**:2026-07-14
**触发**:owner 在 admin「性能负载」看到 `GET /api/ai/analytics/investment` 反复 5.5s / 7.8s / 9.0s / 5.8s
(真实客户:graceww1110、shelldubai26、joe.liang),问「过去 24 小时还有哪些接口慢」。

---

## TL;DR

| 接口 | 修复前 | 修复后 | 根因 |
|---|---|---|---|
| `GET /api/ai/analytics/investment` | **5.5–9.0 s** | **0.19–0.48 s** | plpgsql 的 `CASE` 谓词让索引全废 + 每次现算全城中位数 |
| `GET /api/luna/public/evidence` | 1.1–2.1 s(**41 次/天**) | **~0.3 s**(最坏情况 1826ms → **1.6ms**) | `ORDER BY … LIMIT 3` 无时间下界,匹配不上的项目名要倒扫完整个索引 |
| `GET /api/residential-projects/:id/insights` | 偶发 **7.6 s** | 结构性修复 | **缓存预热器饿死前台真实用户** |

其余(`area-insights` 2.7s、`rent/projects` 1.4s、4 个地图接口各 ~1.0s)**都是一次性的**,
且全部发生在 **07-13 10:25 同一分钟** —— 那是**部署后冷启动**(缓存全空),不是系统性问题。

---

## 0. 先认一个错:我差点把这个问题永久藏起来

昨天为了压 HIGH_LATENCY 误报,我在 `perfMetrics.ts` 里加了一条排除规则:

```ts
const AI_SLOW_PATTERNS = [
  /^\/api\/ai\//,      // ← 「AI 接口天生慢,别算进 p95」
  /^\/api\/compare/,
  ...
]
```

**理由是「路径里有 ai,肯定在等 Gemini」。这个理由是错的。**

- `ai-analytics.ts`(investment / recommend / affordability / rent-vs-buy…**8 个端点**)—— **零个 AI 调用**,
  全是 SQL + plpgsql 函数
- `ai-projects.ts` / `ai-areas.ts` / `compare.ts` —— **同样零个 AI 调用**
- 路径里的 `ai` 只是「给 Luna 用的数据接口」的命名习惯

于是 owner 一眼就能在 dashboard 上看到的 **9 秒真实慢查询**,被我归类成了「AI 天生慢,不用管」。

**把真问题排除出监控,比没有监控更糟** —— 没有监控你至少知道自己瞎了。

已改:排除清单现在只留**真正同步 `await` 一个会调 Gemini 的函数**的路径,而且逐个 grep 验证过
(`ai-edit` → `revise()`;`profile-coach` → `coachProfile()`;`client-reports` → `buildClientReport()`)。
连 tour 的 create/render 都不排除 —— 它们**立即 `res.json` 返回**,AI 在后台跑,HTTP 本来就快。

---

## 1. `/api/ai/analytics/investment`:5.5–9.0 s → 0.19–0.48 s

它调的是 plpgsql 函数 `investment_analysis()`(不是 AI)。实测 `area_investment_report()`(同族,
`/project-value`、`/rent-vs-buy` 在用)一次要 **3553 ms,碰 240 万个 buffer ≈ 18 GB**。

### 病灶 A —— plpgsql 里的 `CASE` 谓词:**索引全废**

七条查询,每条都长这样:

```sql
WHERE (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block
            ELSE area_name ILIKE v_like END)
```

`v_block` 是**变量**。规划器在**计划期不知道它是不是 NULL**,只能为两个分支都留后路 →
**没有一个索引用得上**。

> 🔴 **这就是它能活这么久的原因:手测永远复现不了。**
> 你在 psql 里拿字面量 EXPLAIN,PG 会把 `CASE` 常量折叠掉 —— 看到的是 46ms 的漂亮 Index Scan。
> 只有**真实调用**(参数是变量)才慢。
>
> **要验证 plpgsql 函数里的性能,必须在函数内部逐句 `clock_timestamp()` 计时**,
> 或者用参数化的 `PREPARE`。外面 EXPLAIN 出来的计划**不是**它真正跑的那个。

**修法**:开头把区域**解析一次**成 `area_id[]`,之后所有查询统一用 `area_id = ANY(v_area_ids)` ——
一个裸列谓词,索引直接可用。

**等价性已证明**(不是推理,是对拍):
- 203 个区里 `dld_transactions.area_name` 与 `dld_areas.area_name` **零处不一致**
- 60 个区逐区对拍新旧谓词:**60/60 完全一致,82,508 行两边相同**

### 病灶 B —— 每次请求现算「全城中位数」

```sql
SELECT percentile_cont(0.5) … FROM v_sales
 WHERE ptype = p_ptype AND (v_off IS NULL OR is_offplan = v_off)
   AND txn_date >= CURRENT_DATE - INTERVAL '12 months';   -- 注意:没有区域过滤
```

这个数**跟查哪个区完全无关**,只取决于 `(ptype, 口径)`,却**每次请求都要 Parallel Seq Scan
整张 `dld_transactions`**(340 ms)。

> ⚠️ **注意是 *Parallel*** —— PG 开多个 worker 一起扫。**Hetzner 图上那个 CPU 150%,就是它。**
> 单个请求就能吃满多核。

**修法**:预算进 `mv_city_baseline (ptype, seg)`,随 `refresh-derived.ts` 每日刷新。
340 ms → **0.4 ms**。校验:MV 值 = 现算值 = **18905**,逐位相同;`vs_city_pct` 46.3% 对得上。

### 病灶 C —— 租金查询走错索引(4.7 GB 表)

`v_rent` 里写的是 `COALESCE(r.dubai_area_id, dla.dubai_area_id)` —— 为了给 **3%** 没有
`dubai_area_id` 的行做 JOIN 兜底。代价:**COALESCE 谓词匹配不上任何裸列索引**
(老坑,见 `area-insights-slow-query-indexes`)。

雪上加霜:我 07-13 建的 `idx_rent_area_id_resid` 是 `WHERE usage_type='Residential'` 的
**部分索引**,而 `v_rent` **根本没有 `usage_type` 谓词** → 规划器不敢用它。**那个索引白建了。**

**修法**:
1. **回填**那 17 万行(559.7 万行里 542.7 万本来就有,只有 3% 缺)
2. `v_rent` 去掉 COALESCE → 裸列 → 索引可用
3. 建 `idx_rent_area_start (area_id, start_date DESC) INCLUDE (...)`(**非部分索引**)

857 ms → **36 ms**(Index Only Scan)。

**等价性对拍**:60 个区,**60/60 一致,312,489 行两边相同**。

> ⚠️ **回填必须每日跟着同步跑**(已写进 `scripts/refresh-derived.ts`)。
> 视图已经没有 COALESCE 兜底了 —— 新同步进来的行如果 `dubai_area_id` 是 NULL,
> 会**从区域查询里静默消失**(不报错,就是少数据)。**删掉那段回填 = 数据慢慢烂掉且没人发现。**

---

## 2. `/api/luna/public/evidence`:最坏情况 1826 ms → 1.6 ms

**量最大的一个**:24 小时内 **41 次**慢请求,全是**真实客户**,最近一次就在今早 07:24。

```sql
SELECT … FROM dld_transactions
 WHERE trans_group='Sales' AND project_name ILIKE $1
   AND instance_date <= $2          -- ← 只有上界,没有下界
 ORDER BY instance_date DESC, id DESC
 LIMIT 3
```

`ORDER BY instance_date DESC LIMIT 3` 会**从最新一天开始倒着走索引**,直到凑够 3 条匹配的行。

- 项目名**匹配得上** → 1.3 ms
- 项目名**匹配不上** → **1826 ms**(走完 76 万行,一条都没找到)

**而 memory 里早就记着:DLD 的项目名是阿拉伯语转写,匹配率只有 1/16。**
所以**绝大多数 tour 项目走的都是这条 1.8 秒的死路**。

**这不只是慢,它是那个已知的名称匹配失败在性能上的投影。**

**修法**:建 trigram GIN 索引(`pg_trgm` 本来就装着),让 ILIKE 本身变得可索引:

```sql
CREATE INDEX CONCURRENTLY idx_tx_project_name_trgm ON dld_transactions USING gin (project_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_tx_area_name_trgm    ON dld_transactions USING gin (area_name    gin_trgm_ops);
```

1826 ms → **1.6 ms**。**纯索引层,零业务语义改动。**

---

## 3. `/api/residential-projects/:id/insights` 偶发 7.6 s —— 预热器饿死真实用户

我 07-13 修完索引后,它还是在 **07-14 05:17:53** 让一个匿名客户等了 **7.6 秒**。
查 `perf_minute`,指纹很清楚:

| 时间 | 请求数 | **查询数** | p95 |
|---|---|---|---|
| 05:16 | 14 | 40 | 290 ms |
| **05:17** | **9** | **704** | **7659 ms** |
| **05:18** | 21 | **1207** | 6 ms |
| 05:19 | **0** | **481** | — |

**`req` 少而 `query_count` 多 = 后台任务饿死前台**(memory 里记过这个指纹)。

是缓存预热器(`warmAllProjectInsights` / `warmAreaInsights`)。**它们已经每项 sleep 250ms 了** ——
但那管的是**节奏**,不是**优先级**。它照样每秒往 DB 灌十几条**打 DLD 大表的重聚合**。
那一分钟 **`pool_waiting = 0`** —— **不是连接池被占满,是 DB 的 CPU 被占满**。
客户请求了一个还没预热到的项目,他的查询就在 DB 里排队等 CPU。

**修法**(`perfSink.yieldToLiveTraffic()`):预热器在**每一项之前**检查有没有真人在飞,有就等。

```ts
export async function yieldToLiveTraffic(maxWaitMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs
  while (activeConcurrency > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
}
```

**预热是没有 deadline 的活:晚 10 秒热完没人在乎,让一个真人等 7 秒有人在乎。**
`maxWaitMs` 是防呆 —— 万一有个长连接一直挂着,预热不能永远停摆。

---

## 生产实测(含 ~160 ms 加拿大→德国网络往返)

```
/api/ai/analytics/investment?area=Dubai Marina      0.384 s  (200)
/api/ai/analytics/investment?area=Business Bay      0.354 s  (200)
/api/luna/public/evidence?project=Damac Lagoons     0.317 s  (200)
/api/luna/public/evidence?project=<匹配不上的名字>   0.352 s  (200)   ← 以前是最坏路径
```

数值抽查(确认没改坏):Marina 中位价 3,199,944 AED / 36,975 每㎡ / 毛回报 3.11% / 净回报 2.45% /
样本 5,808 笔成交 + 37,049 份租约 / confidence high。

---

## 改动清单

**DB(已上线)**
- `src/db/fix-investment-report-slow.sql` —— 回填 `dubai_area_id`、`v_rent` 去 COALESCE、`mv_city_baseline`
- `src/db/dubai-analytics-v2-report.sql` —— `area_investment_report`:去 CASE、读 MV
- `src/db/dubai-analytics-v2-functions.sql` —— `investment_analysis`:去 CASE
- 索引:`idx_rent_area_start`、`idx_tx_project_name_trgm`、`idx_tx_area_name_trgm`
  (删掉了建错列的 `idx_rent_dubai_area_start`)

**代码(已部署)**
- `src/middleware/perfMetrics.ts` —— 排除清单收窄到真正同步调 AI 的路径
- `src/services/perfSink.ts` —— 新增 `yieldToLiveTraffic()` / `liveRequestsInFlight()`
- `src/routes/market.ts`、`src/routes/project-insights.ts` —— 预热器给活人让路
- `scripts/refresh-derived.ts` —— 每日回填 `dubai_area_id` + 刷 `mv_city_baseline`

---

## 三条能带走的教训

1. **plpgsql 函数的性能,不能在函数外面测。** 变量谓词(尤其 `CASE`/`COALESCE`)会让规划器
   放弃索引,而拿字面量 EXPLAIN 会把它折叠掉 —— **你看到的计划不是它跑的计划**。
   要么在函数里 `clock_timestamp()` 逐句计时,要么用参数化 `PREPARE`。

2. **`ORDER BY … LIMIT n` + 选择性差的过滤 = 定时炸弹。** 命中时飞快,不命中时扫全表。
   **平均值会骗你,最坏情况不会。**

3. **别按名字猜一个接口在干什么。** 我因为路径里有 `ai` 就假设它在等模型,
   差点把一个 9 秒的慢查询永久排除出监控。**grep 一下,五秒钟的事。**
