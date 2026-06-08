# Dubai Data API (data.dubai / DDA iPaaS) 同步系统设计

> 状态:**设计稿,未实现**。等 `client_secret` 入 env + 确认 UAE 出口后开始 Phase 0 测试。
> 作者:Claude · 日期:2026-06-07
> 对应凭证:Application Id `PUBLIC-USR-UID-4057946` · Environment `STG`

---

## 0. TL;DR(先看这三件事)

这是迪拜数字政府(DDA)的官方数据网关 `data.dubai`,OAuth2 + REST + JSON,分页拉数据。它**不是**你现在用的 Dubai Pulse(那是 bulk CSV)。它更适合做**增量同步**。

设计目标:`clean + decoupled + easy to debug` —— 加一个新数据集只改一份**声明式配置**,零新代码;每次同步全程可审计、可 dry-run、可抽样。

### ⚠️ 三个文档没明说、但会卡住你的坑

| # | 坑 | 影响 | 对策(已纳入设计) |
|---|----|------|------|
| 1 | **API 只能从 UAE 境内 IP 访问**("inaccessible outside the country") | 你的 Hetzner 在德国,**直接打不通** | 同步 worker 必须从 UAE 出口走(方案见 §6) |
| 2 | **STG 返回的是脱敏/假数据** | 样例响应全是乱码(`OLNHZQPK93419700`、`"1992-13-40"` 这种非法日期) | STG 只用来验证**管道 + 学字段名**;真实数值要 PROD 凭证 |
| 3 | **没有数据集目录** | 文档里查不到有哪些 entity/dataset | 必须去门户逐个 `Request API Access Key`(§5 给了目标清单) |

### 你现在要做的 4 件事
1. 把 `client_secret` 放进 `backend/.env`(变量名见 §7)。
2. 确认从哪台 **UAE 机器/出口** 发起请求(否则连测试都连不上)。
3. 去 data.dubai 门户,按 §5 清单逐个申请 dataset 的 API Access Key。
4. 拿真实数据前,用 contact-us 表单 + Application Id 申请 **PROD 凭证**(测试和生产凭证不同)。

---

## 1. API 事实速查表(从 4 份 ICD 提炼)

### 1.1 认证(OAuth2 client_credentials)
```
POST {BASE_URL}/secure/ssis/dubaiai/gatewaytoken/1.0.0/getAccessToken
Header: x-DDA-SecurityApplicationIdentifier: <App Identifier key>
Header: Content-Type: application/json
Body:   { "grant_type":"client_credentials", "client_id":"...", "client_secret":"..." }

→ { "access_token":"...", "token_type":"Bearer", "expires_in":3600, "scope":"authz" }
```
- Token 有效期 **3600s(1h)**,过期要刷新。
- **凭证本身不过期**,调用次数不限(受 rate limit)。
- Test ≠ Prod 凭证。

### 1.2 健康检查(首次接入跑一次)
```
GET {BASE_URL}/secure/ddads/healthcheck/1.0.0/health
Header: Authorization: Bearer <token>
→ { "status":"success", "statusCode":200, "message":"API is healthy", "applicationName":"PUBLIC-USR-UID-..." }
```

### 1.3 数据接口(核心)
```
GET {BASE_URL}/secure/ddads/openapi/1.0.0/{entity}/{dataset_name}
别名: GET {BASE_URL}/open/{entity}/{dataset_name}
Header: Authorization: Bearer <token>
→ { "results": [ { ...row... }, ... ] }
```
- 数据分三类:**open**(`/open`,公开)、confidential、sensitive(走 `/shared*`)。你是 PUBLIC 用户 → 基本只有 open。
- 每个 dataset 要**单独申请**访问(一次性)。
- 错误体:`{ "status":"error", "status_code":404, "error_type":"NotFound", "message":"Dataset 'xxx' for entity 'yyy' not found." }`

### 1.4 支持的 query 参数
| 参数 | 类型 | 说明 |
|------|------|------|
| `column` | string | 逗号分隔,只取这些列 |
| `filter` | string | `filter=value` 过滤(⚠️ 精确语法文档没写清,**Phase 0 必须实测**) |
| `page` | int | 页码,默认 1 |
| `pageSize` | int | 每页条数 |
| `limit` | int | 最大条数(分页的替代) |
| `order_by` | string | 排序列 |
| `order_dir` | string | `asc` / `desc` |
| `offset` | int | 偏移 |

### 1.5 限制(决定同步策略)
| 项 | 值 | 设计含义 |
|----|----|---------|
| Rate limit | **60 req/min** | 每页 1000 条 → 理论上限 ~**60k 行/分钟 = 3.6M 行/小时**。全量拉巨表很慢 → 优先增量 |
| 每页 | **1000 records/page** | 分页器以此为单位 |
| Timeout | **30s** | httpClient 硬超时 + 重试 |
| Circuit breaker | 后端超时会熔断 5s | 重试要带退避,别打死 |
| 地理 | **仅 UAE 境内可访问** | 见 §6 |

### 1.6 Base URL
| 环境 | URL |
|------|-----|
| STG | `https://stg-apis.data.dubai` |
| PROD | `https://apis.data.dubai` |

> 增量同步的关键字段:几乎每个 dataset 的响应里都有 **`load_timestamp`**(平台入库时间)。这是做增量 cursor 的天然锚点。

---

## 2. 这套数据对房产 AI 有什么用 + 怎么对上你现有的库

你现有的 DLD 数据来自 **Dubai Pulse 的 4.4GB CSV**(`import-dld-rent-contracts.ts` 等),已经有这些表:

- `dld_transactions`(销售/抵押/赠与 —— `actual_worth`、`meter_sale_price`、面积、房型)
- `dld_rent_contracts`(Ejari 租约 —— `annual_amount`、面积)
- `dubai_communities`(人口)、`dld_areas`(区域查找)
- 视图:`v_recent_sales` / `v_price_trends` / `v_rental_yields`;函数:`calculate_area_*_metrics`

**data.dubai API 的定位:这些同源数据的"官方增量管道"** —— 用它每天增量补新数据,Dubai Pulse CSV 留作首次全量回填。两者**字段对得上**(都是 DLD 源),所以新同步系统直接喂现有表 + 现有指标函数,不另起炉灶。

> ⚠️ 现实约束:全量历史(几百万行)走 API 在 60 req/min 下要几小时,不划算。**推荐:首轮全量用 Dubai Pulse CSV(已有脚本),之后日常增量用 data.dubai API。** 本设计两种模式都支持(`--full` / `--incremental`)。

---

## 3. 架构总览(分层 + 解耦)

核心原则:**四层之间只通过窄接口通信,谁也不知道对方的内部**。

```
            ┌─────────────────────────────────────────────────────────┐
   CLI ───▶ │                      core/syncEngine                      │
            │   for each page: fetch ─▶ transform ─▶ sink ─▶ runLog     │
            └───────┬───────────────────┬───────────────────┬──────────┘
                    │ 只懂 HTTP+Auth     │ 纯声明式配置        │ 只懂 DB
            ┌───────▼────────┐   ┌───────▼────────┐   ┌───────▼────────┐
            │  client/*      │   │ config/        │   │  sinks/        │
            │  auth+http+    │   │ datasets.ts    │   │ postgresSink   │
            │  pagination    │   │ (entity/表/映射)│   │ (staging+merge)│
            └───────┬────────┘   └────────────────┘   └───────┬────────┘
                    │ HTTPS(经 UAE 出口)                       │ TLS
            ┌───────▼────────┐                          ┌──────▼─────────┐
            │  data.dubai    │                          │ 远程生产 Postgres│
            │  (UAE only)    │                          │ (已存在)        │
            └────────────────┘                          └────────────────┘
```

### 解耦边界(这就是"clean"的本质)
- **client/** 只知道 HTTP + token。输入 `entity/dataset/params`,输出原始 JSON 行。**不碰 DB,不认识任何具体数据集。**
- **config/datasets.ts** 是**纯数据**(没有逻辑)。一个 dataset = 一个对象。**加新数据集 = 加一个对象,零新代码。**
- **core/syncEngine** 是通用胶水,依赖 client / sink 的**接口**,不依赖具体实现。
- **sinks/** 只知道写 DB。输入"表名 + 映射好的行",**不认识 API。**
- **observability/** 横切,只做 append-only 审计。

→ 任何一层都能单独 mock 测试;换数据库换成 sink 实现;换出口换 client 的 proxy 配置。互不影响。

### 目录结构
```
backend/src/sync/dubai/
├── README.md                  # 快速上手
├── cli.ts                     # 入口:解析参数,分发命令
├── config/
│   ├── env.ts                 # 类型化读 env(base/appId/clientId/secret/proxy)
│   └── datasets.ts            # ★ DATASETS 注册表(声明式)
├── client/
│   ├── auth.ts                # TokenManager:取 token + 内存缓存 + 自动刷新
│   ├── httpClient.ts          # GET:限速(令牌桶)+ 30s 超时 + 退避重试 + 可选 UAE proxy
│   └── dataApi.ts             # fetchPage() + iteratePages()(async generator)
├── core/
│   ├── types.ts               # DatasetConfig / SyncMode / SyncResult / FieldMap
│   ├── transform.ts           # coerceDate/Number/Bool + applyFieldMap
│   ├── cursor.ts              # 读写增量 cursor(每 dataset 的 last load_timestamp)
│   └── syncEngine.ts          # runSync(config, opts) 编排
├── sinks/
│   └── postgresSink.ts        # ensureStaging / copyIntoStaging / mergeUpsert / dryRunPreview
├── observability/
│   ├── runLog.ts              # 写 sync_runs / sync_run_errors
│   └── log.ts                 # 带 runId 前缀的结构化日志
└── probe/
    └── discover.ts            # Phase-0 探测:auth→health→逐 dataset 拉 1 页→打印字段+样例
```

> 复用现有约定:DB 走 `backend/src/db/pool.ts`(已存在);批量写用 `pg-copy-streams`(已在依赖里,`import-dld-rent-contracts.ts` 已用);限流用 `p-limit`(已在依赖);raw dump 目录沿用 `backend/uploads/`(和 langgraph-output 一致)。**不引入新依赖。**

---

## 4. 数据模型(新增表)

### 4.1 同步审计(可调试的核心)
```sql
-- 每次同步一行,全程可查
CREATE TABLE IF NOT EXISTS sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_key   VARCHAR(80) NOT NULL,
  mode          VARCHAR(20) NOT NULL,       -- 'full' | 'incremental' | 'dry-run' | 'probe'
  status        VARCHAR(20) NOT NULL,       -- 'running' | 'success' | 'failed' | 'partial'
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  pages_fetched INTEGER DEFAULT 0,
  rows_read     INTEGER DEFAULT 0,
  rows_upserted INTEGER DEFAULT 0,
  error_count   INTEGER DEFAULT 0,
  cursor_before TEXT,
  cursor_after  TEXT,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS sync_run_errors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID REFERENCES sync_runs(id),
  page         INTEGER,
  http_status  INTEGER,
  message      TEXT,
  payload_sample TEXT,                      -- 出错那页的前 N 字节,便于复盘
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 增量游标:每 dataset 记住"拉到哪了"
CREATE TABLE IF NOT EXISTS sync_cursors (
  dataset_key  VARCHAR(80) PRIMARY KEY,
  last_value   TEXT,                        -- 通常是 max(load_timestamp)
  last_run_id  UUID,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.2 staging schema
每次同步先 `TRUNCATE staging.<table>` → `COPY` 进 staging → 一条 `INSERT ... ON CONFLICT DO UPDATE` 合并进目标表。**幂等**,重跑安全。staging 表结构跟目标表一致(只取映射后的列)。

---

## 5. ★ 要去门户申请的目标数据集(对房产 AI 最有价值)

> 你还没申请任何 dataset。下面按价值分层。**确切的 `entity`/`dataset_name` slug 必须在门户确认**(文档没给目录),Phase 0 的 `discover` 工具会把真实 slug + 字段抓回来。门户路径:`Data and Statistics → Entities → 搜 "Land" / "Real Estate" / "Statistics" → 选 dataset → Additional Information → Request API Access Key`。

### Tier 1 —— 价格 / 租金核心(直接喂现有表)
| 业务数据集 | 喂入 | AI 用途 | 可能 entity |
|-----------|------|--------|------------|
| **DLD 交易(销售/抵押/赠与)** | `dld_transactions` | 房价预测、ROI、5 年回报 | `dld` |
| **DLD 租约 / Ejari** | `dld_rent_contracts` | 租金收益率、租金预测 | `dld` |
| **DLD 估价(Valuation)** | 新表 `dld_valuations` | AVM 估值锚点 | `dld` |
| **Off-plan / OQood 登记** | 新表 `dld_offplan` | ⭐ 正中你 off-plan 主业 | `dld` |

### Tier 2 —— 供给 / 需求上下文
| 数据集 | AI 用途 | 可能 entity |
|--------|--------|------------|
| Projects / Buildings / Units 登记 | 在建供给管线、交付进度 | `dld` |
| **RERA 租金指数 / 租金涨幅计算器数据** | ⭐ 合法涨租上限 → 租客/房东 AI 建议 | `rera`/`dld` |
| 经纪 / 中介行 / 牌照 | 市场活跃度 | `dld`/`rera` |
| 社区 master + 人口(DSC) | 需求驱动 | `dsc` |

### Tier 3 —— 增强特征
| 数据集 | AI 用途 | 可能 entity |
|--------|--------|------------|
| POI / 地铁 / 地标(RTA) | 邻近度特征 | `rta` |
| 服务费 / Mollak(业主协会费) | 净收益率更准 | `dld` |
| 宏观指标(GDP/通胀/人口钟,DSC) | 预测的宏观背景 | `dsc` |

> 建议先只申请 **Tier 1 的前两个(交易 + 租约)**,跑通端到端,再逐步加 —— 加新 dataset 在本设计里只是往 `datasets.ts` 加对象。

---

## 6. UAE 出口方案(你确认了"需要 UAE 出口")

### 方案 A(推荐):UAE 同步 worker,直写远程生产库
- 一台**便宜的 UAE VPS** 上跑同步 CLI(cron 定时)。它从 UAE IP 调 data.dubai ✓,transform 后通过 TLS 写回你**已有的远程生产 Postgres**(库本来就是远程的)。
- worker 无状态,只需 API 凭证 + DB 凭证。数据路径最短:`UAE → 拉数据 → 直写 DB`。
- 取舍:多一台小机器(任意 UAE 区域的 1 vCPU 小实例即可)。

### 方案 B(备选):UAE 正向代理,沿用现有德国 worker
- 现有 `Pinzos-worker`(德国)跑 CLI,但把 **data.dubai 的 HTTP 请求**经一台 UAE 上的 HTTP/SOCKS 代理(squid/tinyproxy)转发;DB 写入仍走原路。
- 取舍:代理是单点 + 要加固;只有 data.dubai 流量走 UAE。

**建议 A**(同步逻辑自包含在"被允许访问 API 的机器"上,最干净)。但 `httpClient` 设计成 **proxy-aware**(读 `DUBAI_API_PROXY_URL`),所以将来切到 B 只是改一个 env,代码不动。

> 注意:目前你人/机器在 UAE 才能先本地把 pipeline 跑通;否则连 Phase 0 的 `curl` 都会失败。

---

## 7. 环境变量(和 client_secret 一起放进 `backend/.env`)

```ini
# Dubai data.dubai API
DUBAI_API_BASE_URL=https://stg-apis.data.dubai          # 测试用 STG,上线换 PROD
DUBAI_API_APP_ID=<x-DDA-SecurityApplicationIdentifier>  # 你已有那串 Q-...(放 env,别进 git)
DUBAI_API_CLIENT_ID=<client_id>                         # 你已有那串 Kv2c...
DUBAI_API_CLIENT_SECRET=<client_secret>                 # ★ 你来填
DUBAI_API_PROXY_URL=                                    # 可选:方案 B 的 UAE 代理,留空=直连
```
> App Id / client_id 也建议只放 env,不写进任何会提交的文件。

---

## 8. 关键类型 & 注册表长什么样(示意,非最终代码)

```ts
// core/types.ts
export type SyncMode = 'full' | 'incremental'

export interface FieldMap {
  [targetColumn: string]: {
    from: string                              // API 响应里的字段名
    coerce?: 'date' | 'number' | 'bool' | 'text'
  }
}

export interface DatasetConfig {
  key: string                                 // 'dld_transactions'(本系统内唯一键)
  entity: string                              // 'dld'
  dataset: string                             // 'dld_transactions-open-api'(门户确认)
  targetTable: string                         // 'dld_transactions'
  primaryKey: string[]                        // ['transaction_id'] → ON CONFLICT 用
  fieldMap: FieldMap
  incremental?: { column: string }            // 'load_timestamp'
}

// config/datasets.ts —— 加新数据集 = 往这里加一个对象
export const DATASETS: DatasetConfig[] = [
  {
    key: 'dld_transactions',
    entity: 'dld',
    dataset: 'TBD-门户确认',
    targetTable: 'dld_transactions',
    primaryKey: ['transaction_id'],
    incremental: { column: 'load_timestamp' },
    fieldMap: {
      transaction_id:  { from: 'transaction_id' },
      instance_date:   { from: 'instance_date', coerce: 'date' },
      actual_worth:    { from: 'actual_worth',  coerce: 'number' },
      meter_sale_price:{ from: 'meter_sale_price', coerce: 'number' },
      // ... Phase 0 discover 抓到真实字段后补全
    },
  },
]
```

```ts
// CLI 用法(示意)
// 探测能拉到什么(Phase 0,不写库)
//   npx ts-node src/sync/dubai/cli.ts discover
// 单数据集增量同步
//   npx ts-node src/sync/dubai/cli.ts sync dld_transactions --incremental
// 全量 + 只看不写
//   npx ts-node src/sync/dubai/cli.ts sync dld_transactions --full --dry-run --limit=50
// 全部数据集
//   npx ts-node src/sync/dubai/cli.ts sync-all --incremental
```

---

## 9. 同步流程(full vs incremental)

**Full**:`page=1..N, pageSize=1000` 顺序拉到空页 → `COPY` 进 staging → merge → `cursor = max(incremental.column)`。

**Incremental**:读 cursor → 优先用服务端 `filter=load_timestamp>{cursor}` + `order_by=load_timestamp&order_dir=asc` 拉新增 → 同样 merge → 更新 cursor。
- ⚠️ **`filter` 语法 Phase 0 必须实测**。若服务端过滤不支持,**降级**:`order_by=load_timestamp&order_dir=desc`,客户端读到 ≤ cursor 就停。

**幂等**:`INSERT ... ON CONFLICT (primaryKey) DO UPDATE`。重跑、补跑都安全。

---

## 10. 可调试性(easy to debug 的具体落点)

| 能力 | 怎么用 |
|------|--------|
| `--dry-run` | 拉 + 转换,打印样例和计数,**不写库** |
| `--limit=N` / `--page` / `--pageSize` | 抽样、定位某页 |
| `--dump` 或出错自动 dump | 原始页 JSON 落 `backend/uploads/dubai-sync/<runId>/page-N.json` |
| `sync_runs` / `sync_run_errors` 表 | `db-query.ts "SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 10"` |
| `discover` 命令 | 打印每个 dataset 的列名 + 1 行样例 → **直接回答"哪些字段对 AI 有用"** |
| 结构化日志 | 每行带 `[runId][dataset]` 前缀 |

---

## 11. 分阶段落地

| 阶段 | 内容 | 前置 | 产出 |
|------|------|------|------|
| **Phase 0** | `discover.ts`:auth → health → 对已申请的 dataset 各拉 1 页,dump 字段 + 样例。**实测 `filter` 语法。** | secret + UAE 出口 + 至少 1 个 dataset 已申请 | 确认哪些能拉通、真实字段清单 |
| **Phase 1** | client + engine + sink + `sync_runs`,打通 **1 个** dataset(DLD 交易)端到端(staging+merge+cursor),验证幂等 + 增量 | Phase 0 | 一条可重复跑的同步链 |
| **Phase 2** | 其余 dataset 进注册表(纯配置),CLI 加 `sync-all` | Phase 1 | 全量数据集覆盖 |
| **Phase 3** | UAE 机器上 cron:每日增量 + 每月全量校对;`sync_runs` 失败告警 | Phase 2 | 无人值守同步 |

---

## 12. 待确认 / 风险

1. **`filter` 精确语法** —— 文档只写 `filter=value`,增量同步强依赖它,Phase 0 第一件事就是实测(`load_timestamp>...`、`instance_date>=...`、操作符是 `>` 还是 `gt:` 等)。
2. **dataset slug 全未知** —— 门户申请后才知道真实 `entity`/`dataset_name`;discover 会抓回来。
3. **STG 假数据** —— 字段名可信,数值不可信;字段映射先用 STG 搭,数值校验等 PROD。
4. **全量历史成本** —— 几百万行 @ 60 req/min 很慢;首轮全量建议仍用 Dubai Pulse CSV,API 专做增量。
5. **PROD 凭证** —— 用 contact-us 表单 + Application Id `PUBLIC-USR-UID-4057946` 申请。
6. **`pageSize` 上限未知** —— 文档说每页 1000;`pageSize` 能否调大需实测。

---

## 13. 加 secret 后的测试清单(Phase 0)

```bash
# 0. 确认从 UAE 出口发起(否则全失败)
# 1. 拿 token
curl --location 'https://stg-apis.data.dubai/secure/ssis/dubaiai/gatewaytoken/1.0.0/getAccessToken' \
  --header 'x-DDA-SecurityApplicationIdentifier: <APP_ID>' \
  --header 'Content-Type: application/json' \
  --data '{"grant_type":"client_credentials","client_id":"<CLIENT_ID>","client_secret":"<SECRET>"}'

# 2. 健康检查(确认 applicationName 是你的)
curl 'https://stg-apis.data.dubai/secure/ddads/healthcheck/1.0.0/health' \
  --header 'Authorization: Bearer <TOKEN>'

# 3. 拉一个已申请的 open dataset 第一页(确认 results 结构 + 字段)
curl 'https://stg-apis.data.dubai/open/<entity>/<dataset>?page=1&pageSize=5' \
  --header 'Authorization: Bearer <TOKEN>'

# 4. 实测 filter 语法(增量同步的命门)
curl 'https://stg-apis.data.dubai/open/<entity>/<dataset>?filter=load_timestamp>2025-01-01&pageSize=5' \
  --header 'Authorization: Bearer <TOKEN>'
```
跑通后,我再开始写 Phase 0 的 `discover.ts`,把它变成可重复的 ts-node 脚本。
