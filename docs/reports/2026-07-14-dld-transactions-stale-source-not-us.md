# 成交记录 7 天没新数据 —— 是 DLD 源头停更，不是我们的问题

**日期**: 2026-07-14
**触发**: 用户发现前端「成交记录」页最新成交停在 2026-07-07，而「租金」页看起来有新数据
**结论**: **源头问题**。data.dubai 官方 API 自 2026-07-08 18:22 起未再发布新数据。我们的同步链路完全正常。

---

## 1. 结论速览

| 问题 | 答案 |
|---|---|
| 是我们的同步坏了吗？ | ❌ 不是。daily timer 每天照跑、exit 0、每天拉回 2 万+ 行 |
| 是 API 没新数据吗？ | ✅ 是。源 API 最新成交日 = 2026-07-07，最后发布 = 07-08 18:22 |
| rent 真的有新数据吗？ | ❌ 没有。rent 和 tx **在同一时刻一起断的**，「有」是列语义造成的错觉 |

---

## 2. 证据链

### 2.1 直接问源 API（决定性证据）

在迪拜盒子（38.54.8.9，UAE IP 直连）上跑 `backend/src/sync/dubai/probe/probe-freshness.ts`：

```
[freshness] === 最新 5 笔(desc) ===
2026-07-07 | Jabal Ali First    | Unit 2 B/R  |   876,750 AED | load=2026-07-08 18:22:29
2026-07-07 | Nadd Hessa         | Unit Studio |   643,266 AED | load=2026-07-08 18:22:29
2026-07-07 | Madinat Al Mataar  | Unit Studio |   641,900 AED | load=2026-07-08 18:22:29
2026-07-07 | Madinat Al Mataar  | Unit 3 B/R  | 2,557,002 AED | load=2026-07-08 18:22:29
2026-07-07 | Al Yelayiss 1      | Villa 5 B/R | 5,359,620 AED | load=2026-07-08 18:22:29
```

源头自己最新的成交就是 07-07。我们库里有的，就是它给的全部。

### 2.2 我们的库和源头完全一致

```sql
SELECT 'txn', MAX(instance_date), ... FROM dld_transactions
UNION ALL
SELECT 'rent', MAX(start_date), ... FROM dld_rent_contracts
```

| 表 | 最新日期 | 最后一次源头发布 (max load_timestamp) |
|---|---|---|
| dld_transactions | 2026-07-07（成交日） | **2026-07-08 18:22:29** |
| dld_rent_contracts | 2026-07-13（起租日） | **2026-07-08 18:25:35** |

零差异 —— 同步没丢任何东西。

### 2.3 同步链路健康

盒子上 `systemctl list-timers`：

```
NEXT                        LAST                        UNIT
Wed 2026-07-15 02:00:00 CST Tue 2026-07-14 02:00:15 CST dubai-daily.timer
Sun 2026-07-19 03:00:00 CST Sun 2026-07-12 03:00:29 CST dubai-weekly.timer
```

`daily.log` 最近一次（07-13）：

```
[daily] window 2026-06-01..2026-07-14
[daily] dld_transactions 2026-06-01..2026-07-14: 21693 rows
[daily] dld_rent_contracts 2026-06-01..2026-07-14: 98577 rows
[daily] rent re-bridged: 95707
===== daily exit ok=1 =====
```

**滚动窗口一直开到 07-14** —— 它每天都在向源头要 07-08 之后的数据，只是源头没有。（日志里有个 `geocode-dld-projects.ts` MODULE_NOT_FOUND 的报错，但那是被 catch 住的增量地理编码步骤，**与成交/租约数据无关**，不影响本问题；可另行清理。）

---

## 3. ⚠️ 关键陷阱：rent 的「有新数据」是错觉

用户之所以觉得「rent 都有」，是因为两张表的日期列**语义不同**：

- `dld_transactions.instance_date` = **成交日**，必然是过去。
- `dld_rent_contracts.start_date` = **起租日**，**可以是未来** —— 合同提前签、下个月起租。

所以 07-08 那一批发布里，就已经包含了起租日到 07-13 的合同。按 `load_timestamp` 分组看得很清楚：

| load_timestamp（源头发布批次） | 行数 | start_date 范围 |
|---|---|---|
| 2026-07-08 18:25 | 98,577 | 2026-06-01 → **2026-07-13** |
| 2026-06-29 18:25 | 72,387 | 2026-05-01 → 2026-05-31 |
| 2026-06-18 16:24 | 5,426,818 | 2021-01-01 → 2026-04-30 |

**判断数据新鲜度必须看 `load_timestamp`（源头发布时间），不能看 `start_date`。** 两张表实际上是在同一时刻（07-08 18:22–18:25）一起断的。

顺带：Ejari 租约本来就是**批次发布**（07-08、06-29、06-18…每隔几天一批），不是日更 —— 这也是 `check-dubai-freshness.ts` 给 rent 设 120h 阈值、给 tx 设 36h 阈值的原因。

---

## 4. 真正暴露出来的问题：watchdog 没人看

`backend/scripts/check-dubai-freshness.ts` **此刻正在报警**：

```
STALE: dld_transactions latest=2026-07-08T18:22:29.000Z age=143.2h (limit 36h)
STALE: dld_rent_contracts latest=2026-07-08T18:25:35.000Z age=143.2h (limit 120h)
❌ Dubai data is stale — the daily rebuild/sync likely did not run.
```

它工作得很好 —— 但**只 exit 1，没接任何告警通道，没人在跑它**。结果是：数据断了 6 天，我们是靠 owner 肉眼看前端截图发现的。

（另注：它的失败文案 "the daily rebuild/sync likely did not run" 在本次是**误导**的 —— sync 跑了，是源头没发。文案应区分「我们没跑」和「源头没发」。）

---

## 5. 建议（待 owner 决定）

1. **把 watchdog 接上告警** —— 写进 `app_events` → Admin「错误监控」tab，或直接推邮件。断更 > 36h 应主动告诉我们，而不是等 owner 发现。
2. **前端标注数据截止日** —— 成交页显示「数据截至 2026-07-07（DLD 官方最新发布）」。否则 owner 和经纪都会以为是我们坏了，这次就是。
3. **修 watchdog 文案** —— 区分两种 STALE：`load_timestamp` 老但 daily 跑成功 = 源头停更；daily 没跑 = 我们的锅。
4. （低优先）清理 daily.log 里 `geocode-dld-projects.ts` 的 MODULE_NOT_FOUND —— 盒子上 `/opt/dubai-sync/scripts/` 缺这个文件，是源码拷贝不全（盒子源码是 scp 拷贝的，不是 git）。

---

## 相关

- 同步架构 / 迪拜盒子：memory `dubai-data-rebuild-box-sync`
- API 三坑（仅 UAE IP 可访问等）：memory `dubai-data-api`
- 盒子源码是拷贝不是 git，改了必须 scp 同步
