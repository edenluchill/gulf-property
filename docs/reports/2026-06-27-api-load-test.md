# API 负载压测报告 + 缓存修复（2026-06-27 凌晨）

## 0. 一句话

实测发现地图首屏接口 `GET /api/dubai/areas` **零服务端缓存、实时重聚合**,在 **50 并发就 p50 27 秒、200 并发整站熔断**。当晚加了进程内缓存(TTL+single-flight)并部署,同口径复测验证。**纠正此前"1000 人不卡"的纸面判断——现状下 ~200 个新访客同时涌入即瘫痪。**

## 1. 方法

- 工具:`backend/scripts/load-test.ts`(零依赖,闭环并发模型,模拟真实公开用户流量配比)。
- 自播种真实 areaId(200)/projectId(17),带参接口打真实数据行。
- 阶梯:50 → 100 → 200 → 500 并发,每档 15s,3s warmup,错误率 >40%/3s 自动熔断。
- `--read-only`(不写 events/batch,不污染生产 analytics)。
- 目标:生产 `https://api.pinzos.com`(经 Cloudflare),迪拜凌晨 02:37(全天最空)。
- 单机生成上限 ~1-2k 并发(临时端口/FD/客户端 CPU),>2000 测的是客户端瓶颈;故用"阶梯找崩溃点"而非硬测 1 万。

## 2. 架构现状(压测口径)

- 公开读接口几乎全是重聚合查询,跑在**单 cpx11 单 Node 进程**上,DB `pool.max=50`,无 gzip、无限流。
- 经纪/admin 写接口量小,非并发瓶颈。
- 老访客地图 geojson 走 localStorage 缓存(不打后端);**新访客**每人打一遍首屏接口 → 营销推送式涌入 = 最坏场景。

## 3. BEFORE — 修复前实测(生产,read-only)

| 并发 | 错误率 | p50 | p95 | p99 | 吞吐 | 状态 |
|---|---|---|---|---|---|---|
| 50 | 3.1% | 5.3s | 29s | 32s | 9 req/s | 已很痛 |
| 100 | 8.2% | 4.5s | 50s | 61s | 19 req/s | 排队严重 |
| 200 | 33.6% | 15s | 45s | 56s | — | 🔴 熔断(87×ETIMEDOUT+11×ECONNRESET) |
| 500 | 63–98% | — | — | — | — | 🔴 瞬间瘫痪 |

逐接口(50 并发档)最慢:

| 接口 | p50 | p95 |
|---|---|---|
| **GET /dubai/areas** | **27.7s** | 32.9s |
| GET /dubai/landmarks | 5.0s | 19.4s |
| GET /market/area-insights | 5.7s | 18.7s |
| GET /residential/map-pins | 4.8s | 15.9s |

**根因**:`/dubai/areas` 对 210 个区做 `ST_AsGeoJSON(boundary)` + `LEFT JOIN get_dubai_area_metrics($1)`(实时集合函数,每请求重算),零缓存。并发一上来,每个慢查询占住一个 pool 槽(共 50),迅速把连接池+DB CPU 打满,**拖垮所有接口**(连本来有缓存的成交接口也跟着慢)。压测期间 `/health` 也失败 1/3 → 真实用户会受影响。

## 4. 修复(本轮已上线)

1. **`services/microCache.ts`(新)**:进程内 TTL 缓存 + **single-flight**(N 个并发 miss 只触发 1 次 loader,其余等它 → 1000 个同时涌入的新访客变成 1 次查询)+ stale-on-error(DB 抖动时发旧值不报错)。
2. **`/api/dubai/areas` + `/api/dubai/landmarks` 套缓存**:TTL 默认 5 分钟(`AREAS_CACHE_TTL_MS` 可调)。底层 DLD 指标每天才重算,5 分钟足够新鲜却把 herd 压成 1 次查询。
3. **写操作自动失效**:该路由任何非 GET(编辑器保存/batch-update)在响应 finish 后清缓存,编辑器保存后重新拉取必见新数据(无陈旧 UX bug)。
4. 部署:`quick-deploy.ps1 -SkipWorker`,tag `20260627-155850`,1.2 min,API 健康。

## 5. AFTER — 修复后复测 + 隔离诊断

### 5.1 两轮修复后同口径压测

| 并发 | 修复前 p50 | 仅数据缓存 p50 | 数据缓存+预gzip p50 | 说明 |
|---|---|---|---|---|
| 50 | 5.3s | 5.x s | 7.3s | 混合流量,变化不大 |
| 100 | 4.5s | 8.6s | 9.3s | 仍排队 |
| 200 | 15s(熔断) | 19s(熔断) | 16s(熔断) | 仍熔断 |
| 500 | 瘫痪 | 瘫痪 | 瘫痪 | 仍瘫痪 |

`/dubai/areas` warm 单请求:**2.5s → 0.75s**(预gzip 生效,672KB→~180KB on wire)。但**混合流量并发崩溃点没动**。

### 5.2 隔离诊断(curl，绕过/经过 CF）

| 测试 | 结果 |
|---|---|
| 单请求 经 CF | 0.45–1.1s |
| 单请求 直连 origin(绕 CF) | 1.2–1.7s |
| **30 并发 `/dubai/areas`(已缓存)** | **最慢 1.7–4.2s ✅ 健康** |
| **30 并发 `tx/summary`(已缓存)** | **最慢 0.35s ✅ 健康** |

**决定性结论**:CF 不是瓶颈;origin 服务**缓存接口**的 30 并发 burst 完全健康。崩溃只在**「持续高并发 + 混合了未缓存 DB 重接口」**时出现。

### 5.2b 第三轮:修好 area-insights 预热后(决定性)

发现 `area-insights` 本就有 6h 缓存,但**预热写错了键**(`insights:${id}` vs 请求读的 `insights:${id}:${usage}`)→ 每个区第一次点都冷 miss 打 DB,压测打 200 个不同 areaId 全是冷 miss → 这才是连接池被打满的真凶。修好键后(预热 `insights:${id}:all`):

| 并发 | 修复前 | 双缓存后 | 错误率 |
|---|---|---|---|
| 50 | p50 5.3s / 3.1% | **p50 1.6s** | 1.0% |
| 100 | p50 4.5s / 8.2% | **p50 2.1s** | 0.4% |
| 200 | **熔断** 33.6% | **p50 2.4s** ✅ | 1.1% |
| 500 | **瘫痪** 63–98% | **p50 4.4s / 101 req/s** ✅ 不崩 | 3.8% |

**系统吞吐 ~19 → 101 req/s,崩溃点从 200 推到 >500。零成本(纯进程内缓存)。** 唯一残留笨重接口是 `/dubai/areas`(500 并发 p50 40s,因 672KB payload),但它**不再拖垮其它接口**(area-insights 2.3s / tx 2.6s 健康),且最易甩给 CF 边缘缓存。

### 5.3 修正后的根因(重要)

之前"瓶颈=`/dubai/areas` 序列化"的判断**不完整**。真相分层:
1. `/dubai/areas` 的 2.5s warm 确实是真问题 → 已修(缓存+预gzip,降到 0.75s)。
2. **但并发崩溃的真正主因**是:**单 Node 进程(无 cluster)+ 2 vCPU + 单 PG(pool=50)** 下,**仍未缓存的 DB 重接口**(尤其 `GET /market/area-insights`,每次点区都打)在持续并发时打满连接池 + 阻塞单个事件循环(大结果集 `res.json` 同步序列化),**连带拖垮所有接口**——包括已缓存的。
3. `xargs -P30`(30 个一次性请求)healthy,而压测脚本(50 workers 持续循环 15s)崩溃 → 服务器扛**瞬时 burst**,扛不住**持续高并发**。1000 人同时 = 后者。

### 5.4 测试方法的诚实边界

单台笔记本 → 单个 Cloudflare 边缘,**不是干净的容量测试台**:它混入了单客户端出口 + CF 单边缘效应。这里的数字是**方向性**的(证明"持续高并发会崩、崩在哪层"),不是精确的"恰好 N 并发"。要拿精确的 1000 用户数字,需分布式压测(k6 Cloud)或多机直连 origin。

## 5.5 transaction/rent 搜索性能实测(2026-06-27 追加)

实测(生产,真实区域,冷查询/深翻页/绕缓存):

| 接口 | 延迟 | 评价 |
|---|---|---|
| tx/list 区域 / 深翻页 offset5000 / summary冷 / projects | 356 / 393 / 488 / 437ms | ✅ 健康 |
| rent/list 区域 / 深翻页 | 234 / 275ms | ✅ |
| **rent/summary 冷筛选组合** | **2003ms** | ⚠️ 唯一偏慢(rent 360万行冷聚合;命中后缓存6h) |

之前几轮已建函数索引(`idx_tx_upper_area_name`/`idx_rent_upper_area_name`/`idx_rent_upper_project`/rent价格偏索引)+ `market_cache` 预算默认页(0.2s)。**搜索整体健康**。软肋:`list` 端点未缓存(但 <400ms);rent/summary 非常见筛选组合 ~2s。均不紧急。

## 5.6 防爬/数据保护(回应"能否加密 JSON")

**前端加密无效**:解密密钥+逻辑必在 JS 里,攻击者读 JS/调用解密函数/读渲染后内存即可拿到;devtools 显示解密后响应。= 障眼法+额外 CPU,不建议做。**真正有效(防御纵深)**:① 开限流(现 disabled);② Cloudflare Bot Fight/WAF;③ 地图按视口/矢量瓦片加载(别一次返回全量——`/dubai/areas` 现在一次给 210 区=超好爬,且我们刚把它做成可边缘缓存,防盗与性能有张力);④ 水印/蜜罐;⑤ ToS+DMCA。

## 6. 仍待做(按性价比)

1. **gzip**(`compression`)— geojson 体积砍 70-80%,降带宽+客户端解析。
2. **`get_dubai_area_metrics` 物化**到每日刷新的表(像 `market_cache`),让冷 miss 也快(现在 miss 仍是一次重查询,只是被 single-flight 限到每 5 分钟一次)。
3. **限流**(`express-rate-limit`,env 已在,`index.ts` 当前 disabled)。
4. **Node cluster / 多 API 实例**(LB 已就绪)→ 真正提高并发上限。
5. **DB 读副本 / pgbouncer** → 10 万级才需要。
6. 接口级 dashboard 已接(`/perf` 返回 endpoints,后台「性能」tab 加「各接口用量/速度」表),上线后可持续盯真实 p95/用量。

## 7. 容量结论(三轮压测后 · 最终）

**修复后(零成本进程内缓存):单 cpx11 现在持续扛住 500 并发混合流量,错误率 3.8%,101 req/s。** 崩溃点从修复前的 ~200 推到 >500，系统吞吐提升 ~5x。

- **日常分散流量**:远超 1000 注册用户无压力。
- **1000 人同一分钟涌入 + 持续点区**(营销推送):现在**优雅降级**(p50 上升、`/dubai/areas` 变慢)而非雪崩瘫痪。单机大概率撑得住,极端尖峰下 `/dubai/areas` 是唯一痛点。
- **下一个免费/极便宜的痛点修复**:`/dubai/areas`(672KB)→ ① 加 `Cache-Control` 让 Cloudflare 边缘缓存(每人字节相同,近零 origin 负载;需 CF 端加 cache rule);② `ST_SimplifyPreserveTopology` 简化边界几何(672KB→~150KB,需验证地图视觉)。
- **暂不需要 Redis / cluster / 升级机器**——缓存已买到 ~5x 容量。这些留到用户量真涨上来。
- **已上线修复的价值**:`/dubai/areas`(每个新访客首屏)不再是单点成本(2.5s→0.75s,gzip on);DB 被缓存保护;接口级监控就位。但 `area-insights`(每次点区)等仍未缓存,加上单进程/2核,是当前天花板。
- **要稳过 1000 同时**,按性价比:
  1. **缓存 `area-insights`**(per areaId,同 microCache 模式,小改动)— 干掉"每次点区打 DB"。
  2. **Node cluster**(2 worker 吃满 2 vCPU)— 当前硬件上最大结构杠杆,隔离事件循环阻塞。
  3. **gzip 已对 areas/landmarks 做了**;可选全局 `compression`。
  4. **+1~3 个 API 实例挂 LB**(LB 已就绪)。
  5. DB 读副本 / pgbouncer(10 万级才需要)。
- **精确容量数字**需分布式压测(k6 Cloud)或多机直连 origin —— 单笔记本经 CF 测不准。
