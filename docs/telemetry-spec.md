# 通用遥测系统 spec(2026-07-13)

## 为什么要做

2026-07-13,合伙人报「实时带看有半分钟延迟」。**我们没有任何现成数据可查** ——
只能临时写两个探针脚本去生产实测,才证明 WS 链路是健康的(161ms)、真凶是客户端首屏。
这件事暴露的不是「collab 少了几个日志」,而是**整个可观测性只覆盖 HTTP**:

- `perfMetrics` 是 **Express 中间件** → WebSocket 走 `server.on('upgrade')`,**根本不经过它**
- `collab.ts` 里**零埋点**(只有两条启动 console.log)
- 进程 CPU 没人采 —— 而压测证明 **1000 人同时带看正好打满单核**(后端是单进程单线程),
  却**没有任何东西会在接近时告警**
- Agora(唯一真花钱的东西)用量没有看板

## 设计原则

**不往 perfSink 里塞字段。** `perfSink` 的字段是写死给 HTTP 的(`req/err4/err5/query/slowQuery`),
每加一个功能就多几个字段 → 越堆越脏,而且别的 feature 没法复用。

正确的分层:**通用 telemetry 核心** + 各 feature 只写几行调用。
`perfSink` 保持原样(它是 HTTP 的专用加速器),新系统与它并存、共用告警出口。

```
backend/src/telemetry/
  metrics.ts   Counter / Gauge / Histogram —— 零依赖、内存有界、绝不抛错
  funnel.ts    通用漏斗(任意 feature 的多步转化)
  runtime.ts   进程级:CPU% / RSS / event-loop lag(容量预警的唯一信号)
  flush.ts     60s 落库 → metrics_minute
  alerts.ts    声明式告警规则(写进现有 perf_alerts 表,复用邮件与 Admin UI)
  index.ts     公共 API + 规则注册处
```

### 三条铁律(照抄 perfSink 的血泪教训)

1. **零依赖**:`metrics.ts` 不 import `pool`,也不 import 任何业务模块 —— 否则
   pool ↔ monitor 循环依赖,且遥测一崩就把请求路径带崩。
2. **内存有界**:所有结构带 cardinality guard(指标名上限、label 组合上限、直方图样本上限)。
   一个写错的 label(比如把 userId 当 label)不能把进程撑爆。
3. **绝不抛错**:每个公开函数内部 try/catch 吞掉。**遥测挂了业务必须照跑**。

## 公共 API(别的 feature 只需要这些)

```ts
import { counter, gauge, histogram, funnel } from '../telemetry'

// 计数:发生了多少次
counter('collab.ws.connect').inc()
counter('collab.ws.error', { reason: 'room_not_found' }).inc()

// 瞬时值:此刻是多少(pull 式,flush 时才求值 —— 不用自己维护定时器)
gauge('collab.rooms.active', () => roomCount())

// 分布:耗时/大小
histogram('collab.fanout.ms').observe(ms)

// 漏斗:客户到底卡在哪一步
funnel('collab.join').step('ws_connect')
```

**加一个新 feature 的埋点 = 上面这几行,不需要建表、不需要改 flush、不需要写 SQL。**
名字用 `feature.thing.unit` 的点分层级(`collab.ws.connect`),label 只放**低基数**的枚举
(reason / role / plan),**绝不放 userId / roomId / email**(会炸基数)。

## 数据模型

一张通用表,所有 feature 共用:

```sql
CREATE TABLE metrics_minute (
  minute   timestamptz NOT NULL,      -- 分钟对齐
  name     text        NOT NULL,      -- 'collab.ws.connect'
  labels   jsonb       NOT NULL DEFAULT '{}',
  kind     text        NOT NULL,      -- counter | gauge | histogram
  count    bigint,                    -- counter: 增量;histogram: 样本数
  value    double precision,          -- gauge: 瞬时值
  sum      double precision,          -- histogram
  min      double precision,
  max      double precision,
  p50      double precision,
  p95      double precision,
  PRIMARY KEY (minute, name, labels)
);
```

漏斗**不另建表** —— 一步一个 counter(`funnel.<name>` + label `step`),
转化率 = 相邻两步的比值。少一张表、少一套查询。

保留期:90 天(比 perf_minute 长,容量趋势要看长周期)。

## 告警(声明式)

现有 `perfMonitor.evaluateRules` 是**硬编码 if-else**,加一条规则要改函数。新系统:

```ts
defineAlert({
  kind: 'CAPACITY_CPU',
  metric: 'runtime.cpu.pct',
  agg: 'avg', windowS: 180,
  breach: (v) => v > 75,
  severity: 'warn',
  message: (v) => `单核 CPU ${v}% —— 后端是单进程单线程,100% 就开始积压(压测:1000 人同时带看≈105%)`,
})
```

规则写进现有 `perf_alerts` 表 → **邮件通知和 Admin「错误监控」tab 全部白嫖现成的**。
状态机沿用:突破开事故 / 恢复关闭;**5xx 类事故仍然只能人工关**
(见 [[alerts-are-incidents-not-state]])。

## 首批接入(本次范围)

### 1. 实时带看(WS —— 之前 100% 全盲)

| 指标 | 类型 | 意义 |
|---|---|---|
| `collab.ws.connections` | gauge | 当前 WS 连接数 |
| `collab.rooms.active` | gauge | 活跃房间数 |
| `collab.ws.connect` / `.disconnect` | counter | 进出场 |
| `collab.ws.error{reason}` | counter | `room_not_found` / 异常断开 |
| `collab.fanout.msgs` / `.bytes` | counter | 扇出速率(容量的直接前兆) |
| `collab.fanout.ms` | histogram | 单帧扇出耗时(积压时会飙) |

### 2. 容量预警(压测得出的硬数字)

| 指标 | 类型 | 告警 |
|---|---|---|
| `runtime.cpu.pct` | gauge | >75% 单核 → warn(离积压只剩一步) |
| `runtime.rss.mb` | gauge | >1500MB → warn(共 2GB) |
| `runtime.loop_lag.ms` | gauge | >100ms → warn(事件循环被堵 = 已经在积压) |

**event-loop lag 是单线程架构最诚实的健康指标** —— 它一涨,所有请求(不只是带看)都在排队。

### 3. 进房漏斗(今天缺的就是这个)

`funnel('collab.join')`:`link_open` → `identity_submit` → `ws_connect` → `sync` → `first_cam`

今天那批 `peak_participants=1` 的房间(客户压根没进来),是**手查数据库**才发现的。
有了这个漏斗,「客户卡在身份门」会直接显示成一个断崖。
前两步在前端上报(见下),后三步服务端直接记。

### 4. 客户端 RUM(真凶所在)

新端点 `POST /api/telemetry/rum`(匿名可用、限流、白名单指标名),前端上报:

| 指标 | 意义 |
|---|---|
| `rum.collab.ttfc.ms` | 点「进入带看」→ 收到第一帧相机(实测 4G 1.2s) |
| `rum.collab.tiles.ms` | → 瓦片追完、画面可看(实测 4G 2.5s / 弱网 8.6s) |
| `rum.collab.tiles.bytes` | 首屏瓦片字节(实测 **4.8MB** —— 半分钟延迟的真凶) |
| `rum.page.dcl.ms` | DOMContentLoaded(弱网实测 7.8s) |

**白名单**:只接受已注册的指标名,否则任何人都能往我们的库里灌垃圾。

### 5. Agora 成本(唯一真花钱的东西)

**不需要新采集** —— 数据已经在 `lt_credit_ledger`(`feature='live_call'` 的 `units`)。
Admin 直接查:日/月 units → 折算 $(1 unit = 1 Agora Standard 分钟 = $0.00099)。
顺带盯住免绑卡试用的出血口(一个邮箱 120 units ≈ $0.12,批量注册会被刷)。

## Admin 展示

「性能负载」tab 加一个**实时带看**区块:
- 当前:WS 连接数 / 活跃房间 / 扇出 msg/s / 单核 CPU(带 100% 刻度线)
- 进房漏斗:五步转化,断崖处标红
- 客户端 RUM:首屏 / 瓦片耗时 / 字节的 p50·p95
- Agora 成本:本月 units + 折算美元 + Top 消耗账号

## 不做什么(刻意)

- **不引 Prometheus / OpenTelemetry**:一台服务器、单进程,拉一套 exporter + 时序库的
  运维成本远大于收益。这套内存 + 一张表的方案,查询直接走现成的 Admin。
- **不改 perfSink**:它是 HTTP 的专用加速器,工作得很好,动它只会引入回归。
- **不采样**:量级太小(峰值并发 20)。**采样正是最严重的故障隐形的原因**
  (见 perfSink 里 5xx / 慢请求那两段注释)。

## 回归测试

`backend/scripts/verify-telemetry.ts`:内存有界性(灌 10 万个不同 label 不炸)、
counter/gauge/histogram 数学正确、flush 幂等、告警状态机(突破→开事故→恢复→关闭)、
**遥测抛错不影响业务路径**。
