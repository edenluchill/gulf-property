# 客户微信里打开是「巨大 logo + 裸链接」—— 根因与修复

**日期**:2026-07-13
**来源**:客户微信截图 —— "开了几次是这样页面"
**状态**:根因已复现、已修、已验证。**待部署**。

---

## 一、现象

客户在微信里打开 pinzos,看到的是一个撑满屏幕的绿色 logo,底下一列蓝色下划线的裸链接。
不是 404 页(404.html 只有一行 "Not found."),标题栏是
`Pinzos - A New Way to Buy Off-Plan in Du...` —— **就是 index.html 本身**。

也就是说:HTML 到了、JS 跑了、React 把 DOM 渲染出来了,**但一条样式都没生效**。

## 二、根因(已逐像素复现)

微信 X5 内核**无视 index.html 的 `Cache-Control: no-cache`**,存着上一次部署的那份 HTML。
这份旧 HTML 引用的是**旧 hash** 的 CSS/JS:

| 资源 | 旧 hash 的下场 | 后果 |
|---|---|---|
| 旧 **JS** | 还命中 WebView 长缓存 | 照常执行 → React 渲染出完整 DOM |
| 旧 **CSS** | 已被 LRU 淘汰 → 回源 → 新部署后旧 hash 不存在 → `_redirects` 打成 **404** | **样式全无** |

两者叠加 = DOM 全在、样式全无 = 巨大 logo + 裸链接。

**为什么不会自愈**:`main.tsx` 里的过期兜底只监听 `vite:preloadError` / 动态 import 失败 ——
**全是 JS 的**。CSS 的 404 没有任何人接,是一条完全静默的失败路径。所以客户"开了几次都是这样"。

**为什么兜底不能放 main.tsx**:它自己就在那个 JS bundle 里,JS 一挂 handler 就不存在;
而且 `<link>` 的 error 早在模块执行之前就烧完了。必须放 **index.html 的内联脚本**。

### 复现证据(playwright,微信 UA)

只让 `/assets/*.css` 返回 404、JS 照常放行:

```
logo 宽度   : 374px   (正常 32px)
body margin : 8px     (Tailwind preflight 生效时是 0px)
#root 子节点: 1       (React 确实渲染了)
强刷锁      : (没设置 → 兜底根本没跑)
```

截图与客户那张逐像素吻合。

## 三、顺带查出的第二个病:墙内首屏白等 30 秒

`index.html` 里有两个**阻塞渲染**的境外样式表:

- `fonts.googleapis.com`(Fraunces + Inter)—— 中国大陆**完全被墙**
- `unpkg.com/leaflet@1.9.4/dist/leaflet.css` —— 时常不可达

墙的行为不是"干脆拒绝"而是**丢包**,浏览器一路等到超时。playwright 模拟丢包实测:
**DOMContentLoaded 从 637ms → 30,500ms**。客户全在微信里打开,基本都在墙内 ——
**每次打开都在白屏干等半分钟**。

而 unpkg 那行是**纯冗余**:`main.tsx:59` 早就 `import 'leaflet/dist/leaflet.css'`,
leaflet 样式一直在打包产物里(已核对线上 `index-*.css` 含 `.leaflet-container` /
`.leaflet-pane` / `.leaflet-tile`)。它唯一的作用就是在墙内多挂一个不可达的阻塞资源。

## 四、修复

### 1. `frontend/index.html` —— 样式表过期的兜底(内联,在一切之前)

监听 capture 阶段的资源 error(资源错误**不冒泡**,只在捕获阶段到 window),
命中**同源 `/assets/` 下的 stylesheet** 失败 → 判定为构建产物过期 → 强刷一次。

两个必须守住的点:

- **只认同源 `/assets/`**。Google Fonts / unpkg 在墙内是必挂的,拿它们触发强刷 =
  每个大陆客户平白刷一次。
- **不能用 `location.reload()`** —— X5 里可能**还是拿那份缓存的 HTML**。必须换个 URL
  才能逼它回源,所以带一次性 `_r=<ts>`;`sessionStorage` 上锁保证只刷一次,绝不死循环。

### 2. `frontend/index.html` —— 字体改非阻塞 + 删掉 unpkg

Google Fonts 改 `media="print" onload="this.media='all'"`:不参与首屏渲染,加载完再切回。
墙内就是永远切不回来 → 用 fallback(wordmark 是 `Georgia, serif`,正文见 index.css 的
Inter fallback 链)→ **页面照常秒开**。截图确认:视觉上几乎看不出差别。

unpkg 那行直接删。

### 3. `frontend/src/main.tsx` —— 善后

启动成功后清掉 CSS 锁(下次部署还能再救一次),并把 `_r` 从地址栏擦掉
(否则客户复制/分享出去的链接会带着这个参数到处跑)。

## 五、验证

`frontend/scripts/_stale-css-verify.mjs`(保留为回归测试,跑在本地 `vite preview` 的 dist 产物上):

| 场景 | 结果 |
|---|---|
| 1 对照组(不拦任何东西) | ✅ 正常,2370 条规则 / logo 32px / 650ms |
| 2 CSS 一直 404(客户此刻的处境) | ✅ **强刷 1 次**,CSS 只取了 2 次 → 无死循环 |
| 3 CSS 先 404、强刷后放行 | ✅ **页面自愈**成正常样子(2370 规则 / logo 32px) |
| 4 墙内(fonts 丢包式挂起) | ✅ 首屏 **446ms**(修复前 30,500ms),样式正常 |

## 六、让**已经坏掉的**客户刷新就好(服务端兜底)

前面那些前端兜底有个根本局限:它们在**新的 index.html** 里,而出问题的客户 WebView 里存的
是**旧的**那一份 —— **里面没有这些脚本**。他刷新 → X5 又把旧 HTML 端出来 → 还是坏。
**前端兜底只能救"以后"的人,救不了"已经坏了"的人。**

但有个突破口:他的 WebView **必须**回源那个被淘汰的 CSS(缓存里已经没有了)。
**那个 404 请求就是我们唯一还能跟他通话的通道。** 以前我们在这个通道上回了句 "Not found.",
现在改成回**真正的内容**。

`frontend/functions/assets/[[path]].ts`(Cloudflare Pages Function):
入口文件 `/assets/index-<hash>.{js,css}` 404 时,不返回 404,而是返回**当前部署的同名入口**
的内容。于是旧 HTML 拿到最新的 CSS 和最新的 JS —— **等价于新 HTML**。客户刷新就活了,
而且新 JS 里带着前端那层兜底,以后永久免疫。

两条必须守住的边界:

- **只兜入口**。懒加载 chunk 的旧 hash 依然 404 —— 那是对的:让它 404,`main.tsx` 的
  `vite:preloadError` 兜底才能接住并强刷。别把那条路堵死。(已实测:非入口 chunk 仍返回 404)
- **回退响应必须 `no-store`**。它挂在旧 hash 的 URL 上、内容却是"当前最新",一旦被缓存,
  hash→内容 的对应关系就崩了,下次部署这个 URL 又会喂出陈旧内容。

### 验证(`frontend/scripts/_stale-entry-verify.mjs`,跑在 `wrangler pages dev` 上)

拦住 document 把入口 hash 换成不存在的 —— 得到的就是客户 WebView 里那份 HTML:

| | CSS 规则 | logo | React | 地图 | 判定 |
|---|---|---|---|---|---|
| A 对照组(无 Function 兜底) | 0 | — | 0 个子节点 | 无 | ❌ 复现了故障 |
| B **有 Function 兜底** | **2370** | 32px | 1 个子节点 | **有** | ✅ **完全正常** |

对照组先复现故障,才证明这测试算数。**结论:已经坏掉的客户,刷新即恢复,不需要发新链接。**

## 七、后续建议(未做)

- **自托管字体**。现在墙内客户永远拿不到品牌字体 Fraunces/Inter(降级到 Georgia/系统字体)。
  把 woff2 放进 `public/fonts/` + `@font-face` 自托管,可以彻底摆脱对 Google 的依赖,
  墙内也能拿到真正的品牌字体。改动面比这次大,单独做。
- 线上 `/assets/*` 的缓存头目前是 `max-age=14400, must-revalidate`(CF Pages 默认)。
  hash 过的产物本可以 `immutable` + 1 年,能减少回源、也顺带减少这类"CSS 被淘汰后回源 404"
  的窗口。属于加固,不是根因。
