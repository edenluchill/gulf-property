/**
 * 全站 SEO 默认值 —— **每个页面有且只有一个** description / canonical。
 *
 * 🔴 它修的是一个隐蔽了很久的 bug:**每页有两个 `<meta name="description">`。**
 *    index.html 里有一份静态默认值,各页面的 Helmet 又注入一份 —— 两份共存,
 *    而静态那份**排在前面**。Google 对重复 description 的行为未定义,大概率取第一个,
 *    也就是说 /about /pricing /areas … 各自精心写的 description **一直是废的**,
 *    搜索结果里全站共用同一句泛泛的介绍。
 *
 *    (2026-07-18 用 scripts/seo-check.mjs 真渲染验证时才发现。curl 看不出来 ——
 *     Helmet 是客户端注入的,静态 HTML 里只有一份。)
 *
 * 解法:给 index.html 那份静态 meta 加上 `data-rh="true"`,让 react-helmet-async
 * **认领**它 —— 于是 Helmet 是**替换**而不是追加。但认领之后就必须保证任何路由下
 * 都有人给它一个值,否则 Helmet 会把它整个删掉(首页就没有页面级 Helmet)。
 * 这个组件就是那个兜底:挂在 App 顶层,给出默认值;页面级 Helmet 后渲染,自然覆盖它。
 *
 * canonical 同理:此前**首页根本没有 canonical**(它没有页面级 Helmet)。
 *
 * ⚠️ canonical 一律用 `SITE + pathname`,**不带 query/hash**:
 *    - 域名钉死 www(裸域在边缘 301 过来,见 functions/_middleware.ts)。
 *      canonical 写裸域会让 Google 顺着它撞上跳转 → GSC 判「Page with redirect」。
 *    - 去掉 query 是有意的:地图相机深链(/?v=…)、utm 参数等都该归并到干净的路径上,
 *      否则同一个页面会因为参数不同被当成无数个重复页。
 */
import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'

const SITE = 'https://www.pinzos.com'

const DEFAULT_DESCRIPTION =
  'Pinzos is an interactive Dubai off-plan property platform: a satellite map with real DLD transactions, rents and area metrics, AI brochure parsing, 5-year ROI & Golden-Visa analysis, plus agent tools — real-time co-presence map tours for overseas clients, AI-guided Luna tours, and buyer-intent reports.'

export default function DefaultSeo() {
  const { pathname } = useLocation()

  return (
    <Helmet>
      <meta name="description" content={DEFAULT_DESCRIPTION} />
      <link rel="canonical" href={SITE + pathname} />
    </Helmet>
  )
}
