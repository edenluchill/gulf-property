# 手机上「整个页面被放大、UI 被裁掉」—— 不是自适应问题,是整页 pinch-zoom

**日期**:2026-07-14
**来源**:经纪转述客户 —— "用户通过转发的链接打开,不能自适应屏幕大小哎"
**状态**:已修、已验证、已上线。**iOS 真机待 owner 复验。**

---

## 一、这不是响应式布局的问题

客户截图的证据:

- 左侧工具栏被左边缘**切掉**
- 右上指标卡右侧**溢出屏幕**
- 底部 nav 的「登录」被**裁掉一半**
- 指南针只露出半个

所有元素**等比放大且视口整体偏移** —— **布局本身是对的**。这是浏览器级的
**pinch-zoom(visual viewport 缩放)**:客户两根手指在地图 / 底部 nav 上一捏,
整个页面被放大,而且**再也缩不回精确的 1.0** → 从此每次打开都是歪的。

(顺带排除:微信的"字体大小"设置只放大**文字**,不会等比放大图标/地图控件,不是这个。)

查下来:全站**没有任何缩放限制** —— `user-scalable` / `touch-action` / `gesturestart`
一个都没有,整页 pinch-zoom 完全放开。

## 二、owner 定的线

> 放大至少不能整个页面放大吧,比如 navigation bar 或者 header。
> 地图里面或者内容放大我还能接受。

所以要禁的是**整页 viewport 缩放**(会把 header/nav 一起放大再裁掉),
而**地图自己的双指缩放必须留着**。

这两件事是**两套独立机制**,可以分开:
- 整页缩放 = 浏览器的 visual viewport scale
- 地图缩放 = 地图库(MapLibre/Leaflet)自己用 **touch events** 实现

## 三、修复(`src/lib/pinchZoom.ts` + `index.html` + `App.tsx`)

**两个平台要两套手段,缺一不可:**

| 平台 | 手段 |
|---|---|
| 安卓(含微信 X5) | meta viewport 的 `maximum-scale=1, user-scalable=no` |
| **iOS(微信是 WKWebView)** | **忽略** `user-scalable=no`(苹果为可访问性硬性无视)→ 只能 `preventDefault` 掉 WebKit 私有的 `gesturestart/change/end` 事件 |

**为什么不影响地图**:`gesture*` 是 WebKit 私有事件,与 touch events **并行**触发。
拦掉 gesture 只挡住"浏览器缩放整页",地图照常收到 touchmove。(已实证,见下)

**按路由分流,不能一刀切**:

- **应用型**(地图 / 列表 / 表单 …)→ 禁整页缩放。这个 app 的外壳是 `h-screen +
  overflow-hidden`,整页缩放在这里**永远是 bug,从不是 feature**。
- **文档型**(`/pp/` 报价单、`/r/` `/cr/` 报告、`/factsheet/`、`/verify/`)→ **放开**。
  那些是分享给客户看细节的 A4 文档,没有会被裁的固定 nav,放大是刚需。

`index.html` 里的 meta 必须是**静态默认值**(按应用型来)—— React 挂载之前客户就能捏;
文档页由 `pinchZoom.ts` 在路由变化时改回可缩放。

## 四、验证

### `scripts/pinch-zoom-verify.mjs` —— 策略按路由分流

| 页面 | meta 锁死 | gesture 被拦 | 判定 |
|---|---|---|---|
| 地图首页 `/` | 是 | 是 | ✅ 禁缩放 |
| 成交记录 `/transactions` | 是 | 是 | ✅ 禁缩放 |
| 报价单 `/pp/:code` | 否 | 否 | ✅ 可缩放 |
| 客户报告 `/cr/:code` | 否 | 否 | ✅ 可缩放 |
| 切回地图 `/` | 是 | 是 | ✅ 能来回切 |

### `scripts/pinch-map-still-zooms.mjs` —— 地图没被弄坏(owner 的底线)

用 CDP 真发两指手势(playwright 的 touchscreen 只能 tap,做不了 pinch):

```
整页 visualViewport.scale : 1 → 1        ✅ 整页纹丝不动
瓦片请求数                : 39 → 79      (新增 40)
瓦片 zoom 层级             : 12 → 13      ✅ 地图真的在缩放
```

**整页锁死,地图照常缩放。**

## 五、⚠️ 未验证的部分:iOS 真机

`gesture*` 是 **WebKit 私有事件,Chromium(playwright)里根本不存在** —— 所以自动化
**验不了真实的 iOS 行为**。能验的只是"handler 确实注册了且会 preventDefault"。

iOS 上真正生效的是 gesture 拦截那条路径(meta 被苹果忽略),**需要 owner 用 iPhone 在微信里
实测**:①双指捏页面 —— 整页不该放大;②双指捏地图 —— 地图该正常缩放。

最坏情况是 iOS 上没效果 = **维持现状**,不会比现在更坏。

## 六、已经被放大卡住的客户

一旦 pinch 放大过,scale 会留在那个会话里。**页面重新加载 scale 会重置回 1**,
而新版禁用之后就不会再被捏大了 —— 所以客户**刷新一次即可**,不需要额外操作。
