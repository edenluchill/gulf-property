# 区域弹窗内搜楼盘/楼栋 + 无数据手绘区的真实根因

**日期**：2026-07-22
**commits**：`51edecb`（主功能）·`+1`（空区不显示搜索框）
**部署**：API tag `20260722-090616`；前端 push 触发 CF Pages

---

## 一、做了什么

打开 Dubai Marina 想只看 Marina Gate，以前得跳去成交页、从全城重新选一遍。
现在区域弹窗右栏顶部有搜索框，**成交 / 租约**两个列表跟着收窄。桌面 dialog
与移动 sheet 都有。

- 候选（名字 + 条数，无价格）在弹窗打开时**一次全量取回**，打字是纯内存匹配、
  零请求 —— 也就零地图额度（`/area-places` 进 `UNMETERED`，输入辅助不是数据消费）。
- 打分与成交页统一搜索同一套：前缀 3 / 词首 2 / 包含 1。所以「gate」能命中
  `THE RESIDENCES AT MARINA GATE 2`，不只是前缀匹配。
- 下钻后「在成交页查看全部」深链带的是那个楼盘/楼栋，不再带整个区。

### 为什么新开一套 `area-*` 接口而不复用 `/transactions/*`

| # | 复用不了的原因 |
|---|---|
| ① | `/transactions/suggest` 的索引是**全城**的，且手绘区没有 DLD `area_name`，按区过滤不出来 |
| ② | `buildTxFilter` 里地点类条件彼此是 **OR**（那是上次为「选了楼盘又选楼栋=空集」特意改的）→ `areaId + building` 得到的是「本区 ∪ 全城同名楼栋」，而下钻要的是 **AND**。DLD 里 `TOWER B` 这种通名跨区重名很常见，OR 会串进别区的成交 |
| ③ | `/transactions/*` 是住宅硬口径，弹窗列表跟随 `usage` 透镜 |

③ 顺带修掉一个**既有 bug**：切到商业口径后点「加载更多」，拼上来的是住宅成交
（旧的 `loadMore` 走的就是 `/transactions/list`）。租约列表也顺带有了「加载更多」，
以前死在 8 条。

### 诚实边界（没编数据的地方）

- **租约表没有 `building_name` 列**。选楼栋时租约退到它所属楼盘，并在界面上写明
  「这里显示的是 XX 全盘的租约」，不做名称模糊猜测；楼栋连楼盘归属都没有的，
  租约侧直说无法单独筛。
- **「项目」tab 不给搜索框**。那是我们自己的项目库，与 DLD 楼盘名（阿语原名）
  匹配率极低，拿 DLD 名字去筛只会筛出空集，看着像 bug。
- 没有任何楼盘/楼栋的区，直接不显示搜索框。

### 验证

| 层 | 结果 |
|---|---|
| 后端实测 | 跨区隔离（外区楼栋名查本区 = 0 行）· usage 口径透传 · 翻页不重复 · 坏 areaId → 400 |
| 性能 | Dubai Marina 95 盘/202 栋 **97ms**（bridge）；Sobha Heartland **57ms**（spatial）；缓存 6h |
| 前端 | `frontend/scripts/_shot-area-place-search.mjs`：桌面 + 手机 **18/18 通过** |

跑分脚本里记了两个必须踩对的前提（都栽过）：dev server 要 `VITE_API_URL` 指真后端
（默认指 localhost:3000，地图整个空的）；必须 `HEADED=1`（headless 软件 GL 编译
fragment shader 会失败）。另外把断言从 `.bg-amber-50` 改成 `data-testid` —— 前者会
匹配到指标卡的「低于 -18.2pp」，**假绿灯比假红灯更危险**。

---

## 二、待办 3 的真相：那 18 个手绘区不是「差 geocode」

上一轮的结论是「`--retry-snap` 已把能救的救了，剩下多半是多边形画偏」。
这轮逐个查完，**根因有两种，而且第一种以前没被识别出来**。

### A 类：同一片地被画了两遍，DLD bridge 只能给一个

| 空的那个区 | 数据实际算在 | DLD area |
|---|---|---|
| `Al Safouh Second`（0.74km²） | `Al Sousa second `（3.21km²，中心相距 0.8km） | 371 Al Safouh Second，**1724 笔成交** |
| `Al Hudaiba`（0.43km²） | `Al Jaffiliya`（2.29km²，把它包住了） | 365 Al Hudaiba |
| `Al Qusais Indusdrial 2` | `Al Qusais Industrial 1` | 320 Al Qusais Industrial Second |
| `Damac Riverside` | `Dubai investments Park`（重叠 **100%**） | — |
| `The Wilds` | `Wadi Al Safa 3`（重叠 **100%**） | — |
| `Lanyan comminity` | `Wadi Al Safa 7`（重叠 **98%**） | — |

**这不是数据缺失，是区域表里有重复多边形。** `Al Safouh Second` 的 1724 笔成交
一直好好地显示着 —— 只不过挂在拼成 `Al Sousa second ` 的那个区上（Sufouh 的
拼写变体 + 结尾多个空格）。客户点开小的那个，看到的是灰色空区。

> 另外发现一处**真错配**：DLD 321 `Al Qusais Industrial Third`（在迪拜）
> 被 bridge 到了名为 `Sharjah` 的区（133km²）。只有 1 笔成交，影响可忽略，
> 但说明 bridge 表存在跨城市错连。

### B 类：落点在边界外（geocode 精度）

其余各区边界内 0 个 DLD 项目点，但 **800m 内**有点：

`Vacant Area` 117 · `Jebel Ali Village` 29 · `Dubai island C` 25 · `The Meadows` 23 ·
`Al Mina` 19 · `Al Safouh Second` 17 · `The heights country Club` 14 · `Pearl Jumeirah` 13 …

即项目确实存在，只是坐标落在了多边形外一点点。`Marjan Island` 是唯一 0 点的
（它在哈伊马角，不是迪拜，DLD 不登记）。

### 需要 Eden 拍板的

1. **重复多边形怎么处理** —— 删掉小的那个？还是把两个合并？这是别人画的区，
   我没擅自动。涉及 6 个区，其中 `Al Safouh Second` 背后是 1724 笔真实成交。
2. **`Al Sousa second ` 这类拼写**要不要修正显示名（结尾还带空格）。
3. B 类要不要投入做「边界外 N 米内的点也算进来」的容差匹配 —— 能一次救活
   十几个区，但会让相邻区之间的归属变模糊，需要定 N 和优先级规则。

---

## 三、其余待办状态

| # | 事项 | 状态 |
|---|---|---|
| 1 | 隐藏 20 个非迪拜区 | ❌ **Eden 明确不做** |
| 2 | property_type 三档过滤 | 待办，先跟客户对齐「DLD 没有 townhouse/semi-detached」 |
| 3 | 18 个手绘区无数据 | 根因已查清（见上），**处置待拍板** |
| 4 | 回绝客户 1.5房 / 2+1保姆房 / 3+1 | 待 Eden 跟客户说，数据源没有，不编 |

---

## 本次改动清单

| 文件 | 改了什么 |
|---|---|
| `backend/src/routes/market.ts` | 抽出 `areaMatchMode` / `areaMatchSql`（bridge vs spatial 判定全站唯一）；新增 `/area-places`、`/area-tx`、`/area-rentals` |
| `backend/src/middleware/mapMeter.ts` | `/area-places` 进 `UNMETERED` |
| `frontend/src/components/AreaInsightsPanel.tsx` | 新增 `AreaPlaceSearch`；`AreaRecentTx` 接下钻 + 租约翻页 + 口径修正 |
| `frontend/src/components/AreaDetailDialog.tsx` | 右栏搜索框，state 提升到 dialog（切「项目」tab 不丢选中） |
| `frontend/src/pages/MapPage.tsx` | 移动 sheet 同款 |
| `frontend/src/pages/TransactionsPage.tsx` | 深链读 `?project=` / `?building=` |
| `frontend/src/lib/api.ts` | `fetchAreaPlaces` / `fetchAreaTx` / `fetchAreaRentals` |
| i18n × 5 语言 | `map.json` `areaDialog.*` 16 个新键（俄语 22，复数形式多） |
| `frontend/scripts/_shot-area-place-search.mjs` | 新跑分（gitignore，本地工具） |

**已知未做**：collab 带看时下钻还没广播给客户（tab/usage 已广播）—— 经纪切到某栋，
客户看到的仍是全区。代码里留了 TODO。
