# Collab 实时带看 —— 同步缺口修复 Spec

> 2026-07-12 · 状态：P0 已修，P1-P3 待 owner 定优先级
> 来源：真机带看后的四个反馈（画的东西不清 / area popup tab 不同步 / 没法展示成交页 / iPad↔手机不对等）

---

## 0. TL;DR

四个反馈其实是**同一个架构缺口**的四个面：collab 协议只同步了「地图相机 + 选中项」，
所有**面板子状态**（tab / 筛选 / 滚动）和**路由**都没有线表示。

调查中还发现两个**没人报告过的 bug**：
- ⚠️ 光标用**视口归一化坐标**同步 → iPad→手机必然指错位置（这就是 #4 的根因）
- ⚠️ **断线重连补不回任何东西** → 中途加入的客户看不到经纪已画好的标注

| # | 问题 | 优先级 | 工作量 |
|---|---|---|---|
| ✅ | 带看结束不清标注 | **已修** | — |
| 1 | 光标地理锚定（iPad↔手机指错位置） | **P1** | 1h |
| 2 | 相机视口补偿（客户看不到经纪看到的范围） | **P1** | 3h |
| 3 | area popup 的 tab / 口径同步 | **P2** | 2h |
| 4 | ring replay 死掉（late joiner 看不到标注） | **P2** | 2h |
| 5 | 路由同步（成交记录页等任意页面） | **P3** | 8h |

---

## ✅ P0（已修）带看结束后标注还留在地图上

**根因**：地图是**常驻**的 —— `MapPage` 挂在 `Layout`，靠 `display:none` 隐藏而非卸载
（memory: persistent-map-architecture）。所以 `useCollabDraw` 的 hook **永不 unmount**，
`marks.current`（一个 useRef）和 maplibre 的 `lt-draw` 图层活到整个浏览器 tab 结束。

`clearAll()` 一直存在（`useCollabDraw.ts:426`），但只挂在工具栏的垃圾桶按钮上 ——
**会话结束时从没人调它**。`handleExitCollab` 只是把 code 设成 undefined，
draw 的 effect 就 early-return 了，marks 原地不动。

> 附带发现：`useCollabDraw.ts:22` 的文档注释写着「cleans them up on teardown」——
> **根本没有这段代码**。`removeLayer`/`removeSource` 全仓库零命中。注释在撒谎。

**修法**（`MapPage.tsx`）：`collabActive` 从 true→false 时清标注 + 测距尺。
覆盖经纪「结束」和客户「退出」两条路径。

---

## P1-1. 光标地理锚定 —— iPad↔手机指错位置的根因

**现状**：`useCollabCursor.ts:35-40` 发的是**视口归一化**的 `x, y`（0..1）。

经纪在 iPad 上指「屏幕正中偏右」→ 客户手机上也渲染在「屏幕正中偏右」。
但两台设备**宽高比不同、可见地理范围不同** → **那个位置根本不是同一栋楼**。

**讽刺的是**：协议里**早就定义了地理锚定字段**，注释写得明明白白：

```ts
// protocol.ts:52-57
/** geographic anchor — the lng/lat under the presenter's pointer. Viewers
 *  re-project this every frame so the cursor sits on the SAME building on any
 *  screen size/aspect (Figma-style), not a mismatched normalized position. */
lng?: number
lat?: number
```

**发送端从来没填过它。** 这是个做了一半的功能。

**修法**：
1. presenter 端：`map.unproject([x, y])` → 填 `lng/lat`（`useCollabCursor.ts` 发送处）
2. viewer 端：每帧 `map.project([lng, lat])` 重投影 → 光标落在同一栋楼上
3. 保留 x/y 作为 fallback（指针移出地图时没有地理坐标）

改动小、收益直接，**iPad 经纪 + 手机客户是主力场景**，这条必须先做。

---

## P1-2. 相机视口补偿 —— 客户看不到经纪看到的范围

**现状**：`cam` 同步 `{center, zoom, bearing, pitch}`。

maplibre 的可见地理宽度 ∝ `viewportWidth / 2^zoom`。
同样 zoom 下 iPad（1180px）看到的范围是手机（390px）的 **3 倍**。

→ 经纪说「你看这一整片社区」，客户屏幕上只有中间一小块。**这是带看体验的硬伤。**

**修法**：presenter 在 `cam` 里带上自己的视口尺寸，viewer 补偿 zoom：

```ts
// protocol.ts — CamMsg 加两个字段
vw?: number   // presenter viewport width  (css px)
vh?: number   // presenter viewport height

// viewer 端(useCollabFollow):保证「至少看到经纪看到的全部」
// 取 min → viewer 的可见范围 ⊇ presenter 的可见范围(宁可多看,绝不少看)
const dz = Math.log2(Math.min(myW / cam.vw, myH / cam.vh))
const zoom = cam.z + dz
```

手机上 zoom 会自动拉远（看到的更广），保证经纪指的东西一定在客户屏幕内。
手机屏幕小 → 同样范围下细节更糊,这是物理限制,但**总比看不到强**。

> ⚠️ 老客户端不发 `vw/vh` → `dz` 要在字段缺失时回落为 0（不补偿），保证兼容。

---

## P2-1. area popup 的 tab / 口径同步

**现状**：`select` 消息**有** `tab` 字段（`protocol.ts:78`），但 `MapPage.tsx:639`
**只在 `kind:'project'` 分支读它**。area 分支完全无视。

area popup 的本地状态（都不同步）：
- 桌面 `AreaDetailDialog.tsx:48` — `tab: 'sales' | 'rentals' | 'projects'`（成交/租金/项目）
- 桌面 `AreaDetailDialog.tsx:46` — `usage: 'all' | ...`（住宅/商业口径）
- 移动 `MapPage.tsx:972-973` — `sheetUsage` / `sheetTab`（移动端是另一套 state！）

> 💡 **注意**：area popup 里的「成交」tab **就是该区域的成交记录**。
> 经纪要给客户看成交，很多时候根本不需要跳去 `/transactions` —— 把这个 tab 同步了就够，
> 成本是 P3 路由同步的 1/4。

**修法**：
1. `select` 的 `tab` 分支对 area 也生效（复用现有字段，协议不动）
2. 口径 `usage` 用一个新字段（或把 `tab` 编码成 `"sales|residential"` 这种复合串 —— 更简洁，不动协议）
3. ⚠️ 桌面 dialog 和移动 sheet 是**两套 state**，必须同时接线，否则「经纪 iPad 切 tab，
   手机客户没反应」——正是本次要修的场景

**不做滚动同步**：见 P3 的说明。

---

## P2-2. ring replay 死掉 —— late joiner 看不到已画的标注

**现状（bug）**：
1. 服务器先发 `sync` 快照，里面带 `state.seq`（`collab.ts:136-158`）
2. 客户端收到 `sync` → `lastSeq = state.seq`（`CollabClient.ts:253`）
3. 服务器**接着**补发 ring 里的历史消息
4. 客户端逐条判断 `msg.seq <= lastSeq` → **全部丢弃**（`CollabClient.ts:260`）

→ **重连/补发通道是死的**。而且中途加入的客户 `sync` 里也没有标注
（`CollabState` 只有 `lastCam / selected / participants / recentChat / seq`，**没有 marks**）。

**表现**：客户中途进来，看到的是一张干净的地图 —— 经纪画的圈、箭头、图钉全没有。
经纪浑然不觉，还在说「你看我圈的这块」。

**修法**（两选一）：
- **A（小）**：服务器**先补发 ring 再发 sync**，或让 sync 携带 `replayFrom` 让客户端晚一步设 lastSeq
- **B（正）**：服务器**物化** draw 状态到 `room.marks`，放进 `CollabState` 快照 →
  late joiner 和重连都能一次性拿全。draw 已经是 `mapAction` 上的
  `add/erase/clear` 三个 op，服务端做个 reducer 很轻。

推荐 **B** —— A 只修重连，B 连「中途加入」一起修，而中途加入是真实场景（客户迟到）。

---

## P3. 路由同步 —— 成交记录页等任意非地图页面

**现状**：协议里**完全没有「路由」这个概念**。没有 `k:'route'`，`CollabState` 里没有 path。

经纪导航到 `/transactions` 时会发生什么：
- 带看**不断**（MapPage 常驻，socket 还活着，CollabBar portal 到 body 仍显示）
- 但**客户还盯着地图**，什么都没发生
- 更糟：`cur` 光标还在发（视口归一化）→ 客户看到一个幽灵光标在**自己的地图上**乱飘，
  完全不知道在指什么

唯一的路由后门：Luna 的 `navigate` 工具动作会走 `mapAction` 广播 → 客户会跟着跳
（`MapPage.tsx:598-602`）。但**经纪自己点导航链接不会**。

### ⚠️ 不要去同步 scroll

两台设备内容高度不同（iPad 一屏 = 手机三屏），滚到同一个像素位置**毫无意义**。
同步 scroll 是个陷阱。

### 正解：页面状态进 URL，然后只同步 URL

`TransactionsPage.tsx:69-90` 现在的筛选（`mode/filters/area/rooms/type/year/page`）
**全是本地 state**，整个文件 `collab` 零命中。

**两步**：
1. 把 `TransactionsPage` 的状态改成 `useSearchParams` 驱动（URL 是单一真相源）
2. 加 `k:'route'` 消息同步 `path + search`，viewer 收到就 `navigate()`

→ **经纪筛什么，客户的 URL 就变什么，页面自动重建成一模一样的。**
不用同步 tab，不用同步 scroll，不用同步 filter —— **一个机制解决所有非地图页面**。

同时 `CollabState` 加 `route` 字段，late joiner 直接落到正确的页面。

**副作用（好的）**：URL-driven 之后，成交页本身也变得可分享、可回退、可深链 ——
这是独立于 collab 的产品收益。

---

## 建议的执行顺序

1. **P1（4h）** 光标地理锚定 + 相机视口补偿 —— iPad↔手机是**主力场景**，现在是坏的
2. **P2（4h）** area popup tab 同步 + ring replay 修复 —— 「展示成交记录」的 80% 需求
   其实在 area popup 里就能满足，成本远低于 P3
3. **P3（8h）** 路由同步 —— 做完才能带客户逛任意页面；先要把 TransactionsPage 改成 URL-driven

P1 + P2 = 一天，能把「iPad 经纪带手机客户」这个主力场景从「能用但错位」变成「对得上」。
P3 是另一天的活，且它的价值在 P2 做完后会下降一截（因为成交记录已经能在 area popup 里展示）。
