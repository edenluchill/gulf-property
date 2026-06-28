# Cloudflare 机器人防护 —— 开启步骤（防爬,不误伤真人）

> 这部分是 **CF 后台操作**,代码碰不到,需要你手动开。下面是照做步骤 + 安全设置。
> 目标:挡自动化爬虫/批量抓取,**但绝不给真实访客弹验证码**(守"UX 不能变差")。

## 0. 前提

- `api.pinzos.com` 是橙云代理(走 CF)→ CF 能挡爬。
- `upload-api.pinzos.com` 是灰云(DNS only,绕 CF)→ CF 管不到,但它只做上传,不返回 area 数据,无所谓。
- 前端 `www.pinzos.com` / `pinzos.com` 走 CF。

## 1. Bot Fight Mode(免费版,先开这个)

路径:**CF 后台 → 选 pinzos.com 域 → Security → Bots**
- 打开 **Bot Fight Mode**。
- 它自动挑战"明显是脚本"的请求(没有真实浏览器指纹的),对真人浏览器**无感**。
- ⚠️ 注意:它也会挑战**善意爬虫**(包括你自己的监控脚本/压测脚本)。所以:
  - 你的压测脚本 `load-test.ts` 之后要跑,得从**白名单 IP** 跑,或临时关掉(见 §4)。
  - Googlebot 等正经搜索引擎 CF 默认放行,不影响 SEO。

## 2. WAF 自定义规则(精准挡批量抓 area 的爬虫)

路径:**Security → WAF → Custom rules → Create rule**

建一条"高频打数据接口就挑战"的规则(比纯限流更聪明,只挑战可疑的):
- **字段**:`URI Path contains /api/dubai/areas` OR `contains /api/market`
- **动作**:`Managed Challenge`(托管挑战——真人浏览器秒过,脚本过不去)
- 可加条件:`Threat Score gt 10`(只挑战 CF 已经觉得可疑的),进一步避免误伤。

> 真人点地图偶尔打这些接口、且有真实浏览器 → 托管挑战对他们几乎无感(背后自动过)。脚本批量抓 → 卡住。

## 3. (可选,Pro 套餐才有)Super Bot Fight Mode

如果以后上 CF Pro($20/月):**Security → Bots → Super Bot Fight Mode**,可细分"definitely automated / likely automated / verified bots"分别处理,粒度更细。免费版用 §1+§2 已经够。

## 4. 别把自己挡了(重要)

- 你的 **压测脚本 / 监控 / 自己的爬数据任务** 会被当成 bot。跑之前:
  - 要么在 **Security → WAF → Tools → IP Access Rules** 把你的出口 IP 加 **Allow**(白名单);
  - 要么临时关 Bot Fight Mode 跑完再开。
- 后端那条 **限流(2000/min/IP,已上线)** 是兜底,和 CF 这层是互补:CF 挡"像不像 bot",限流挡"打太频"。

## 5. 验证不误伤真人

开完后:
1. 自己用手机/电脑正常打开 `www.pinzos.com`,点几个区、切指标 → 应**全程无验证码、无卡顿**。
2. 找个同事用不同网络打开试一遍。
3. 看 CF 后台 **Security → Events**,确认被挑战的是脚本类流量,不是真实访客。
   若发现误伤真人 → 把 §2 的动作从 `Managed Challenge` 降级为 `Log`(只记录不拦),观察几天再收紧。

## 6. 一句话

- **先开 §1 Bot Fight Mode**(一个开关,最省事)。
- 想更精准再加 **§2 WAF 规则**(只挑战可疑的打数据接口流量)。
- 跑自己的脚本前记得 **§4 白名单**,别把自己锁外面。
- 全程盯 **Security → Events** 确认没误伤真人。
