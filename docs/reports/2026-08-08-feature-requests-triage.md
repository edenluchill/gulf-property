# 功能建议 triage — 2026-08-08

数据来源：生产 API `GET https://api.pinzos.com/api/feature-requests`（本地 DB 直连
ETIMEDOUT 49.13.227.73:5432，未走 db-query.ts）。

## 当前未处理的建议

| id | 日期 | 提议人角色 | audience | 状态 | 票 | 楼 |
|----|------|-----------|----------|------|----|----|
| 9  | 2026-07-29 | agent | all | open | 0 | 1 |
| 10 | 2026-08-01 | agent | agent | open | 0 | 0 |

> ⚠️ #10 的 `audience = 'agent'`，匿名/买家访问公开列表**看不到它**。只有登录的经纪侧
> 账号或直接访问 `/requests/10` 才可见。以后巡检建议列表不能只看匿名返回。

---

## #10 — 出租 tab 的项目搜索（新，无人回复）

> 请优化一下数据部分交易记录--出租-搜索功能部分，想搜索某一个项目的时候，
> 搜索栏显示不全，不容易找到准确的项目名称

**结论：真 bug，不是使用问题。**

根因是出租视图从未跟上 2026-07-21 成交页那次统一搜索改造。
`frontend/src/pages/TransactionsPage.tsx:264` 里 `mode === 'rent' ? <RentView /> : (…)`
——出租走的是 `TransactionsPage/RentView.tsx` 自带的一套旧控件，跟成交页的
`/transactions/suggest` 完全无关。

三条可验证的具体原因：

1. **候选被门槛砍掉** — `backend/src/routes/market-rent.ts:127` 的
   `HAVING COUNT(*) >= 10`：租约不足 10 笔的楼盘根本不进候选集，用户无论怎么打字
   都搜不出来。直接对应他说的"不容易找到准确的项目名称"。

2. **排序 + 截断复现了成交页修过的坑** — `market-rent.ts:128` 按 `count DESC` 排，
   `:141` `slice(0, 50)`。前缀命中的高成交量楼盘占满名额，词首命中的目标挤不进来。
   成交页当初是用**分组配额**（区域3/楼盘5/楼栋4）解决的，出租这边没有同步。
   参见 memory `tx-unified-search-and-place-or`。

3. **视觉上确实"显示不全"** — `RentView.tsx:181` 候选名 `truncate`，输入框
   `md:min-w-[260px]`（`RentView.tsx:162`）。迪拜楼盘名普遍很长，两个不同候选
   截断后看起来一样。

**建议修法**（未实施，待确认）：
- 去掉或大幅下调 `HAVING COUNT(*) >= 10`
- 候选排序改为「词首命中优先」而非纯 count DESC
- 候选名去 truncate（换行或 title 提示），加宽下拉

---

## #9 — 地图区域弹窗内的成交搜索（已有回复）

> 地图区域里面的 transaction 可以加其他搜索功能吗 方便找不同 project 的近期成交

已有一条 2026-08-01 的回复，承诺「增加项目名称搜索 + 成交时间/户型/物业类型/总价/
每平尺价筛选…会加入产品优化计划」。

**🔴 问题：这条回复在库里 `is_staff = false`、`role = 'buyer'`。**

`backend/src/routes/feature-requests.ts:322-328` 的 `POST :id/reply` 按发帖人 email
判定：`isOwnerEmail || isAdminEmail` 才写 `is_staff = true`。所以这条官方口径的路线图
承诺，对所有访客显示成**一个陌生买家在替产品方承诺**，没有 staff 标记。

正确做法是二选一：
- `PATCH /api/feature-requests/:id` 写 `reply` 字段（官方回复位，requireOwner）
- 或用 owner/admin 账号跟帖，才会带 staff 标记

---

## 两条的关系

#9 和 #10 是同一诉求的两半：**「按项目找近期成交」在成交侧 7 月已做，租赁侧漏了**。
修 #10 顺带就把 #9 里"不同 project 的近期成交"补齐了大半。

## 附带发现

本地 `npx ts-node scripts/db-query.ts` 连生产库 ETIMEDOUT（49.13.227.73:5432），
本次全部数据改走生产 HTTP API。本地网络/防火墙或 DB 白名单可能有变化，值得单独查。
