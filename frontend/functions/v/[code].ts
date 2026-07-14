/**
 * Cloudflare Pages Function — 给分享出去的 tour 链接注入**真实的**预览卡片。
 *
 * 🔴 为什么必须有:owner 定「以后只分享我们自己的网站链接」。
 *    而这个链接**贴到任何地方(微信/WhatsApp/Slack/短信)都是一片空白** ——
 *    整站是 SPA,爬虫拿到的是同一份 index.html,于是每一场 tour 的预览都是
 *    「Pinzos - A New Way to Buy Off-Plan in Dubai」,跟这场带看、跟这个经纪、
 *    跟这几套房**毫无关系**。
 *
 *    一个**唯一分发渠道就是「把链接发给客户」**的产品,链接预览就是它的门面。
 *    客户看到的第一眼不是 tour,是这张卡片。
 *
 * 做法:在**边缘**用 HTMLRewriter 改写 <head> 里的 og/twitter 标签 ——
 * 不需要 SSR、不影响 SPA、对真人访客零感知(他们照常拿到同一份 HTML)。
 *
 * ⚠️ og:image **必须是绝对 URL**。原来写的是 `/og-image.jpg`(相对路径),
 *    大多数爬虫直接忽略 —— 所以就算有图也不会显示。
 */

interface TourPayload {
  title?: string
  agent?: { name?: string; title?: string }
  client?: { name?: string } | null
  properties?: { snapshot?: { name?: string; image?: string; area?: string } }[]
}

const API = 'https://api.pinzos.com'
const SITE = 'https://www.pinzos.com'

/** 把 R2 图走我们自己的图片代理 —— 它带 CORP/缓存头,而且域名是我们的。 */
function proxied(url: string): string {
  return `${API}/api/luna/public/img?u=${encodeURIComponent(url)}`
}

class MetaRewriter {
  constructor(private readonly meta: Record<string, string>) {}

  element(el: Element) {
    const prop = el.getAttribute('property') || el.getAttribute('name')
    if (!prop) return
    const v = this.meta[prop]
    if (v) el.setAttribute('content', v)
  }
}

class TitleRewriter {
  constructor(private readonly title: string) {}
  element(el: Element) {
    el.setInnerContent(this.title)
  }
}

export const onRequest: PagesFunction = async (ctx) => {
  const res = await ctx.next()

  // 只改 HTML(静态资源原样放行)
  const type = res.headers.get('content-type') || ''
  if (!type.includes('text/html')) return res

  const code = String((ctx.params as { code?: string }).code || '').trim()
  if (!code) return res

  let tour: TourPayload | null = null
  try {
    const r = await fetch(`${API}/api/luna/public/v/${encodeURIComponent(code)}`, {
      cf: { cacheTtl: 300, cacheEverything: true },
    })
    if (r.ok) tour = (await r.json()) as TourPayload
  } catch {
    /* 拿不到就用默认预览 —— 绝不能因为预览把页面搞挂 */
  }
  if (!tour) return res

  const props = (tour.properties || []).map((p) => p.snapshot).filter(Boolean) as {
    name?: string
    image?: string
    area?: string
  }[]

  const agentName = tour.agent?.name || 'Pinzos'
  const clientName = tour.client?.name
  const n = props.length

  const title = clientName
    ? `${clientName}，${agentName} 为你精选了 ${n} 个家`
    : tour.title || `${agentName} 为你精选了 ${n} 个家`

  const areas = [...new Set(props.map((p) => p.area).filter(Boolean))].slice(0, 3).join(' · ')
  const description =
    (areas ? `${areas} — ` : '') +
    `Luna 带你逐套看,讲清楚为什么它适合你。真实 DLD 数据,不是楼书。`

  // 首套房的图当封面 —— 客户第一眼看到的应该是**房子**,不是我们的 logo
  const cover = props.find((p) => p.image)?.image
  const image = cover ? proxied(cover) : `${SITE}/og-image.jpg`

  const meta: Record<string, string> = {
    'og:title': title,
    'og:description': description,
    'og:image': image,                       // ⚠️ 绝对 URL,爬虫才认
    'og:url': `${SITE}/v/${code}`,
    'og:type': 'website',
    'og:site_name': 'Pinzos',
    'twitter:card': 'summary_large_image',
    'twitter:title': title,
    'twitter:description': description,
    'twitter:image': image,
    description,
  }

  return new HTMLRewriter()
    .on('meta', new MetaRewriter(meta))
    .on('title', new TitleRewriter(title))
    .transform(res)
}
