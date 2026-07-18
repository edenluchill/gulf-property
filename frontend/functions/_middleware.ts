/**
 * 🔴 **规范域 301:pinzos.com → www.pinzos.com**
 *
 * 这一条同时修两个看起来毫不相干的问题:
 *
 * 1) **「过一会儿回来就要重新登录」**(owner 长期报的)
 *    裸域和 www 是**两个 origin**,localStorage 互不相通。以前两边都直接 200 供站,
 *    于是在 www 登录 → session 存在 www 下;下次从书签/微信链接落到裸域 → 那个 origin
 *    下没有任何 session → 要你重登。和时间无关,和你从哪个地址进来有关。
 *
 * 2) **Google 只索引了 4 个页面**
 *    两个域返回一模一样的内容 → 重复内容。而且各页面 Helmet 里的 canonical 当时写的是
 *    **裸域**,应用层 JS 又把裸域弹到 www —— Google 顺着 canonical 过去被弹走,
 *    GSC 里就报「Page with redirect / 未索引」。canonical 和实际规范域互相打架。
 *
 * index.html 里那段 JS 跳转是同一件事的**应用层兜底**,两者可以共存 ——
 * 这个边缘 301 生效后,那段 JS 永远不会被触发。留着它,因为它救的是
 * 「HTML 已经缓存在微信 X5 里、根本没经过我们边缘」的老客户。
 *
 * ⚠️ **fragment(#)不会丢**。hash 从来不发给服务器,浏览器在跟随 301 时会把它
 *    重新贴到目标 URL 上(目标本身不带 fragment 时)。OAuth 的 #access_token 安全。
 *
 * ⚠️ 只认死 `pinzos.com` 这一个 hostname。localhost、*.pages.dev 预览、以及任何
 *    其它域都原样放行 —— 预览部署不能被弹到生产域上去。
 *
 * ⚠️ 这是**根** middleware,每个请求(含静态资源)都会过。所以第一件事就是
 *    hostname 判断并 `ctx.next()` 早退,别在这里做任何 IO。
 */

export const onRequest: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url)

  if (url.hostname === 'pinzos.com') {
    url.hostname = 'www.pinzos.com'
    return Response.redirect(url.toString(), 301)
  }

  return ctx.next()
}
