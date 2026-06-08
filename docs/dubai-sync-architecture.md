# Dubai 数据同步系统 —— 架构总览(给人读的)

> 日期:2026-06-08 · 配套:`dubai-data-api-sync-spec.md`(同步设计)、`dubai-analytics-db-spec.md`(分析层)、`reports/2026-06-08-dubai-api-accessible-datasets.md`(可拉清单)

---

## 1. 全景:数据从哪来,到哪去,谁在用

```
   ┌─────────────────────┐      仅 UAE IP 可访问
   │  data.dubai API     │      OAuth2 · 60 req/min · 1000 行/页
   │  (DLD 官方网关)      │      11 个可拉数据集(交易/租约/估价…)
   └──────────▲──────────┘
              │ HTTPS(CONNECT 隧道,端到端加密;代理看不到 secret)
   ┌──────────┴──────────┐
   │  UAE 代理 (LightNode) │  38.54.8.9 · tinyproxy:8888
   │  只转发 *.data.dubai  │  防火墙只放行德国 worker + 你的 IP
   │  ★不存任何密钥        │  (战区盒子 → 零敏感数据)
   └──────────▲──────────┘
              │ 经代理出口
   ┌──────────┴───────────────────────────────────┐
   │  同步 worker (德国 Hetzner,复用现有)            │   每天 1 次 cron
   │  npx ts-node src/sync/dubai/cli.ts sync-all     │   (dubai-daily-sync.sh)
   │  ┌─────────────────────────────────────────┐   │
   │  │ client(auth+http+分页) → core(engine)    │   │
   │  │  → transform(规范化) → sink(幂等 upsert)  │   │
   │  └─────────────────────────────────────────┘   │
   └────────┬───────────────────────────┬───────────┘
            │ ① 原文每页落 R2            │ ② typed 行 upsert(只增不删)
   ┌────────▼─────────┐        ┌─────────▼──────────────────────┐
   │ R2 原始归档       │        │  Postgres (生产库, 德国)         │
   │ dubai-sync/...    │        │  dld_transactions / _rent /     │
   │ 不可变·可重算·便宜 │        │  dld_valuations  (RAW typed)    │
   └──────────────────┘        │        │                        │
   (+ 离库备份 = 灾备,         │   视图 v_sales / v_rent (规范化) │
    与查询库分开)               │        │                        │
                               │   函数 market_stats /            │
                               │   investment_analysis /          │
                               │   block_analysis /               │
                               │   recommend_for_budget           │
                               └─────────▲──────────────────────┘
                                         │ SQL 调函数(成品分析)
                               ┌─────────┴──────────┐
                               │  AI (Gemini/Luna)   │  受控变量分析
                               │  + 前端投资图表      │  ROI/增长/预算/区块
                               └────────────────────┘
```

**三个独立关注点(别混)**
- **查询库**(Postgres,typed,快)— AI 实际查的
- **原始归档**(R2,完整原文)— 以后重算/扩展,不丢
- **备份**(离库快照)— 灾难恢复

---

## 2. 同步引擎内部(`backend/src/sync/dubai/`)

```
cli.ts  ── discover | sync <key> | sync-all  (--full/--incremental/--dry-run/--limit/--dump)
  │
  ▼
core/syncEngine.runSync(datasetConfig, opts)
  │  对每一页:
  ├─ client/dataApi.iteratePages ── client/httpClient(限速/超时/重试/proxy)── client/auth(token 缓存)
  ├─ sinks/r2Archive.archivePage   ← ① 原文落 R2(best-effort,不丢)
  ├─ core/transform.applyFieldMap  ← 按 config/datasets.ts 的 fieldMap 规范化
  ├─ sinks/postgresSink.upsertBatch ← ② ON CONFLICT 幂等写库
  ├─ core/cursor                   ← 记录增量进度(max load_timestamp)
  └─ observability/runLog          ← sync_runs / sync_run_errors 审计

config/datasets.ts  = 声明式注册表(加数据集 = 加一个对象,零新代码)
```

**解耦**:client 只懂 HTTP;config 是纯数据;sink 只懂 DB/R2;engine 通用编排。任一层可单测。

---

## 3. 每日节奏

```
03:30 UTC ── cron 触发 dubai-daily-sync.sh
          ── sync-all --incremental
              · 读 sync_cursors 上次 load_timestamp
              · 只拉 load_timestamp 之后的新增(filter,待 PROD 实测语法)
              · 原文落 R2 + upsert 入库 + 更新 cursor + 写 sync_runs
          ── 视图/函数实时反映(无需刷新 job)→ AI 立即可用新数据
```
> 因为分析层是**视图(实时计算)**,新数据一入库,`market_stats`/`investment_analysis` 自动更新,**没有额外的指标刷新步骤**。

---

## 4. 分析层(AI 怎么用)

```
RAW typed 表 ──(视图内 CASE 规范化:bedrooms/size_band/ptype)──▶ v_sales / v_rent
                                                                      │
   ┌──────────────────────────────────────────────────────────────┘
   ▼
 market_stats(filters, group_by, measures)   ← 万能受控分析(白名单参数化)
   · 固定其余 + group by 一个 = 控制变量(期房溢价、地段效应…)
 block_analysis(dubai_area_id, …)            ← 地图区块点击 → 收益+5年ROI
 investment_analysis(area_text, …)           ← 语音/自由文本区名
 recommend_for_budget(budget, goal, …)       ← 按预算/收入推荐(返回 block_id)
 v_block_coverage                            ← 哪些区块有可靠数据
```
每个结果带 `confidence`(样本量),预测标注 "indicative"。

---

## 5. 当前状态(2026-06-08)

| 部分 | 状态 |
|------|------|
| UAE 代理 + 出口验证 | ✅ 已建,token+health 通 |
| 同步引擎 + 4 数据集 fieldMap + R2 归档 | ✅ 代码完成,dry-run 通过 |
| 分析层(视图+4函数+block 对齐) | ✅ 上生产库,真实数据验证 |
| 审计/游标表 + load_timestamp 列 + 估价表 | ✅ 已建 |
| **真实增量入库** | ⏳ **等 PROD 凭证**(STG 是测试数据,不灌进生产真实表) |
| 每日 cron | ⏳ 脚本就绪;PROD 后装到德国 worker 的 crontab |

**切 PROD 三步**:`.env` 改 `DUBAI_API_BASE_URL=https://apis.data.dubai` + 换 PROD 凭证 → 装 cron → 完。

---

## 6. 关键约束(刻在脑子里)
- API 仅 UAE IP → 必须经代理
- 无目录 API → 数据集靠门户/探测
- STG 假数据 → 真值要 PROD
- DLD 无浴室数/楼龄 → 控制变量用 bed/size/type/offplan/location
- 租约无卧室数 → 收益用 per-sqm 绕开
- 数据不丢 = 只增不删 + R2 原文 + 离库备份
