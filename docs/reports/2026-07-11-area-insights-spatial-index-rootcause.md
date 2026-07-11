# area-insights 反复 HIGH_LATENCY 告警 —— 根因与修复

日期:2026-07-11
触发:admin 性能负载 tab 一条「进行中」告警 p95 8204ms(阈值 2000ms)

---

## 1. 先纠正两个错误认知

**「已恢复」≠ 修好了。**
告警的恢复判据是**全站 p95 回落到阈值以下**。半夜没人访问,p95 自然回落,告警自动关闭 —— 根因一个没修。
过去一周 9 条 HIGH_LATENCY 全部「已恢复」,但问题一直在。用流量低谷冒充修复。

**告警列表里最扎眼的那条不是最严重的。**
UI 上看到的是 8204ms。翻 `perf_minute` 才发现真正的尖峰:

| 时间(UTC) | max_ms | 当分钟请求数 | 当分钟 SQL 数 |
|---|---|---|---|
| 07-04 21:09 | **192112** (192秒) | 1 | 190 |
| 07-07 22:57 | 153110 | 3 | 45 |
| 07-07 22:29 | 142083 | 4 | 34 |
| 07-09 08:46 | 103076 | 2 | 75 |
| 07-08 22:14 | 98067 | 2 | 49 |
| 07-11 08:40 | 50006 | 9 | 47 |

注意:**卡死时请求数极少(1-4 个),但 SQL 数很高(34-190 条)。**
那几百条 SQL 不是客户打的,是**预热循环**在跑。客户那一两个请求,是被预热活活饿死的。

---

## 2. 一个被否掉的假根因(重要)

第一版诊断(cx-guardian agent 自动给出并已 commit)认为:

> 预热只暖 `usage='all'`,但前端默认口径是 `residential`,缓存键永远对不上 → 预热完全空转。

**这是错的。** 证据链:

- `frontend/src/lib/api.ts:107` —— 默认口径 `residential` 时**根本不发 `usage` 参数**
- `backend/src/routes/market.ts:828` —— 参数缺省时后端解析成 **`'all'`**
- 所以客户默认请求命中的键就是 `insights:<id>:all`,**正是旧预热写的键 —— 键是对得上的**

实测佐证:生产默认口径响应 **0.20-0.24s**(基本是到德国的网络往返),缓存本来就在生效。

该 commit 还顺手多暖了一个 `residential` 口径 —— 全代码库**没有任何调用方**请求这个口径(前端剥参数、Luna 工具和报告页都不传)。纯烧 DB,还把预热对线上请求的挤占窗口拉长一倍。已回退。

**教训:根因必须落到可证伪的因果 + 实测,不能靠读代码"看起来对"。**

---

## 3. 真根因(实测)

`loadAreaInsightsData` 对**手绘区域**走 spatial 模式:
先用 `ST_Covers` 从 `dld_project_locations`(4211 行)筛出落在多边形内的项目点,再回连成交/租约。

回连谓词是一个 **COALESCE 表达式**:

```sql
loc.project_name = COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__')
```

已有索引 `idx_tx_area_project` 是**裸列** `(area_name, project_name)` —— **匹配不上这个表达式**。

EXPLAIN 证据(JLT):

```
Nested Loop  (actual time=33.5..2345.7 rows=30196)
    Filter: (loc.project_name = COALESCE(NULLIF(project_name,''), ...))
    Rows Removed by Filter: 35080          ← 读 65k 行扔掉 35k
Execution Time: 2347.948 ms                ← 单条聚合;整个接口跑 7 条并行
```

**规模:210 个区域里 105 个是手绘的**(没有官方 DLD area_id),**一半的区域都走这条慢路径。**

### 为什么平时看不出来
- microCache(6h TTL)平时把它盖住了 → 稳态 0.2s
- 但缓存是**进程内**的,**每次部署重启就清空**
- 冷窗口里(重启 → 预热跑完,好几分钟)客户点 JLT 就吃满 9 秒
- 旧代码**没有 single-flight** → 地图弹窗并发几发全部并行跑 9 秒重聚合 → 撞出 50 秒被浏览器放弃

**一句话:8.8 秒的冷查询 + 每次部署清空缓存 + 无 single-flight + 预热饿死请求 = 那串 50s/98s/192s。**

---

## 4. 修复

### 4.1 表达式索引(真根因,纯 DB 层,已上生产)

`backend/src/db/add-area-insights-spatial-indexes.sql`

```sql
CREATE INDEX CONCURRENTLY idx_tx_area_projkey
  ON dld_transactions (area_name,
    (COALESCE(NULLIF(project_name,''), NULLIF(building_name,''), '__AREA__')));

CREATE INDEX CONCURRENTLY idx_rent_area_projkey
  ON dld_rent_contracts (area_name,
    (COALESCE(NULLIF(project_name,''), '__AREA__')));
```

（`dld_transactions` 97 万行,`dld_rent_contracts` 560 万行;`CONCURRENTLY` 不锁表,免部署即时生效)

### 4.2 保留 single-flight
路由改用 `microCache.cached()`:冷键上 N 个并发 miss 合并成 1 次查询。
(这部分是 agent 那版唯一真正有价值的改动,保留)

### 4.3 预热口径回退到 `['all']`
砍掉没人请求的 `residential`,预热成本减半 → 挤占窗口减半。

---

## 5. 验证(实测,非推测)

| 场景 | 修复前 | 修复后 |
|---|---|---|
| JLT 冷查询(端到端) | **8.83s** | **0.43s** |
| 底层 SQL(EXPLAIN) | 2347ms | **683ms** |
| 部署后冷窗口 JLT(最恶劣时刻) | ~8.8s | **1.83s** |
| 稳态(JLT/BB/Marina) | — | **0.21s** |
| 并发 5 发同一区域(冷) | 1条8.2s + 2条挂50s | **全部 0.33-0.40s** |

部署后无新告警,p95 回到 200-600ms。

---

## 6. 受影响的真实客户

查 `api_calls`(排除 admin),过去 7 天撞到 >3s 的真实访客:

- **全部集中在 07-07 的项目详情页**(10-22 秒),约 18 个匿名访客,每人 2 次
- 那个是**另一个** bug(projectInsights 慢),已在 07-07 修掉(commit `d5ceb5b`),现在均值 103ms、近 3 天 0 次慢
- 附带确认:当时"每人恰好 2 次、耗时几乎相同"的重复请求现象,近 3 天已归零

**area-insights 这条路径上没有查到明确的外部客户受害记录** —— 因为采样表漏掉了那些卡死的请求(它们在 `perf_minute` 里,但 `api_calls` 是采样的)。
诚实结论:缺陷是真的、可复现的(8.8s 冷查询),但**无法逐个点名受害客户**。不需要回访名单。

**今天 08:51 那条 50 秒告警和 09:04 的 8.6s 是我和 agent 自己压测打出来的,不是客户。**
但 07-04 → 07-09 那一串(73s/98s/142s/192s)早于任何测试,是真的。

---

## 7. 还剩什么

1. **冷窗口仍然存在(已大幅收窄)。** 缓存是进程内的,每次部署清空。
   彻底根治:把预热结果落到 `market_cache` 表(该表和 `txPrecomputed()` 已存在),重启后直接从 DB 秒回,冷窗口归零。**建议下一步做这个。**
2. **告警恢复逻辑在骗人。** 判据是全站 p95,没流量必然"恢复"。
   建议改成**接口级、且只在有流量时**评估,否则"报警 → 天亮没人用 → 自动恢复 → 根因永不修"的循环会一直转。
3. `docs/area-insights-preaggregation-spec.md` 里的月度预聚合:本次索引修复后,超大区冷查询已从 8.8s 降到 0.43s,**优先级可以降低**,但 spec 仍有效。

---

## 8. 追加:要不要升级服务器 / scale out?

**不要。一分钱都不用花。**

### 实测:服务器在睡觉

```
API 服务器 (cpx11, 2 vCPU / 3.8GB)
  负载(1/5/15min):  0.00  0.00  0.00
  pinzos-api 容器:   CPU 0.00%,内存 67MB / 1.5GB (4.5%)
  磁盘:              45%
DB:  8 / 200 连接,5.2 GB
```

### 实测:真实流量极小

| 指标 | 实测值 |
|---|---|
| 每日真实访客 | **15-85 人** |
| 每日请求量 | 2000-6000 |
| 平均 RPM | **3.2** |
| p95 / p99 RPM | 12 / 45 |
| 峰值并发 | **13-20** |
| 5xx | 近 10 天共 6 条 |

（`perf_minute` 里那个 1995 RPM / pool 打满 50 的峰值是 2026-06-27 自己压测打的,不是真实流量)

### 结论

**所有延迟问题 100% 是缺索引,不是缺算力。** 一台负载 0.00 的机器返回 8.8 秒的响应 —— 加机器只会让 4 台机器各自跑同一条 8.8 秒的查询,**花钱且什么都修不好**。

真要扩容,顺序也是**先免费的**:
1. **Node 单进程没开 cluster** —— 2 核只用了 1 核。开 cluster 白捡 2 倍,改配置不花钱。
2. **进程内缓存重启即清空** → 冷窗口。落到 `market_cache` 表即可归零。
3. 再往后才轮到加实例 / 升配。

按 2026-06-27 压测,持续并发 ~100-200 才开始劣化;当前峰值并发 20,**还有 5-10 倍余量**,而且本次索引把最重的几条查询打快了 15-20 倍,这个天花板又抬高了一大截。

---

## 9. 追加:同一类 bug 的第二处(已修)

`GET /market/rent/projects?area=...` —— **真实匿名客户几乎每天撞到 3-5 秒**,今天 09:16 还有一条 3424ms。

`loadRentProjects`(`market-rent.ts`)按 `UPPER(project_name)` 聚合 560 万行租约。
只有 `idx_rent_upper_area_name` 能用,其余谓词(`usage_type`/`annual_amount`/`property_area`)只能回表过滤 → bitmap 退化 lossy:

```
Rows Removed by Index Recheck: 2,191,873     ← 回表重查 220 万行
Heap Blocks: exact=29889 lossy=65624
Execution: 5391ms (JABAL ALI FIRST, 14.5 万条)
```

**修复**:`idx_rent_area_projlist` —— 部分索引(谓词写进 WHERE)+ `INCLUDE (project_name)` 供 `mode()` 用。
**5391ms → 362ms;生产端到端 0.2s。** 纯 DB 层,已生效。

---

## 10. 剩下的潜在问题(未修,按优先级)

| 问题 | 证据 | 建议 |
|---|---|---|
| **告警恢复逻辑在骗人** | 判据=全站 p95,没流量必然"恢复" | 改成接口级 + 仅在有流量时评估。**优先做,否则根因永远藏着** |
| **部署后冷窗口** | 进程内缓存重启清空,JLT 仍要 1.8s | 预热结果落 `market_cache`,冷窗口归零 |
| `/api/voice/tools/execute` 最高 9.1s | 7 天 9 次慢,匿名客户;Luna 工具执行 | 大概率是 LLM 调用本身耗时,需确认是否可并行/预取。**Luna 卡 9 秒 = 客户以为它死了** |
| `/api/billing/checkout` 500 × 3 | 07-09,`admin@yesir.ai`(付费意向客户!) | 已有报告 `2026-07-09-billing-checkout-500-stale-stripe-customer.md`;07-09 后未复发,确认已修 |
| DB 对全网开放 + 弱密码 | 见 memory 安全债 | 与本次无关但是真风险 |

---

## 11. 追加:监控系统本身是坏的(已重构)

用户点破:「为什么 tm 5xx 也有恢复机制?所有问题不都得 investigate root cause 避免未来再发生嘛?」

**他是对的。5xx 是事件,不是状态——它不会"恢复"。**

### 旧设计的病

`reconcileAlerts` 把所有规则当状态机,`!breached` 就 `resolved_at = now()`。
对 5xx 而言 `!breached` 的真实含义是「最近 3 分钟错误率掉回 5% 以下」——在 3 请求/分钟的流量下,**只要没人再点那个坏接口,错误率自然归零,bug 一行没改,告警自己关了**。

三个病:

| 病 | 后果 |
|---|---|
| 错误按 `kind` 糊成一条 | billing/checkout 挂了和 voice/token 挂了合并成同一条,看不出哪个接口/哪个客户/什么错 |
| 用错误**率**而非**数** | 2/39 = 5.1% 才勉强报;错得不够密集则**永远不报** |
| 延迟告警的"恢复" | = 没人用了,p95 自然回落 |

**实锤**:`2026-07-09 12:34「5xx 5.1% (2/39)」自动已恢复`。
那 2 条 500 是 **`/api/billing/checkout` 挂了,撞的是 `admin@yesir.ai` —— 一个正在付款的客户**,连试 3 次全失败。系统的反应是标记"已恢复",然后忘掉。

### 新语义(已上线)

- **`API_5XX` 事故**:按 `(接口模板, 状态码)` 立案,存现场(`originalUrl` / 受害客户 / 次数 / 首末次);重复命中折叠计数不刷屏;**永不自动恢复**,只能人工在 dashboard「标记已解决」= 已定位根因并修复。**5xx 全量采集不采样**(采样正是最严重的故障隐身的原因)。
- **状态型告警**(延迟/错误率)自动恢复加 `hasTraffic` 门:窗口内 <5 请求**不允许关闭告警**。「没人用」不再等于「已恢复」。
- `perf_alerts` 加 `signature` / `detail` 列 + 未解决唯一索引。

### 用新系统当场抓到一个真 bug(已修)

`GET /api/residential-projects/not-a-uuid` → **500**。
三个 `/:id` 路由都没有 uuid 校验,非法 id 直接进 `WHERE id = $1` → Postgres 转型报错 → 被 catch 成 500(和 2026-06-28 area-insights 那个坑同一类,当时只修了 area-insights)。

`router.param('id')` 加 UUID 守卫 → 404。**已验证 500 → 404**,事故 #666 按新流程闭环关闭(附 rootCause / fix 落库)。

验证记录:
```
事故 #666  GET /api/residential-projects/:id|500
  4 次命中折叠成 1 条(不刷屏)
  sampleUrl: /api/residential-projects/not-a-uuid
  victims:   4 个访客 id
  状态:     未解决 → 修复后人工关闭,附根因
```

---

## 12. 追加:每个登录请求白付 141-494ms(**待修,需要你提供一个值**)

dashboard 上「各接口速度」里那个 ~200ms 地板不是错觉:

- **1-2ms**:`GET /`、`favicon`、`area-insights`(缓存命中)——**不需要登录的**
- **200-460ms**:`/api/me/profile`、`/api/billing/me`、`/api/admin/*`、`/api/sync`(p95 **1000ms**)——**全是要鉴权的**

### 根因

`middleware/context.ts` 的设计本来是对的:

- 配了 `SUPABASE_JWT_SECRET` → 本地 Node crypto 验签 HS256,**零网络**
- 没配 → token 挂 `_deferredToken` → guards 回退 `supabaseAdmin.auth.getUser(token)` = **每个登录请求远程调一次 Supabase**

**生产容器的环境变量里根本没有 `SUPABASE_JWT_SECRET`** —— 服务器 `/opt/pinzos/docker-compose.yml` 只映射了 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。这个优化**从来没被激活过**。

实测(从 API 服务器上打):
```
DB 往返(同机房):           1 ms      ← 不是 DB 的锅
Supabase auth.getUser 远程:  141-494 ms  ← 就是它
```

这和 memory 里记的 [[agent-approval-and-auth]] 是**同一个坑**:「.env 有值但 compose 没映射」。

### 修法(需要你)

我不能读 `.env`(你自己设的硬规则,已被 deny 拦下,这是对的)。需要:

1. 从 Supabase 后台取 JWT Secret:`Project Settings → API → JWT Settings → JWT Secret`
2. 加进服务器 `/opt/pinzos/docker-compose.yml` 的 environment:`- SUPABASE_JWT_SECRET=...`
3. `docker compose up -d` 重启

**预期收益:所有登录接口砍掉 141-494ms,`/api/sync` 的 p95 从 1000ms → ~200ms。** 代码不用改一行,已经写好了。

---

## 13. 元教训

- 先看 `max_ms` 不要只看 p95 —— p95 会被低流量稀释,`max_ms` 不会
- `req` 少而 `query_count` 多的那一分钟 = 后台任务在饿死前台请求,这是个可复用的诊断指纹
- 采样表(`api_calls`)会漏掉最慢的请求,`perf_minute` 才是全量口径
- **自动 agent 给的根因必须复核**:这次它的 commit message 写了一个编造的因果,代码却"看起来对",差点就这么留在历史里了
