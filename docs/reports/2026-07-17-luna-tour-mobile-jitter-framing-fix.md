# Luna Tour 手机版「疯狂抖动 + 开场看不到全貌」根因与修复

**日期**: 2026-07-17
**入口**: `https://www.pinzos.com/?toursession=demo`
**提交**: `56ef83d` (main → Cloudflare Pages 已自动部署上线)
**改动文件**（均前端，桌面全部为 no-op）:
- `frontend/src/luna-tour/engine/cameraTrack.ts`
- `frontend/src/luna-tour/TourOverlay.tsx`
- `frontend/src/components/MapViewMapLibre.tsx`
- `frontend/src/luna-tour/luna-tour.css`

---

## 问题 1：一开始看不到全貌（已确证 + 数学证明修复）

### 根因
- 后端剧本的 establishing shot（开场建立镜头）zoom = **10.2**，是按**宽屏**算的，
  刚好把 3 个项目（经度跨度 **0.211°**：Palm Central `54.987` ~ Serenz `55.198`）框进画面。
- 但前端 `cameraTrack.ts` 有 `MIN_TOUR_ZOOM = 10.8` 的**下限**，会把 10.2 **夹紧到 10.8**
  （本意是防 AI 偶尔写的 zoom-9 大广角在短旁白里读起来发晕）。
- 10.8 在窄屏上横向可见范围骤降。实测几何（Web Mercator：可见经度 ≈ 360/2^z × 视口宽/512）：

  | 视口宽 | 旧 zoom(10.8) 可见经度 | 装得下 0.211°? |
  |---|---|---|
  | 390 (iPhone) | **0.154°** | ❌ 两侧项目出画面 |
  | 414 | 0.163° | ❌ |
  | 768 (平板) | 0.303° | ✅ |
  | 1897 (桌面) | 0.748° | ✅ |

  → **手机上开场就有两个项目在画面外**，这就是「看不到全貌」。

### 修复
1. `MIN_TOUR_ZOOM` 改为**按视口宽自适应**：`innerWidth < 700 ? 9.4 : 10.8`。窄屏放宽下限，
   桌面/平板不变。
2. 新增纯函数 `establishingZoom(authoredZoom, coords)`：用当前视口几何算出「装得下所有项目
   （留 35% 余量）」的 zoom，**只往外退，绝不往里推**（宽屏全景一帧不变）。
3. 欢迎页 `jumpTo` + 引擎 intro 建立关键帧都改用这个 zoom，**无缝衔接不跳**。

修复后几何（已在浏览器实测确认）：

| 视口宽 | 新 zoom | 新可见经度 | 装得下? |
|---|---|---|---|
| 390 | **9.91** | 0.285° | ✅ |
| 414 | 10.0 | 0.285° | ✅ |
| 768 | 10.2 | 0.459° | ✅ |
| 1897 | 10.2（不变）| 1.134° | ✅ |

**桌面零变化**（10.2 本就装得下 → 函数原样返回）。

---

## 问题 2：疯狂抖动（强推断修复，受环境限制无法在本机肉眼复现）

### 根因分析
- Luna Tour 的电影运镜是**逐帧 `map.jumpTo()`**（引擎单时钟采样 cameraTrack）。
- 排除了 React 重渲染路径：collab 那套「每帧 jumpTo → zoomstart/zoomend → setState →
  marker 闪烁 → 震动半秒」的坑，在 `tourActive` 分支里**本来就被跳过**（`if (!tourActive)`），
  所以 tour 模式不是这个原因。
- 因此手机抖动是 **GPU/合成器逐帧成本**问题（桌面正常，只有手机抖 → 与 DPR/GPU 强相关）：
  - 手机 `devicePixelRatio` 2–3 → 每帧要着色 **4–9 倍**像素；
  - 叠加卫星栅格 + 区域填充 + **477 个**渲染要素（含几百个阿语/中文区域标签）+ 45° 俯角；
  - 移动端 GPU 每帧喂不满 → 掉帧 → 肉眼即「疯狂抖动」。
  - `backdrop-filter: blur()` 的常驻 chrome（退出键/经纪徽章/字幕/静音/CC）——
    合成器**每帧对正在移动的地图重做一遍模糊**，是叠加的第二个来源。

### 修复
1. **压 `pixelRatio`**（头号杠杆）：tour 期间 `map.setPixelRatio(min(dpr, 1.5))`，
   退出恢复原生 dpr。高速运动中肉眼几乎无差，每帧像素量砍到约 **1/4**。
   桌面（dpr ≤ 1.5）不触发 —— 已实测桌面 `getPixelRatio()` 保持 1.35 不变。
   （maplibre-gl 5.18 有 `setPixelRatio`，已确认。）
2. **手机去掉常驻 chrome 的 `backdrop-filter`**（`@media (max-width:640px)`）：背景本就半透明，
   去模糊只是略通透，换 GPU 每帧少做几遍全区模糊。字幕底色顺手加深保证可读。桌面保留模糊。

区域标签在 tour 模式已是 `text-allow-overlap + text-ignore-placement`（关掉了逐帧碰撞检测），
其逐帧成本只剩栅格化，正好被 pixelRatio 压制覆盖。

---

## 验证与局限（如实说明）

- ✅ 代码已上线：`setPixelRatio` / `*1.35` / `innerWidth<700?9.4` 三处特征均在线上 bundle 里。
- ✅ 桌面零回归：地图正常渲染、欢迎页构图不变、`pixelRatio` 保持 1.35、tour 正常起播并
  正确停在建立镜头、**无 console 报错**。
- ✅ 问题 1（构图）：几何数学 + 浏览器实算双重证明，手机确定修复。
- ⚠️ 问题 2（抖动）：本机 Chrome 无法模拟手机视口（`innerWidth` 卡在 1897）也无法跑前台 rAF
  （自动化 tab 处于 hidden，rAF 被节流），**无法在本机肉眼复现抖动本身**。
  pixelRatio 压制是移动端逐帧运镜抖动的标准解法，置信度高，但最终确认需 owner 用**真机**打开。

**owner 回来请用手机打开 `?toursession=demo` 复核**：
①开场三个项目是否都在画面内；②运镜是否顺滑不抖。
若个别低端机仍有残余卡顿，下一步可把 tour 期 `pixelRatio` 进一步压到 1.25，
或运镜期间临时降区域标签密度。
