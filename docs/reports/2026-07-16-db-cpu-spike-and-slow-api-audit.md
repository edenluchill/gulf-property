# DB CPU 尖峰 + 慢接口排查

日期:2026-07-16
触发:owner 看 Hetzner `gulf-property-db` (CPX22) 图,CPU 冲到 100%+
结论:**良性,不用管**。是每 5 小时一轮的缓存预热器,真实用户零影响。

---

## 一、时间对齐:图上那根柱子是什么

Hetzner 图显示 **00:34–00:37**(本地 PDT)CPU ~105%,之后归零。
PDT = UTC−7 → **UTC 07:34–07:37**。

`perf_minute` 同一窗口:

| 07-16 UTC | req | query_count | p50 | p95 | p99 | max_ms | err5 | slow_req | pool_waiting |
|---|---|---|---|---|---|---|---|---|---|
| 07:33 | 0 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 07:34 | 12 | 664 | 6 | 78 | 78 | 78 | 0 | 0 | 0 |
| **07:35** | **58** | **1250** | 3 | **38** | 565 | 565 | **0** | **0** | **0** |
| 07:36 | 23 | 610 | 3 | 4 | 5 | 5 | 0 | 0 | 0 |
| 07:37 | 43 | 138 | 4 | 460 | 488 | 488 | 0 | 0 | 0 |
| 07:38 | 5 | 13 | 3 | 12 | 12 | 12 | 0 | 0 | 0 |

基线是 `req 2/min · query 10/min`。峰值 **1250 query/min = 125× 基线**,
而 req 只有 58 → **每请求 21 条查询**。

这就是 [[warmer-starves-live-traffic]] 记的指纹:**req 少而 query_count 多 = 后台任务**。

---

## 二、真凶:`warmAreaInsights`(每 5 小时)

`src/routes/market.ts:1152`
```ts
setTimeout(warmAreaInsights, 30_000)
setInterval(warmAreaInsights, 5 * 60 * 60 * 1000)
```
（另有 `src/routes/project-insights.ts:48` 的 `warmAllProjectInsights`,6 小时一轮）

**证据链:**

1. **量级对得上**:循环 `SELECT id FROM dubai_areas WHERE visible = true`(~210 区)
   × `WARM_USAGES`(2 个口径)× 每次几条 DLD 重聚合 ≈ **~1250 条**。就是 07:35 那个数。
2. **周期对得上**:按小时聚合 `query_count`,**严格 5 小时一根柱子**——
   07-15 21:00(7997)→ 07-16 02:00(3033)→ 07-16 07:00(5304)。
3. **采样的 `api_calls` 佐证**:该窗口内出现 `POST /api/luna/agent/sessions/create`
   + `.../render`,`whos = 0`(无 user_email/visitor_id)——非真人流量。
4. **CPU 形状对得上**:见下。

### 为什么是 CPU 满而磁盘几乎不动

DISK THROUGHPUT 读峰值只有 **2MBps**,IOPS ~300。

`dld_transactions` = 573MB,`shared_buffers` = 65536 × 8KB = **512MB**
→ 热表基本**全在内存**里,全表扫是**纯 CPU 不读盘**。

⚠️ 这跟 [[db-disk-io-blowup]] 那次(磁盘 IO 打爆、缺 `area_id` 索引)是**相反的指纹**,
别搞混。累计 `seq_scan` 大(`dld_transactions` 16276 次 / 110 亿行)是**历史存量**,
不代表现在还在扫。

### 为什么是 ~105% 而不是 150%

预热器是**串行循环**(`for` + `await`,一次一条查询),天花板就是 **1 个核**。
Hetzner y 轴标注「1 vCPU = 100%」,所以多核机器上 105% = 一个核忙 = 正常形状。

---

## 三、关键判断:修复生效,真人零影响

两个预热器**都已经**带 `yieldToLiveTraffic()` + 250ms sleep(2026-07-14 的修复还在)。
实测它在干活:

- **err5 = 0**
- **slow_req = 0** / **slow_query = 0**
- **p95 = 38–78ms**(峰值分钟)
- **pool_waiting = 0**

**CPU 高 ≠ 用户受伤。** 判断标准是 p95 / err5 / slow_req,不是 CPU 图。
占空比 ≈ 3 分钟 / 5 小时 = **1%**。

> 注:进程重启后 30s / 45s 各会跑一轮预热 —— **每次部署完必有一根柱子**,正常。

**建议:不改。** 这是拿 1% 的空闲 CPU 换「客户点任何区域都秒回」,交易划算。

---

## 四、慢接口排查:没有系统性问题

### 4.1 `/api/meta/data-freshness` —— 已于 07-15 15:00 自愈,勿再查

昨天 12 次 ~4.3s,看着最可疑。但:

```
EXPLAIN (ANALYZE, BUFFERS) → Execution Time: 0.614 ms
  Index Only Scan Backward using dld_transactions_new_instance_date_idx
  Index Only Scan using dld_transactions_load_ts_idx
  Index Only Scan using dld_rent_contracts_load_ts_idx
```

**三条 max() 全部走 Index Only Scan,0.6ms。索引在,SQL 不慢。**

最后一次慢是 **07-15 14:57**;`HIGH_LATENCY` 告警也停在 **07-15 14:59**。
此后 ~17 小时全表只有 **4 条**慢请求。生产实测 TTFB **186–207ms**(含跨洋 RTT)。

→ 对应 [[data-freshness-load-timestamp-index]] 那次修复,**已经生效了**。

### 4.2 ⚠️ 陷阱:`perf_slow_requests.at` 不是请求时刻

那 12 条的 `at` 全落在 **`:07.5xx` 秒**,毫秒还单调漂移:
`.495 → .500 → .504 → .505 → .510 → .523 → .540 → .552 → .566 → .578 → .595 → .633`

这是 **perfSink 定时 flush 的时间戳 + 经典 setInterval 漂移**,不是请求发生的时间。
**别拿它跟 CPU 图/其他事件做时间对齐**(`perf_minute.minute` 才是可靠的分钟桶)。
`duration_ms` 本身是真的。

### 4.3 其余慢请求:全是孤例,无模式

| 接口 | 次数(24h) | max_ms |
|---|---|---|
| `GET /api/admin/insights/collab/:code` | 1 | 5844 |
| `GET /api/luna/agent/profile` | 1 | 5656 |
| `GET /api/market/area-appreciation` | 1 | 2248 |
| `GET /api/market/transactions/filters` | 1 | 1964 |
| `GET /api/market/transactions/list` | 1 | 1640 |
| `GET /api/market/area-insights` | 1 | 1430 |

均为单次(多半冷缓存首击),admin 接口只有自己用。**不值得动。**

### 4.4 告警面板

7 天内:`HIGH_LATENCY` 16 条(全部 resolved,最后 07-15 14:59)、
`HIGH_ERROR_RATE` 2 条(resolved)、`API_5XX` 1 条(resolved)。

**仍开着的 2 条**:`DLD_SOURCE_STALE` + `DLD_RENT_SOURCE_STALE`(07-14 19:34)——
是 DLD 源头断更,不是我们的故障,见 [[dld-freshness-load-timestamp]]。

---

## 五、顺带发现(未处理)

- **`pg_stat_statements` 没装**。这次全靠自建遥测 + `pg_stat_user_tables` 推断。
  装上(需要改 `shared_preload_libraries` + 重启)以后这类排查能几分钟结案。
- **`listen_addresses = '*'`**,DB 对全网开放 —— 已知安全债,见记忆里的
  [[dubai-data-rebuild-box-sync]]。本次尖峰与之无关。
- `random_page_cost = 1.1` ✓(已是 SSD 值),`shared_buffers = 512MB`。

---

## 六、一句话结论

**CPU 图那根柱子是每 5 小时的区域预热器,串行占 1 个核约 3 分钟,
真实用户 p95 38ms、零错误、零慢请求。没有慢接口。什么都不用做。**
