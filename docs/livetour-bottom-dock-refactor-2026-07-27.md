# 实时带看「底部一坨」重构 —— 统一底部浮层坞（BottomDock）

日期：2026-07-27
触发：owner 截图反馈「overlap 了，desktop 和 mobile 的 livetour 都要优化，特别是手机版，下面太拉了」

---

## 1. 根因：坐标各写各的，不是某一条写错了

带看开起来时，屏幕底部同时会有 4~5 条浮层。它们**每一条都自己 `fixed` + 自己算 bottom**：

| 浮层 | 原来的落位 | 文件 |
|---|---|---|
| 带看底栏（状态/头像/聊天/语音/结束） | `bottom: safe + (isPresenter ? 5rem : 1rem)` | `CollabBar.tsx` |
| 画笔调色板 | `bottom-24`（96px） | `DrawPalette.tsx` |
| 经纪分享链接 | `bottom-32 md:bottom-4` | `CollabFrame.tsx` |
| 买家「和经纪通话」大入口 | `bottom: safe + 4rem` | `CollabBar.tsx` |
| 聊天面板 | `bottom: safe + (isPresenter ? 8rem : 4rem)` | `CollabBar.tsx` |
| 视频额度提示 | `bottom: safe + 8rem` | `CollabBar.tsx` |
| 测距状态条 | `bottom-24` | `MapViewMapLibre.tsx` |

算一下就知道必然撞：
- **桌面**：底栏 80→116px，调色板 96→140px → **重叠 20px**（owner 第一张截图）
- **手机**：再加上分享链接 128→168px，三条互相咬，下面还被 MobileNav（64px）吃掉一截

这不是「某个数字写错了」——**只要落位是各组件各写各的，新增任何一条都会再撞一次**。所以修的是机制，不是数字。

## 2. 做法：一个 flex 竖列，重叠在结构上不可能发生

新增 `frontend/src/components/BottomDock.tsx`：

- `<BottomDock>` 由 `Layout` 渲染，全站唯一一个。`pointer-events-none` + `fixed inset-x-0 bottom-0`，`flex flex-col items-center gap-1.5`
- **让开底部导航 + iOS safe-area 只在这一个地方算一次**（`navOffset` 由 `!chromeless` 决定；带看客户端 `/t/:code` 是 chromeless → 直接贴边）
- 各浮层改用 `<DockItem order={DOCK_ORDER.x}>`，内部**不再写任何 fixed / bottom / z**
- 谁上谁下只由 `DOCK_ORDER` 决定，和 portal 挂载顺序无关（挂载顺序不可控）

自下而上：`bar(70) → tools(60) → status(50) → share(40) → cta(30) → notice(20) → chat(10)`

改动文件：`Layout.tsx`、`CollabBar.tsx`、`CollabFrame.tsx`、`DrawPalette.tsx`、`MapViewMapLibre.tsx`（测距状态条也并了进来，否则「测距 + 画笔 + 底栏」还是会撞）。

## 3. 顺带砍掉的手机端冗余

owner 说「手机版下面太拉了」，除了重叠，还有几处白占一行/点不到：

1. **买家的电话按钮出现两次**。没进通话时，上面有一颗大大的「和经纪语音通话」，底栏里还有一颗小电话——同一件事两个按钮，手机上就是两行都在喊打电话。→ 有大入口时底栏这一格不渲染（`bigVoiceCta`）。顺带把 `status==='limit'` 排除掉：额度用完时该显示提示，不是入口（原来两个会互相打脸：底栏写「额度用完」，上面还挂着「和经纪通话」）。
2. **分享链接在手机上整整吃掉一行**，可那条 URL 经纪根本不会照着念。→ 手机只留一颗「复制客户链接」药丸，桌面才把完整链接摊开。
3. **调色板的「清空」在 367px 手机上被裁在屏幕外**，而且滚动条被藏了，连「能滚」都看不出来——等于一颗永远点不到的按钮。→ 窄屏改 `flex-wrap` 排两行（宁可多占一行，也不能有点不到的按钮），桌面仍一行；按钮/色块窄屏收一档；`✕` 在手机隐藏（右上工具卡那颗铅笔本身就是「画笔/退出」开关）。

## 4. 验收：几何验收，不靠肉眼

新增 `frontend/scripts/_shot-livetour-dock.mjs`。量 `#app-bottom-dock` 每个直接子节点的 bounding box：

① 两两不重叠 ② 全在视口内 ③ 最低一条高于底部导航/屏幕底边 ④ 坞本身 `pointer-events:none`（不挡地图）

```bash
VITE_API_URL=https://api.pinzos.com npx vite --port 5174   # 另开终端
node scripts/_shot-livetour-dock.mjs        # HEADED=1 可亲眼看
```

客户端 `/t/:code` 不需要登录 → 跑的是**真实带看 UI**（底栏 + 语音大入口 + 画笔条）。经纪独有的分享链接那一行本地登录不了，用一个同样挂进坞的假节点补上，验的是坞的排布（那正是重叠的成因）——脚本输出里明说了这点。

结果（367×762 / 1180×820 / 1440×900）：**三档全 PASS**，`npx tsc --noEmit` 干净。

## 4b. 第二轮：坞外还有两颗浮钮（我第一轮漏了）

owner 复看仍然撞。**第一轮的验收只量了坞里的条 → 三档全 PASS，可屏幕底部还有两个不在坞里的东西**：

| 元素 | 落位 | 后果 |
|---|---|---|
| 手机端区域搜索圆钮 | `fixed start-2 bottom:76+keyboardInset`（MapPage） | 一点画笔就被调色板压住（owner 第三张截图） |
| Luna 药丸 | `fixed bottom-[76px] md:bottom-[92px] xl:bottom-6 end-0`（VoiceAssistantButton） | 非带看的普通地图上，坞的行会钻到它下面 |

处理：
- **搜索钮搬进坞**（`DOCK_ORDER.search = 65`，收起 `self-start` 保持左下圆钮观感）。键盘弹起靠这一行的 `marginBottom: keyboardInset` 把它和上面整摞一起顶起来（坞是竖列，顶一行等于顶一摞）。
- **Luna 留在原地**（它有自己的展开面板，搬进来风险大），改成**坞给它让位**：`data-luna-pill` 存在且未 hidden → 坞整体 `pe-[4.25rem]`。带看时 Luna 本来就被藏（MapPage `setLunaHidden(collabActive)`），全宽照常可用。
- 一个自己挖的坑：`xl` 上我原本写了 `xl:pe-3`，理由是「桌面屏够宽、行居中，撞不上」。**满宽的行照样撞**（实测叠 36px）。改成所有断点都让位，桌面两侧对称留白保持真居中。

**验收也补了两处**，否则同类漏检还会再来一次：
- 两两比对改成 **坞内 + 坞外一起比**（Luna 靠 `data-luna-pill` 抓）
- 加了 **solo 场景**（`/?drawtest=1` 普通地图，有底部导航 + Luna + 搜索钮）——collab 场景里 Luna 是藏着的，压根测不到它。注：老的 `?drawtest` 后门已被删（画笔现在要求登录），所以 solo 档用注入一条**满宽假调色板行**代替，验的正是最坏几何。
- 顺手修了一个假红灯：`MobileNav` 是 `xl:hidden`，桌面下 rect 全 0 → 会拿到 `navTop=0` 把「在导航之上」判成失败。

结果：**collab × 3 档 + solo × 3 档，全 PASS**。

## 5. 以后加底部浮条的规矩

**别再写 `fixed bottom-*`。** 加一条就是：

```tsx
<DockItem order={DOCK_ORDER.status}>…</DockItem>
```

需要新层级就往 `DOCK_ORDER` 里加一个常量。这样第 8 条、第 9 条浮层加进来也不会再撞。

## 6. 还没做 / 已知边界

- **CollabVideo 画中画**（`z-[2100]`，默认停左下 `bottom: safe+96px`）没并进坞——它是可拖的自由浮窗，不属于「底部一条带」。手机上如果一直不拖，它可能压到坞里最上面那条。要不要把它的默认落位也交给坞，等 owner 实机看过再说。（同理，验收脚本也还没量它。）
- **配套便利度面板**（`start-3 bottom-24`，语音助手触发）仍是老写法，只在 Luna 触发时出现，本次没动。
- 本次只改前端，**未提交、未推送**（前端走 CF Pages 接 push 自动部署，推了就上线）。
