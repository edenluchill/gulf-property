/**
 * 产品说明书 —— Luna 用来回答「这个功能在哪」「怎么把这个发给我客户」。
 *
 * ## 为什么需要这个
 *
 * 2026-07-17 生产日志，一个真实客户问：
 *
 *     用户: "How can I do live calling?"
 *     Luna: "I can't help with live calling, but I can help you with real estate in Dubai."
 *
 * **产品明明有实时带看**（房间免费、不限场次）。Luna 把一个存在的功能拒绝掉了。
 * 那通对话到此为止，客户再没回来。
 *
 * 反向的错也犯过 —— 客户说「能不能把资料发给我老婆看一下」，Luna 答
 * 「我可以将房屋信息和分析报告通过文本或截图的方式发给您」。**她发不了任何东西。**
 * 凭空发明能力比拒绝更糟：客户会等一个永远不会来的东西。
 *
 * 两种错的根子是同一个：**Luna 的 16 个工具全是买家侧的找房与数据分析，
 * 对产品自身一无所知。** 她既不知道有什么，也不知道没有什么。
 *
 * ## 为什么做成工具而不是写进提示词
 *
 * 提示词刚从 4000 token 砍到 1000，往回塞一份功能清单等于前功尽弃，而且
 * 功能会变、提示词里的副本必然过期。做成工具的好处：
 *   · 提示词只需一句「产品问题去查 explain_feature」
 *   · **可以被 Tier 1 确定性地测**（"live calling" 必须命中实时带看；
 *     admin 功能必须永远查不到）
 *   · 改功能只改这一个文件
 *
 * ## 维护约定
 *
 * 加条目时 `keywords` 要写**客户会怎么说**，不是功能的官方名。客户不会说
 * 「co-presence 协作导览」，他会说 "live call" / "share screen" / 「一起看」。
 */

/** 谁能用 —— 决定 Luna 要不要提「需要升级」 */
type Audience = 'anyone' | 'logged-in' | 'agent' | 'agent-pro' | 'uploader'

export interface Feature {
  id: string
  /** 对客户说的名字（中/英） */
  name: { zh: string; en: string }
  /** 一句话：解决什么问题。站在用户角度，不要写技术描述 */
  solves: { zh: string; en: string }
  /** 具体怎么找到它 —— 要能照着做 */
  where: { zh: string; en: string }
  audience: Audience
  /** 积分/套餐成本，没有就省略 */
  cost?: { zh: string; en: string }
  /** 最容易踩的坑，Luna 应该主动提醒 */
  caveat?: { zh: string; en: string }
  /** 客户会怎么称呼它（全小写，匹配用） */
  keywords: string[]
}

/**
 * ⚠️ **这里只放能对普通客户说的功能。**
 *
 * 绝不收录（说了就是事故）：
 *   · `/admin/*` 全部（行为分析看板、区域编辑器、项目库管理、任务审核）
 *   · `/agent/leads` —— 2026-07-12 已藏导航（8 条 lead 全匿名零联系方式）
 *   · 公开版 `/roi` —— 已下线重定向到经纪侧
 * 漏进来一条，Luna 就会把它讲给客户听。
 */
const FEATURES: Feature[] = [
  {
    id: 'live-tour',
    name: { zh: '实时带看', en: 'Live Tour' },
    solves: {
      zh: '和客户同屏看同一张地图，你指哪他看哪，可以边讲边在地图上标注，还能直接语音或视频通话',
      en: 'Share one live map with your client — they see your cursor and camera, you annotate as you talk, and you can voice or video call inside it',
    },
    where: {
      zh: '经纪台首页左边那张「实时带看」大卡，点进去就进带看模式；开始后复制链接发给客户，客户手机打开免登录',
      en: 'Agent workbench home, the "Live Tour" card on the left. Once started, copy the link to your client — they open it on their phone with no login',
    },
    audience: 'agent-pro',
    cost: {
      zh: '房间免费、不限场次；语音/视频按分钟计入套餐额度（专业版每月含 1200 分钟额度，试用 120）',
      en: 'The room itself is free and unlimited; voice/video is metered against your plan (Pro includes 1200 units/month, trial 120)',
    },
    caveat: {
      zh: '每开一场是一条新链接，旧链接会失效',
      en: 'Each session mints a new link and the old one stops working',
    },
    keywords: [
      'live call', 'live calling', 'call', 'video call', 'voice call', 'phone',
      'live tour', 'share screen', 'screen share', 'together', 'co-browse', 'real time',
      '实时带看', '带看', '通话', '打电话', '语音通话', '视频', '一起看', '共享屏幕', '同屏', '连线',
    ],
  },
  {
    id: 'ai-tour',
    name: { zh: 'Luna AI 导览', en: 'Luna AI Tour' },
    solves: {
      zh: '生成一条会自动播讲的导览，发给客户让他自己看，不用你陪着',
      en: 'Generate a self-playing narrated walkthrough you send to a client so they can watch it on their own time',
    },
    where: {
      zh: '经纪台左侧「AI 导览」，或首页右边那张卡；生成后在列表行的「⋯」里复制链接',
      en: 'Agent workbench → "AI Tour" in the sidebar, or the card on the right of the home page. Copy the link from the "⋯" menu on the list row',
    },
    audience: 'agent',
    cost: { zh: '每条 100 积分', en: '100 credits per tour' },
    caveat: {
      zh: '生成出来先是草稿，**必须点发布客户才打开得了，否则是 404**；发布可选带配音或无配音（无配音走字幕，不烧语音额度）',
      en: 'It starts as a draft — you MUST publish it or the client gets a 404. You can publish with narration or silent-with-subtitles',
    },
    keywords: [
      'ai tour', 'tour', 'walkthrough', 'narrated', 'presentation', 'auto play', 'luna tour',
      'ai导览', '导览', '带讲', '自动播', '讲解',
      // ⚠️ **别把分享对象写死成「客户」。** 第一版只有「发给客户 / send to client」，
      // 于是客户说「把资料发给**我老婆**看一下」时一个都匹配不上（客/户二字缺席），
      // Luna 只好答「我不确定是否有这个功能」—— 而分享正是她最该会答的问题。
      // 分享的意图跟发给谁无关。
      'send', 'share', 'forward', 'send this', 'share this', 'link',
      '发给', '分享', '发送', '转发', '资料', '发过去',
    ],
  },
  {
    id: 'sales-offer',
    name: { zh: 'Sales Offer 报价单', en: 'Sales Offer' },
    solves: {
      zh: '给客户出一份正式的付款计划报价单，A4 文档样式，可以直接发链接',
      en: 'A clean A4-style payment-plan quote you can send as a link',
    },
    where: {
      zh: '项目详情页 →「付款计划」tab → 底部「生成 Sales Offer」→ 选户型、填报价，生成后自动跳转',
      en: 'Project detail page → "Payment Plan" tab → "Generate Sales Offer" at the bottom → pick the unit type and enter your price',
    },
    audience: 'agent',
    cost: { zh: '每份 5 积分', en: '5 credits each' },
    caveat: { zh: '链接 60 天后过期', en: 'The link expires after 60 days' },
    keywords: [
      'offer', 'quote', 'quotation', 'payment plan', 'proposal', 'price sheet',
      '报价', '报价单', '付款计划', '方案', '出个价',
    ],
  },
  {
    id: 'client-report',
    name: { zh: '客户分析报告', en: 'Client Fit Report' },
    solves: {
      zh: '针对某个客户的需求出一份有论证的投资分析报告，可以分享',
      en: 'A reasoned investment analysis written for one specific client, shareable as a link',
    },
    where: {
      zh: '经纪台左侧「客户分析报告」，也可以从「客户雷达」里某个客户的卡片直接出；想先看样子可以打开 /cr/demo',
      en: 'Agent workbench → "Client Report" in the sidebar, or straight from a client card in the CRM. There is a sample at /cr/demo',
    },
    audience: 'agent',
    cost: { zh: '每份 20 积分', en: '20 credits each' },
    keywords: [
      'report', 'analysis', 'client report', 'investment report', 'proposal',
      '报告', '分析报告', '客户报告', '投资分析',
    ],
  },
  {
    id: 'branded-report',
    name: { zh: '经纪品牌项目报告', en: 'Branded Project Report' },
    solves: {
      zh: '带你自己品牌的单项目报告，发给客户看',
      en: 'A single-project report carrying your own branding, to send to a client',
    },
    where: {
      zh: '项目详情页上的生成报告按钮，生成后链接会自动复制到剪贴板',
      en: 'The generate-report button on a project detail page — the link is copied to your clipboard',
    },
    audience: 'agent',
    keywords: ['branded report', 'my brand', 'project report', '品牌报告', '项目报告', '带我名字'],
  },
  {
    id: 'crm',
    name: { zh: '客户雷达', en: 'Client CRM' },
    solves: {
      zh: '管理客户档案、看谁最近在看房、记跟进、推进管道阶段',
      en: 'Track client profiles, see who has been active, log follow-ups, move deals through stages',
    },
    where: { zh: '经纪台左侧「客户雷达」', en: 'Agent workbench → "Clients" in the sidebar' },
    audience: 'agent',
    keywords: ['crm', 'clients', 'follow up', 'pipeline', 'leads', 'contacts',
      '客户', '客户管理', '跟进', '管道', '客户雷达'],
  },
  {
    id: 'roi-simulator',
    name: { zh: '收益模拟器', en: 'ROI Simulator' },
    solves: {
      zh: '模拟一套房 5 年的收益和回本年限，给客户看投资账',
      en: 'Model 5-year returns and payback period for a property',
    },
    where: { zh: '经纪台左侧「收益模拟」', en: 'Agent workbench → "ROI Simulator" in the sidebar' },
    audience: 'agent',
    keywords: ['roi', 'simulator', 'return', 'payback', 'calculator',
      '收益', '模拟', '回本', '计算器', '测算'],
  },
  {
    id: 'referral',
    name: { zh: '推广有礼', en: 'Referral Program' },
    solves: { zh: '推荐其他经纪注册，换免费使用月份', en: 'Refer other agents and earn free months' },
    where: { zh: '经纪台左侧「推荐有礼」', en: 'Agent workbench → "Referral" in the sidebar' },
    audience: 'agent',
    keywords: ['referral', 'invite', 'refer a friend', 'promo',
      '推荐', '邀请', '推广', '返利'],
  },
  {
    id: 'map-timeline',
    name: { zh: '地图时间轴', en: 'Map Timeline' },
    solves: { zh: '拖动时间条看某个区域的价格是怎么一年年变过来的', en: 'Scrub through months to watch how an area\'s prices moved' },
    where: {
      zh: '地图右下工具卡里的时间轴按钮（时钟图标），进去后可以连续拖动或播放',
      en: 'Map → tools card at the bottom right → the timeline (clock) button',
    },
    audience: 'anyone',
    keywords: ['timeline', 'history', 'over time', 'trend', 'past years',
      '时间轴', '历史', '走势', '几年', '变化'],
  },
  {
    id: 'map-measure',
    name: { zh: '地图测距', en: 'Distance Measure' },
    solves: { zh: '量两点之间的实际路程', en: 'Measure real road distance between two points' },
    where: { zh: '地图右下工具卡里的尺子按钮', en: 'Map → tools card at the bottom right → the ruler button' },
    audience: 'anyone',
    keywords: ['measure', 'distance', 'how far', 'ruler', '测距', '量距离', '多远'],
  },
  {
    id: 'favorites',
    name: { zh: '收藏', en: 'Favorites' },
    solves: { zh: '把喜欢的项目存起来，换设备也还在', en: 'Save projects you like — synced across your devices' },
    where: { zh: '顶部的心形按钮，或项目卡上的心形', en: 'The heart button in the header, or on any project card' },
    audience: 'logged-in',
    keywords: ['favorite', 'save', 'bookmark', 'shortlist', '收藏', '存起来', '保存'],
  },
  {
    id: 'upload-brochure',
    name: { zh: '上传楼书', en: 'Upload Brochure' },
    solves: { zh: '传开发商 PDF 楼书，自动抽取户型、价格、付款计划', en: 'Upload a developer PDF and have unit types, prices and payment plans extracted automatically' },
    where: { zh: '顶部导航「管理」下拉 →「上传楼书」', en: 'Header → "Manage" dropdown → "Upload Brochure"' },
    audience: 'uploader',
    cost: { zh: '每份 40 积分', en: '40 credits per brochure' },
    caveat: {
      zh: '需要单独开通上传权限，不是所有账号都有',
      en: 'Requires upload permission to be granted separately — not every account has it',
    },
    keywords: ['upload', 'brochure', 'pdf', 'add project', 'import',
      '上传', '楼书', '录入', '导入', '加项目'],
  },
  {
    id: 'billing',
    name: { zh: '订阅与套餐', en: 'Billing & Plans' },
    solves: { zh: '升级套餐、管理订阅、看还剩多少积分', en: 'Upgrade, manage your subscription, check remaining credits' },
    where: { zh: '个人中心左侧「订阅与套餐」', en: 'Profile → "Billing" in the sidebar' },
    audience: 'logged-in',
    keywords: ['billing', 'plan', 'upgrade', 'subscription', 'credits', 'pricing', 'cost', 'pay',
      '订阅', '套餐', '升级', '积分', '价格', '多少钱', '付费', '续费'],
  },
]

/** 归一化：小写、去标点、CJK 保留 */
function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export interface GuideHit {
  feature: Feature
  score: number
}

/** 把一段文本拆成可比对的单元：英文按词，中文按字 */
function units(s: string): string[] {
  const out: string[] = []
  for (const word of norm(s).split(' ')) {
    if (!word) continue
    if (/[一-鿿]/.test(word)) out.push(...word.split(''))
    else out.push(word)
  }
  return out
}

/**
 * 把「客户的原话」匹配到功能。
 *
 * 刻意用**关键词打分**而不是向量检索：条目只有十几条，关键词能被 Tier 1
 * 确定性地断言（"live calling" 必须命中 live-tour），出错时也一眼看得出为什么。
 *
 * ⚠️ **第一版用子串匹配，两个最重要的问句直接漏掉：**
 *   · 「怎么把这个发给**我**客户」—— 关键词是「发给客户」，中间多一个「我」，
 *     子串就对不上了，结果匹配到只含「客户」二字的 CRM（答非所问）
 *   · "can I **send this to** my client" —— 关键词 "send to client"，同样对不上
 * 人不会一字不差地复述关键词。改成**覆盖率打分**：关键词的每个单元
 * （英文按词、中文按字）出现在问句里就算命中，覆盖率够高才算这条关键词命中。
 * 这样「发给我客户」对「发给客户」是 4/4 全覆盖，稳稳压过 CRM 的「客户」。
 */
const MIN_KEYWORD_COVERAGE = 0.8

export function findFeatures(query: string, limit = 3): GuideHit[] {
  const qUnits = new Set(units(query))
  if (!qUnits.size) return []

  const hits: GuideHit[] = []
  for (const f of FEATURES) {
    let score = 0
    for (const kw of f.keywords) {
      const kUnits = units(kw)
      if (!kUnits.length) continue
      const covered = kUnits.filter((u) => qUnits.has(u)).length
      const coverage = covered / kUnits.length
      if (coverage < MIN_KEYWORD_COVERAGE) continue
      // 关键词越长（信息量越大）权重越高:「发给客户」应该压过「客户」
      score += kUnits.reduce((a, u) => a + u.length, 0) * coverage
    }
    if (score > 0) hits.push({ feature: f, score: Math.round(score * 10) / 10 })
  }
  return hits.sort((a, b) => b.score - a.score || a.feature.id.localeCompare(b.feature.id)).slice(0, limit)
}

/** 全部功能 id —— 给跑分用，确保没有 admin/下架功能混进来 */
export function allFeatureIds(): string[] {
  return FEATURES.map((f) => f.id)
}

/**
 * 全部功能。给**经纪产品教练**（`agent-coach.ts`）把整本手册喂给模型 ——
 * 经纪的问题常常要串好几个功能（"想让客户看资料" = 建导览 → 发布 → 复制链接），
 * 只给关键词匹配到的一条串不起来。
 *
 * ⚠️ 安全前提:这张表里**只有能对外说的功能**（见上方那条注释），
 * 所以全量下发是安全的 —— admin/* 和已下架的从来就没进来过。
 */
export function allFeatures(): readonly Feature[] {
  return FEATURES
}

/** 按语言取一份可直接朗读的说明 */
export function describeFeature(f: Feature, lang: 'zh' | 'en' = 'en') {
  return {
    feature: f.name[lang],
    solves: f.solves[lang],
    where: f.where[lang],
    who_can_use: f.audience,
    cost: f.cost?.[lang],
    caveat: f.caveat?.[lang],
  }
}
