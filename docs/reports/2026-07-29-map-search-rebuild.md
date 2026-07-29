# 地图搜索框重做 —— 回应付费经纪 slavynchuk94@ 的反馈

**日期**:2026-07-29
**触发**:Yaroslava Bursak(slavynchuk94@gmail.com,付费经纪,最早一批订阅者)回信

> Your program is very good!
> Just update it more as not everything is there unfortunately. Can't find many off plan projects or area.
> **Would be great if we can type an area and it straight away brings you there.**

---

## 一、她说的两件事,分开看

| 她的话 | 是什么问题 | 谁来解决 |
|---|---|---|
| "Can't find many off plan projects" | 库存只有 **53 个楼盘** | 内容问题 —— 本周补到 100 个(owner 在做) |
| "or area" / "type an area and it brings you there" | **搜索功能问题**,不是数据问题 | 本次已修 |

第二条才是真问题,而且比看起来严重:**库里有 232 个区,全部带边界,一个不缺**。
她搜不到,是搜索框搜不出来,不是我们没有这个区。

---

## 二、查出来的三个根因

### 1. 她从来没用过那个搜索框(因为看不见)

拉了她的行为数据:

```
page_view    44 次   其中 / 首页 22 次、/map 1 次
area_detail  36 次   ← 她高度依赖区域功能
search        0 次   ← 文字搜索一次都没有
```

对比全站:近 60 天有 51 个人开过区域详情,只有 24 个人产生过 `search` 事件 ——
而且这 367 条 `search` 事件**全部是筛选器 chip**(kind = developer / price / beds /
handover / status / payment),**没有一条是文字搜索**。

也就是说:这个搜索框上线以来,可能没有一个真实用户在里面打过字。

原因看代码就明白了。桌面版是一个 `w-44`(176px)、`text-xs`、灰色 placeholder
写着 "Search area…" 的小框,挤在左上角筛选 chips 的上面一行,视觉重量比旁边的
Price / Bedrooms 按钮还轻。手机版更甚:默认收成底部一颗 40px 的圆钮。

### 2. 就算她打了字,也大概率搜不到

后端是一条 `LOWER(name) LIKE '%q%'`。而 `dubai_areas` 的区名是人工录入的,
拼写、词序、单复数都不规范。实测一批经纪真会打的词:

| 打的词 | 库里实际叫 | 旧版结果 |
|---|---|---|
| `Jumeirah Lake Towers` | `JLT Jumeirah Lake tower` | ❌ 0 条(单数 + 前缀词序) |
| `sports city` | `Sport city` | ❌ 0 条(单复数) |
| `emaar beachfront` | `Beach front by Emaar` | ❌ 0 条(词序 + 连写) |
| `meydan` | `MBR District11 (Medan South)` | ❌ 0 条(库里拼作 Medan) |
| `downtown` | `Downtown Dubai` | ⚠️ 同时命中垃圾行「downtown&local area 外国人无法买卖」 |

讽刺的是,仓库里**早就有**一套成熟的别名 + 模糊匹配器
(`backend/src/services/area-matcher.ts`,带 IDF 加权 + Levenshtein + 别名表 +
垃圾行降权),服务于 Luna 语音和 DLD 数据导入 —— 唯独地图搜索框这条路没接上。

### 3. 一个静默失败:打字会烧地图额度,烧完搜索框静默失效

`/api/dubai/areas/search` 挂在 `/api/dubai` 前缀下,被 `mapMeter` 中间件**逐字计量**,
而它**不在** `UNMETERED` 白名单里。额度用尽 → 429 → 前端 `api.ts` 直接
`if (!response.ok) return []` 吞成空数组 → 用户看到的是「搜索框什么都搜不到」,
没有任何提示。

mapMeter 自己的注释里写得很清楚「输入辅助不是数据消费,不该计费」——
`/transactions/suggest`、`/area-places` 都豁免了,这条是**漏加**。

而她 2026-07-27 有 2 次 `map_gate_hit`(撞到地图额度门),所以她很可能真的踩到过。

---

## 三、改了什么

### 后端

**新增 `backend/src/services/map-search.ts`** —— 搜索框专属的候选排序。

为什么不直接复用 `area-matcher.resolveArea`:那个解决的是**反向**问题 ——
整句解析(Luna 听到「带我去朱美拉海滩」必须收敛成唯一一个区,拿不准就回头问客户)。
搜索框要的恰恰相反:**半个词就得给一串候选**,宁可多给也不能不给,更不能因为
「歧义」返回空。两边共用归一化 + 别名表 + 词级模糊,排序各写各的。

打分分档(0..1),同档内按热度 tie-break:

| 档 | 条件 | 例 |
|---|---|---|
| 1.00 | 归一化后完全相等 | `business bay` → Business Bay |
| 0.90 | 整名前缀 | `mar` → Maritime City |
| 0.80 | 词首前缀 | `marina` → Dubai Marina |
| 0.70 | 整名子串 | |
| 0.60 | 查询词**全部**逐词命中(词序无关) | `emaar beachfront` → Beach front by Emaar |
| 0.25× | 多词查询的部分命中 | |

逐词命中三档,从严到松:完全相同 → 谁是谁的前缀都行(≥3 字符:单复数
`sport`↔`sports`、连写 `beach`↔`beachfront`、打了一半 `mar`↔`marina`)→
编辑距离(≥5 字符:`medan`↔`meydan`、`harbor`↔`harbour`)。

同时:
- **一起搜在售楼盘和开发商**,每条带 `kind`,区在前楼盘在后(和成交页统一搜索
  同一套顺序:买家的思考顺序是从大到小)
- 区域译名(`translations` jsonb 里的多语名)也参与匹配 —— 俄语/中文用户按母语
  记住的名字打字很正常
- 垃圾行(`vacant` / `labor camp` / `外国人无法买卖` …)得分 ×0.4
- 有在售楼盘的区微微加权(搜到就能看到房,比空区有用)

**接口**:新增 `GET /api/dubai/search?q=`,旧路径 `/areas/search` 保留为同一 handler
(用户浏览器里可能缓存着旧 bundle)。语料(232 区 + 全部楼盘)在进程内缓存 5 分钟,
带 single-flight,不再每敲一个字打一次 DB —— 旧版每次按键都要 JOIN 一次
`get_dubai_area_metrics()`。

**mapMeter**:`/dubai/search` + `/areas/search` 加进 `UNMETERED`。

### 前端

`AreaSearch.tsx` → **`MapSearch.tsx`**,三件事:

1. **看得出能搜什么**
   - placeholder:"Search area…" → **"Search an area or project"**
   - 桌面宽度 176px → 240px,字号 xs → sm,聚焦有蓝色焦点环
   - **空态直接列出示例**:`Dubai Marina` / `JVC` / `Business Bay`(可点即填)——
     这是「一眼看出是搜什么的」最直接的一招
   - 结果行带 **AREA(绿)/ PROJECT(蓝)** 徽标,配色沿用成交页统一搜索
   - 副标题:区 = 「N projects on Pinzos」,楼盘 = 「开发商 · 区域」
   - 搜不到时**明说搜不到**,不再静默空白

2. **↑↓ / Enter / Esc 键盘操作** —— 以前完全没有,搜索框缺这个就是半成品

3. **选中真的落地** —— 以前只 `setFlyToLocation`,地图静静飞过去,没有任何「到了」
   的反馈。现在选中 = 在地图上点了那个区 / 那个楼盘:飞过去 **+ 打开详情弹窗**
   (手机是底部 sheet)。这正是她要的 "straight away brings you there"。

4. **补上文字搜索的埋点**(`trackEvent('search', { kind: 'map_area' | 'map_project' })`)
   —— 之前正是因为没有埋点,才无法从数据看出「没人用这个框」。

手机端的落位(收起 = 底部一颗圆钮、展开 = 独占一行)**没有动** —— 那是 owner
2026-07-11 / 07-27 亲自定的。

---

## 四、验证

**新增跑分**:`backend/scripts/map-search-check.ts` —— 拿**生产库真实区名**跑
32 个经纪会打的查询词 + 楼盘自搜 + 开发商 + 混排顺序,共 **43 条,全过**。
改 `map-search.ts` 或搜索接口必跑。

```
cd backend && npx ts-node -T scripts/map-search-check.ts
```

**生产接口实测**(部署后):

| 查询 | 结果 |
|---|---|
| `jumeirah lake towers` | JLT Jumeirah Lake tower ✅ |
| `sports city` | Sport city ✅ |
| `emaar beachfront` | Beach front by Emaar ✅ |
| `meydan` | MBR District11 (Medan South) ✅ |
| `sobha` | 3 个区 + Sobha Hartland II / Sobha Sanctuary / The Eden at Sobha Central ✅ |

**视觉**:414 / 1180 / 1440 三档 × 5 个状态截图核对
(`frontend/scripts/_shot-map-search.mjs`)。搜索框字号 xs→sm 让左上整摞高了 4px,
指北针 `top-[112px]/xl:top-[68px]` → `top-[116px]/xl:top-[72px]` 已同步,三档均无重叠。

修掉一个截图里发现的 bug:`{s.projectCount && <span/>}` 在 `projectCount === 0` 时
被 JSX 原样渲染成一个「0」(经典 React 陷阱)。

---

## 五、部署状态

- 后端:已 `quick-deploy.ps1`,生产在跑(tag `20260729-141428`)
- 前端:已 push,CF Pages 自动部署
- 更新历史页(`/changelog`)已加一条,五语言写全

---

## 六、给她的回信草稿

> Dear Yaroslava,
>
> Thank you — that is exactly the kind of feedback we need, and both points are now fixed.
>
> **Typing an area now takes you straight there.** The search box on the map has been
> rebuilt: type a community name, press Enter, and the map flies there and opens that
> area's market data in one step. It also searches projects and developers now, and it
> no longer needs the exact spelling — "sports city", "Jumeirah Lake Towers" and
> "Emaar Beachfront" all used to return nothing, and now land on the right place.
>
> **On the off-plan coverage** — you are right, and we are adding a large batch of
> projects this week. If there are specific developers or communities you work with
> most, tell me and I will make sure those go in first.
>
> Thank you again for taking the time to write.
>
> Warm regards,
> Eden

（口径:先感谢 → 说已经修好 → 承认库存不足并给时间点 → 反问她最需要哪些楼盘。
不提她的使用数据,不提「你从没用过搜索框」。)

---

## 七、还没做的

- **她要的楼盘库存**:53 → 100,本周补(内容侧)
- `Sport city`、`Medan` 这类**库里名字本身写错**的区,搜索层已经绕过去了,
  但数据层没清 —— 要清的话是 `dubai_areas.name` 的一次性订正,影响面更大(区名
  是 DLD 匹配的 join key),单独评估
- 全库仍缺的区:`Meydan`(只有 MBR District11 的括号注释里带 Medan)、
  `Emaar Beachfront`(只有 `Beach front by Emaar`)—— 名字在,但不是经纪熟悉的写法
