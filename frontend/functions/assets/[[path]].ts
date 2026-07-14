/**
 * 🔴 **旧 hash 的入口文件不许 404 —— 把它接到当前的产物上。**
 *
 * 背景(2026-07-13,客户微信截图"开了几次是这样页面"):
 *   微信 X5 内核**无视 index.html 的 no-cache**,存着上一次部署的那份 HTML。
 *   它引用旧 hash 的资源,而 Cloudflare Pages **只保留最新一次部署的产物**:
 *     • 旧 JS  —— 还命中 WebView 长缓存 → 照常跑 → React 把 DOM 渲染出来
 *     • 旧 CSS —— 已被 LRU 淘汰 → 回源 → 旧 hash 不存在 → 404
 *   叠加起来就是 **DOM 全在、样式全无** = 巨大 logo + 一列裸链接。
 *
 * 为什么兜底非得在**服务端**做:
 *   已经坏掉的客户,WebView 里存的是**旧的 index.html** —— 我们后来往新 HTML 里加的任何
 *   前端兜底脚本,**他那份里都没有**。他刷新 → X5 又把那份旧 HTML 端出来 → 还是坏。
 *   前端兜底只能救"以后"的人,救不了"已经坏了"的人。
 *
 *   但注意:他的 WebView **必须**回源那个被淘汰的 CSS(缓存里已经没有了)。
 *   **那个 404 请求就是我们唯一还能跟他通话的通道。** 以前我们在这个通道上回了句
 *   "Not found."(见 public/_redirects),现在改成回**真正的内容**。
 *
 * 做法:入口文件(/assets/index-<hash>.{js,css})404 时,不返回 404,而是返回**当前部署的
 * 同名入口**的内容。于是旧 HTML 拿到的就是最新的 CSS 和最新的 JS —— **等价于新 HTML**。
 * 客户刷新(甚至不用刷新)就活了,而且新 JS 里带着前端那层兜底,以后永久免疫。
 *
 * ⚠️ 只兜**入口**。懒加载 chunk 的旧 hash 依然 404 —— 那是对的:让它 404,
 *    main.tsx 的 vite:preloadError 兜底才能接住并强刷。别把那条路堵死。
 * ⚠️ 回退响应必须 **no-store**。它挂在一个旧 hash 的 URL 上,内容却是"当前最新",
 *    一旦被缓存下来,hash→内容 的对应关系就崩了,下次部署这个 URL 又会喂出陈旧内容。
 */

interface Env {
  ASSETS: Fetcher
}

/** 只认入口。hash 里可能有 `_` 和 `-`(vite 用的是 base64url)。 */
const ENTRY = /^\/assets\/index-[A-Za-z0-9_-]+\.(css|js)$/

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // 先让 Pages 正常处理。绝大多数请求(hash 没过期)在这里就返回了。
  const res = await ctx.next()
  if (res.status !== 404) return res

  const url = new URL(ctx.request.url)
  const m = ENTRY.exec(url.pathname)
  if (!m) return res // 不是入口(懒加载 chunk / 图片 …)→ 维持 404
  const kind = m[1] as 'css' | 'js'

  // 从当前 index.html 里读出这次部署的入口叫什么
  const htmlRes = await ctx.env.ASSETS.fetch(new URL('/index.html', url))
  if (!htmlRes.ok) return res
  const html = await htmlRes.text()

  const current =
    kind === 'css'
      ? html.match(/href="(\/assets\/index-[A-Za-z0-9_-]+\.css)"/)?.[1]
      : html.match(/src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/)?.[1]

  // 解析不出来,或者要的就是当前这个(那它 404 是别的原因)→ 别自己跟自己打转
  if (!current || current === url.pathname) return res

  const hit = await ctx.env.ASSETS.fetch(new URL(current, url))
  if (!hit.ok) return res

  return new Response(hit.body, {
    status: 200,
    headers: {
      'Content-Type': kind === 'css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Pinzos-Stale-Entry': `${url.pathname} -> ${current}`, // 便于在网络面板里确认兜底真的生效了
    },
  })
}
