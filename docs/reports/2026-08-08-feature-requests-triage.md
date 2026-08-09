# 功能建议 triage + 修复 — 2026-08-08

数据来源：生产库（本地到 5432 是 ETIMEDOUT，全程走
`ssh root@46.224.149.244 'docker exec -i pinzos-api node' < script.js`）。

## 谁提的

| id | 日期 | 提交人 | 角色 | audience | 状态 |
|----|------|--------|------|----------|------|
| 9  | 2026-07-29 | `lzp6529@gmail.com`（Eden Lu，**owner 本人**） | agent | all | open |
| 10 | 2026-08-01 | `tczhulei2001@msn.com`（真实外部经纪） | agent | agent | open |

`#9` 的那条「我们计划增加…」的评论也是 `tczhulei2001@msn.com` 写的，
`is_staff=false`、`role='buyer'`（他 8/2 才把角色改成 agent）。
即：一个刚开试用的客户，用「我们」的口吻回复了 owner 自己提的建议，
页面上显示成「匿名 · 买家」。**原因未明，值得问一句。**

`tczhulei2001` 时间线：2026-07-06 注册 → **2026-08-01 14:56 开免费试用 →
15:02 提了 #10**。开试用 6 分钟后提的第一条建议。

> ⚠️ #10 的 `audience='agent'`，匿名访问公开列表看不到它。
> 以后巡检不能只看匿名返回。

---

## #10 的根因（我的第一版诊断有一条是错的）

> 请优化一下数据部分交易记录--出租-搜索功能部分，想搜索某一个项目的时候，
> 搜索栏显示不全，不容易找到准确的项目名称

**结论：真 bug，客户描述精确。**

出租视图从未跟上 2026-07-21 成交页那次统一搜索改造
（`TransactionsPage.tsx:264` → `RentView`，与 `/transactions/suggest` 无关）。

### ✅ 真根因：截断砍掉了唯一能区分楼盘的那几个字符

`RentView.tsx` 候选名 `truncate`，输入框 `md:min-w-[260px]` ≈ 27 字符可见。
而**迪拜楼盘名的区分符全长在末尾**。实测 1501 个楼盘：

- 176 个（11.7%）名字超过 27 字符会被截断
- **15 组、共 69 个楼盘截断后显示得一模一样**
  - 最狠：34 个 MBR City District One 的盘全部显示成 `Mohammed Bin Rashid Al Makt…`
  - `Emirates Living - Springs 1 / 10 / 11 / 12`（6 个）
  - `DAMAC HILLS - SILVER SPRINGS / 2 / 3`
  - `DAMAC LAGOONS - SANTORINI (1) / (2)`
  - `Jebel Ali Village Townhouses- Phase 1 / - Phase 3`

### ✅ 次要：`HAVING COUNT(*) >= 10` 门槛

挡掉 68/1501 个楼盘（47 个是 3–9 笔，21 个 <3 笔），它们**怎么打字都搜不出来**。
典型受害者：`DAMAC HILLS - SILVER SPRINGS 2` 只有 4 笔 → 完全不可见。

### ❌ 我第一版报告里写错的一条：排序 + slice(50) 截断

我把成交页的「分组配额」坑直接搬了过来，**对出租不成立**。
租约口径没有楼栋维度，全库只有 1501 个楼盘，最热的关键词 `creek` 也只命中 26 个、
`marina` 21 个 —— 全部进得了前 50，词首命中被挤掉的情况一次都不会发生。

（仍然加了「词首命中优先」排序，但那是体验优化，不是这个 bug 的成因。）

---

## 已做的改动（已部署 + 已验证）

### 出租项目搜索
- `RentView.tsx`：候选名**不再 truncate**（换行显示）、下拉加宽到 `md:w-[28rem]`、
  命中片段 `<mark>` 高亮、已选 chip 也不截断
- `market-rent.ts`：`HAVING >= 10` → `>= 3`；新增 `rankRentProjects()` 词首命中优先
- ⚠️ 核对过 `market_cache` 里**没有** `rent/projects:ALL` 行，所以不涉及
  「迪拜盒子旧副本覆盖」的问题（那条规矩只对 tx 侧生效）

### 建议板公开署名（owner 2026-08-08 决定）
- `db/feature-requests-author.sql`：加 `author_name` + `is_anonymous`，
  **存量 3 行全部标为匿名**（它们是在页面明写「匿名」时提交的）
- `feature-requests.ts`：署名只走 `display_name` 快照，**绝不用 email 前缀兜底**；
  `author_email` 只发给 owner/admin；新增 `GET /whoami` 让发帖弹窗如实告知署名
- `shared.tsx`：`Byline` / `PinzosMark`（`<img src="/logo.svg">`，避开 Header 里
  写死的 `id="pinzosPin"` 冲突）；发帖弹窗加署名告知
- **三处过时文案**（改成署名后它们都变成了假话）：
  1. `changelog.needLogin`（"你的名字和邮箱永不出现在此页"）
  2. 后端/前端文件头注释
  3. `changelog.requestsIntro`（"但永远不显示是谁"）—— **它同时是 /requests 的
     meta description**，会被搜索引擎抓走，是截图才发现的

### 验证
- 后端 `quick-deploy.ps1`、前端 push 触发 CF Pages，均已上线
- `tsc --noEmit` 前后端全过；`i18n-key-check.mjs` 2176 键 × 5 语言全绿
  （并用故意写错的 probe 键确认这几个新键**真的在扫描范围内**）
- `seo-check.mjs` 9 页全过，/requests 的 desc 已是新文案
- `_shot-rent-project-search.mjs`（桌面 + 手机各 5 项断言全绿）——
  断言用 `scrollWidth > clientWidth`，**光截图看不出截断**（truncate 的元素
  `textContent` 依然是全名）
- `_shot-requests-byline.mjs`：存量帖仍显示「匿名」、公开页面零邮箱
- ⚠️ 这三个 `scripts/_*` 脚本被 `.gitignore` 挡下（仓库约定），未入库

### 尚未验证的一处
`PinzosMark`（logo 官方标记）在生产上**还没有真实数据能触发** ——
现有唯一那条评论是 `is_staff=false`。owner 用 `lzp6529@gmail.com` 回一条就会出现。

---

## 待办 / 需要 owner 决定

1. **回复 #10**（文案见下），并把状态点成「已上线」
2. `#9` 那条客户冒充「我们」的评论要不要处理
3. 想给存量 2 条补署名的话：
   ```sql
   UPDATE feature_requests SET is_anonymous = false,
     author_name = (SELECT display_name FROM lt_agents a
                     WHERE lower(a.email) = lower(feature_requests.user_email) LIMIT 1)
    WHERE id IN (9, 10);
   ```
   ⚠️ `tczhulei2001` 的 `display_name` 就是 `"tczhulei2001"`（邮箱前缀），
   公开它约等于公开他邮箱。
4. **本机连不上生产库**（TCP 到 49.13.227.73:5432 超时，服务器那边正常）——
   可能是 Hetzner 防火墙白名单或你的出口 IP 变了。值得单独查，
   不然 `db-query.ts` / `db-runner.ts` 这两个日常工具一直是废的。

## 给客户的回复（一句话）

> 谢谢您的建议！出租的楼盘搜索已经改好了 —— 名字不再显示不全，输入的字也会高亮。

配图：`frontend/shots-customer/rent-search-fixed-desktop.png`（或 `-phone.png`）
