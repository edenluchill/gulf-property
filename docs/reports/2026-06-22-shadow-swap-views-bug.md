# 影子表 swap 遗留 bug:核心视图仍指向旧脏数据（2026-06-22）

## 症状
尝试 `DROP TABLE dld_transactions_old, dld_rent_contracts_old` 失败:
```
view v_sales depends on dld_transactions_old
view v_rent depends on dld_rent_contracts_old
view dubai_area_metrics depends on dld_transactions_old
view v_block_coverage depends on v_sales
```

## 根因
`scripts/swap-shadow-tables.ts` 用 `ALTER TABLE ... RENAME` 做 live↔_old↔_new 原子交换。
但 Postgres 视图按**对象 OID** 绑定,不是按名字 —— rename 后 `v_sales`/`v_rent`/`dubai_area_metrics`
**跟着旧表对象跑到了 `_old`**。新 clean 数据进了 live 表,却没有任何视图在读。
→ swap 的"零前端改动"目标只实现了一半:数据换了,消费数据的视图没切。

## 影响（严重）
前端区域指标(`dubai_area_metrics`)、销售/租金分析视图(`v_sales`/`v_rent`)、
依赖它们的 Luna 分析函数,**全部在用 swap 前的旧脏数据**。

| 维度 | live(clean, 未被读) | _old(在用) |
|---|---|---|
| instance_date 范围 | 2021-01-01 → 今 | 1416-07-02(垃圾)→ 今 |
| 行数 | 962,740 | 1,553,782 |
| **off-plan 标注** | **436,467** | **81,412** |
| rent 最大 start_date | 2026-06-30 | **2205-07-16**(垃圾) |
| 2021–2026 各年 | 比 old 每年都更全 | 较少 |
| 2015–2020 | 无 | 有(~4–5万/年) |

最致命:这是**期房平台**,但在用的 `_old` 表 off-plan 标注基本坏掉(8万 vs 43万)。
期房投资分析/区域指标实质跑在一份几乎无 off-plan 标注的旧数据上。
(这也解释了为何 v_sales/v_rent 早先要加"日期 ∈ [2000, 今天]"防护 —— 就是在挡 _old 的垃圾日期。)

## 修复方案
1. `pg_get_viewdef` 导出 v_sales / v_rent / dubai_area_metrics / v_block_coverage 当前定义。
2. 把定义里的 `_old` 改回 live 表名(dld_transactions / dld_rent_contracts),按依赖顺序 `CREATE OR REPLACE`
   (v_sales 先于 v_block_coverage)。
3. 验证:`dubai_area_metrics` 抽几个区,确认指标随 live(off-plan 占比、最新日期)变化合理。
4. 通过后 `DROP TABLE dld_transactions_old, dld_rent_contracts_old`(省 ~6.3GB)。

### 代价 / 取舍
- 丢 2015–2020 历史(old 独有)。影响小:区域指标用近 24 个月;`capital_growth_pct` 当前为空、
  前端未用长期 CAGR。需要长期趋势时从 data.dubai 回填 live 即可。

### 善后
- 修 `swap-shadow-tables.ts`:swap 后**重建视图指向新 live 表**(否则下次重建又复发)。
- 修每日 sync 审计断层(VPS sync 不写 sync_runs)。
