/**
 * 更新历史 —— 面向**客户**的「这周我们改了什么」。
 *
 * 🔴 **绝不要从 git commit 自动生成。**
 * commit 信息是写给自己看的:里面有收入数字、用户邮箱、「唯一付费客户扣款失败」
 * 这类东西,还有一堆客户根本不关心的内部实现。自动同步一次就会把它们公开出去,
 * 而且**收不回来**(页面会被爬、被缓存)。这份清单必须一条条手写、手筛。
 *
 * 写的时候只回答一个问题:**「这条对用户意味着什么?」**
 *   ✅「测距的距离数字挪到了线段中间，不再被端点挡住」
 *   ❌「修复 coords[floor(len/2)] 对两点线段取到终点的问题」
 *
 * 语言:只维护 zh + en。站点有 5 个语言,但更新日志逐条翻 5 份的维护成本会让它很快
 * 停更 —— 停更的更新日志比没有更糟(客户看到最后更新是三个月前)。其余语言回落英文。
 *
 * 加一条 = 在数组**开头**插一项。日期用发布日(YYYY-MM-DD)。
 */

export type ChangeKind = 'new' | 'improve' | 'fix'

export interface ChangeEntry {
  date: string          // YYYY-MM-DD
  kind: ChangeKind
  zh: string
  en: string
}

export const CHANGELOG: ChangeEntry[] = [
  {
    date: '2026-07-28',
    kind: 'improve',
    zh: '实时带看的底部工具条重做：画笔、语音、分享链接和搜索不再互相遮挡，手机上尤其明显。',
    en: 'Rebuilt the live-tour toolbar: the pen, voice, share link and search no longer overlap each other — a big difference on phones.',
  },
  {
    date: '2026-07-28',
    kind: 'fix',
    zh: '测距的距离数字现在显示在线段中间，不再被终点的圆点挡住；路线模式只报距离，不再显示会误导人的预估时间。',
    en: 'Distance labels now sit at the middle of the line instead of hiding behind the end marker. Route mode shows distance only — the estimated drive time was removed because it could not account for traffic.',
  },
  {
    date: '2026-07-28',
    kind: 'fix',
    zh: '画圈时的「半径」提示在英文/法文/俄文/阿拉伯文界面下会显示中文，已修。',
    en: 'The circle "radius" label showed Chinese text on non-Chinese interfaces. Fixed in all five languages.',
  },
  {
    date: '2026-07-27',
    kind: 'improve',
    zh: '带看结束后的意向报告改为提前生成，打开时几乎立刻出来（原先要等 6–8 秒）。',
    en: 'The post-tour interest report is now prepared as soon as the session ends, so it opens almost instantly instead of taking 6–8 seconds.',
  },
  {
    date: '2026-07-27',
    kind: 'improve',
    zh: '按区域筛选租金数据的速度提升约一倍。',
    en: 'Filtering rental data by area is now about twice as fast.',
  },
  {
    date: '2026-07-26',
    kind: 'fix',
    zh: '实时带看中拒绝了麦克风权限后，整场语音都连不上；现在会自动降级为「只听」，随时可以重新开麦。',
    en: 'Declining the microphone prompt used to break voice for the whole live tour. It now falls back to listen-only, and you can enable your mic again at any time.',
  },
  {
    date: '2026-07-26',
    kind: 'fix',
    zh: '晚进房的客户有时听不到语音、看不到摄像头，已修。',
    en: 'Clients who joined a live tour late sometimes could not hear audio or see the camera. Fixed.',
  },
  {
    date: '2026-07-25',
    kind: 'new',
    zh: '实时带看新增语音通话入口：客户可以主动呼叫经纪，并能看到当前是谁在说话。',
    en: 'Live tours got a proper voice-call entry point: clients can call the agent themselves, and everyone can see who is currently speaking.',
  },
  {
    date: '2026-07-25',
    kind: 'new',
    zh: '经纪台的「实时带看」页可以直接查看每一场的历史记录和客户意向报告。',
    en: 'The Live Tours tab in the agent console now lists every past session with its client-interest report.',
  },
  {
    date: "2026-07-24",
    kind: "new",
    zh: "实时带看的标记工具升级：箭头、文字、图钉、圈选，圈一块地就能出该区域的行情数据。",
    en: "Live-tour markup got arrows, text labels, pins and lasso — circle any patch of land and that area’s market data appears.",
  },
  {
    date: "2026-07-22",
    kind: "improve",
    zh: "实时带看改成「一场一码」：经纪一结束，旧链接立刻失效，上一位客户拿不到下一场。",
    en: "Every live tour now gets its own one-time link. The moment the agent ends the session the link dies, so a previous client can never wander into the next tour.",
  },
  {
    date: "2026-07-20",
    kind: "new",
    zh: "客户进入实时带看前会先填个称呼（联系方式选填），带看结束的意向报告能对上人。",
    en: "Clients now enter a name (contact details optional) before joining a live tour, so the post-tour interest report is tied to a real person.",
  },
  {
    date: "2026-07-16",
    kind: "improve",
    zh: "手机版地图重排：筛选贴左侧竖排即点即用，搜索沉到底部拇指区。",
    en: "Reworked the mobile map layout — filters run down the left edge within thumb reach, and search sits at the bottom.",
  },
  {
    date: "2026-07-14",
    kind: "new",
    zh: "经纪会员欢迎卡：可验证的数字凭证，扫码即可查真伪。",
    en: "Agent welcome cards: a verifiable digital credential with a QR code anyone can scan to check it is genuine.",
  },
  {
    date: "2026-07-12",
    kind: "new",
    zh: "经纪台新增逐笔积分流水和使用记录，每一分积分花在哪都看得见。",
    en: "The agent console now shows a line-by-line credit ledger and usage history — you can see exactly where every credit went.",
  },
  {
    date: "2026-07-10",
    kind: "improve",
    zh: "专业版降价至 $49/月，年付送两个月。",
    en: "Pro dropped to $49/month, with two months free on annual billing.",
  },
  {
    date: "2026-07-09",
    kind: "improve",
    zh: "个人中心改版：头像、名片、订阅、收藏全部平铺可见，不再层层点开。",
    en: "Redesigned the account area — profile, agent card, subscription and favourites are all visible at once instead of buried in menus.",
  },
  {
    date: "2026-07-08",
    kind: "improve",
    zh: "手机地图改成价签式卡片，同屏能看到的项目从 2–3 个提到 6 个以上。",
    en: "Mobile map switched to price-tag cards — you can now see 6+ listings on screen instead of 2–3.",
  },
  {
    date: "2026-07-07",
    kind: "new",
    zh: "经纪报价单（Sales Offer）：选户型、填实际报价、一键转发给客户，60 天有效。",
    en: "Sales Offers: pick a unit, enter your real quote, and send a link to the client. Valid for 60 days.",
  },
  {
    date: "2026-07-06",
    kind: "new",
    zh: "付款计划改版：选户型 → 填报价 → 一键转发客户，附交互式时间线图表。",
    en: "Reworked payment plans: choose a unit, enter the price, share a link — with an interactive payment timeline chart.",
  },
  {
    date: "2026-07-05",
    kind: "new",
    zh: "新增隐私政策与服务条款页面（中英双语）。",
    en: "Added Privacy Policy and Terms of Service pages in both English and Chinese.",
  },
  {
    date: "2026-07-04",
    kind: "new",
    zh: "四种角色的引导流程（买家 / 经纪 / 经纪公司 / 开发商），各自看到该看的东西。",
    en: "Onboarding now branches by role — buyer, agent, agency or developer — so each sees only what is relevant to them.",
  },
  {
    date: "2026-07-03",
    kind: "improve",
    zh: "买家永久免费使用地图；未订阅的访客每天有免费探索时长。",
    en: "The map stays free forever for buyers, and visitors get a free daily exploration allowance.",
  },
  {
    date: "2026-07-02",
    kind: "new",
    zh: "期房 / 现房口径分离：地图和区域弹窗都能切换「综合 / 期房 / 现房」。",
    en: "Off-plan and ready-property figures are now separated — switch between All / Off-plan / Ready on both the map and area panels.",
  },
  {
    date: "2026-07-01",
    kind: "new",
    zh: "Luna 支持文字模式：不方便说话时打字也能让她飞地图、出数据卡片。",
    en: "Luna now works in text mode — type instead of talking and she still flies the map and pulls up data cards.",
  },
  {
    date: "2026-06-29",
    kind: "new",
    zh: "学校和医院配套加入官方 KHDA 评级、照片和中英文介绍，Luna 和项目页都会讲。",
    en: "Schools and hospitals now carry official KHDA ratings, photos and bilingual descriptions — Luna and the project pages both use them.",
  },
  {
    date: "2026-06-28",
    kind: "improve",
    zh: "每个区域弹窗都有缩略图：有项目用项目图，没有就用该区的卫星航拍。",
    en: "Every area panel now has a thumbnail — a project photo where we have one, otherwise a satellite view of that district.",
  },
  {
    date: "2026-06-28",
    kind: "improve",
    zh: "收藏改为存在账号里，换设备也还在。",
    en: "Favourites are stored on your account now, so they follow you across devices.",
  },
  {
    date: "2026-06-26",
    kind: "new",
    zh: "项目详情页加入付款时间线、分组配套、位置情报和投资评分卡。",
    en: "Project pages gained a payment timeline, grouped amenities, location intelligence and an investment scorecard.",
  },
  {
    date: "2026-06-25",
    kind: "new",
    zh: "经纪可生成带自己品牌的项目报告和客户投资建议书，一条链接发给客户。",
    en: "Agents can now generate branded project reports and full client investment proposals, shareable as a single link.",
  },
  {
    date: "2026-06-25",
    kind: "new",
    zh: "客户 CRM：建立客户档案，再直接从档案生成报告或导览。",
    en: "Client CRM: create a client profile, then generate a report or a tour straight from it.",
  },
  {
    date: "2026-06-25",
    kind: "new",
    zh: "净回报（Net Yield）：扣掉物业费之后的真实回报率，区域和项目页都有。",
    en: "Net Yield — the return after service charges — now appears on both area and project pages.",
  },
  {
    date: "2026-06-24",
    kind: "improve",
    zh: "手绘区域也能算行情：任意画一块地，成交数据按空间匹配出来。",
    en: "Hand-drawn areas now get real numbers — draw any shape and transactions are matched to it spatially.",
  },
  {
    date: "2026-06-21",
    kind: "new",
    zh: "实时带看上线：经纪和海外客户看同一张地图，镜头同步，可语音通话。",
    en: "Live tours launched: the agent and an overseas client share one map with synced camera movement and in-app voice.",
  },
  {
    date: "2026-06-21",
    kind: "new",
    zh: "项目详情加入「买家信心」区块：黄金签证资格、永久产权、免税、工程进度。",
    en: "Project pages gained a buyer-confidence block: Golden Visa eligibility, freehold status, tax-free ownership and build progress.",
  },
  {
    date: "2026-06-19",
    kind: "improve",
    zh: "地图项目 pin 聚合显示，点开是带图卡片，密集区不再糊成一片。",
    en: "Map pins now cluster, and tapping one opens a card with a photo — dense areas no longer turn into a blur.",
  },
  {
    date: "2026-06-18",
    kind: "new",
    zh: "成交记录页加入租金视图，成交和租约可以对照着看。",
    en: "Added a rental view to the transactions page so you can compare sales and lease records side by side.",
  },
  {
    date: "2026-06-17",
    kind: "new",
    zh: "项目投资分析上线：区位情报 + 投资评分。",
    en: "Launched project investment analysis — location intelligence plus an investment score.",
  },
  {
    date: "2026-06-16",
    kind: "fix",
    zh: "迪拜本地上传大文件经常中断，改成浏览器直传，几百 MB 的楼书也稳了。",
    en: "Large uploads used to drop on Dubai connections. Files now upload straight from the browser, so 500 MB brochures go through reliably.",
  },
  {
    date: "2026-06-12",
    kind: "new",
    zh: "AI 楼书解析：上传开发商 PDF，自动抽出户型、价格、付款计划和效果图。",
    en: "AI brochure parsing: upload a developer PDF and units, prices, payment plans and renderings are extracted automatically.",
  },
  {
    date: "2026-06-12",
    kind: "improve",
    zh: "区域弹窗加入四个指标的走势图和已验证的近期成交。",
    en: "Area panels gained trend sparklines for all four metrics plus a verified recent-sales list.",
  },
  {
    date: "2026-06-08",
    kind: "improve",
    zh: "卫星底图升级到高清视网膜瓦片。",
    en: "Upgraded the satellite basemap to high-resolution retina tiles.",
  },
  {
    date: "2026-06-06",
    kind: "new",
    zh: "Luna 导览可编辑：时间线编辑器、可调镜头、可加地标停留、可上传自己的实拍素材。",
    en: "Luna tours became editable — a timeline editor, adjustable camera moves, extra landmark stops and your own uploaded footage.",
  },
  {
    date: "2026-06-06",
    kind: "new",
    zh: "每场导览都有一份可核对的「事实清单」页，客户能自己验证数据来源。",
    en: "Every tour now has a verifiable fact sheet page so clients can check where each number came from.",
  },
  {
    date: "2026-06-02",
    kind: "new",
    zh: "Luna 导览加入 AI 配音解说，镜头跟着旁白走。",
    en: "Luna tours gained AI voice narration, with the camera choreographed to the script.",
  },
  {
    date: "2026-05-31",
    kind: "new",
    zh: "Luna 导览上线：在真实地图上跑的电影级看房导览。",
    en: "Luna Tours launched — cinematic property tours that run on the real map.",
  },
  {
    date: "2026-05-18",
    kind: "new",
    zh: "地图测距工具：从一个中心点放射测量到多个地点的距离。",
    en: "Added a measuring tool — pick a centre point and measure out to several places at once.",
  },
  {
    date: "2026-05-17",
    kind: "improve",
    zh: "默认改用卫星底图并记住你的选择；搜索支持区域、开发商、项目自动补全。",
    en: "Satellite is now the default basemap and we remember your choice. Search autocompletes across areas, developers and projects.",
  },
  {
    date: "2026-05-16",
    kind: "new",
    zh: "成交记录加入年份筛选，可以查历史成交，不再只能看最近两个月。",
    en: "Transaction records gained a year filter — you can look back through history instead of just the last two months.",
  },
  {
    date: "2026-05-15",
    kind: "new",
    zh: "成交真相分析上线：基于迪拜土地局（DLD）真实成交数据的区域行情。",
    en: "Launched market analysis built on real Dubai Land Department transaction records.",
  },
  {
    date: "2026-02-02",
    kind: "new",
    zh: "户型对比面板：多个户型并排比较。",
    en: "Added a comparison panel to put several unit types side by side.",
  },
  {
    date: "2026-02-01",
    kind: "new",
    zh: "账号登录与收藏功能上线。",
    en: "Accounts and favourites went live.",
  },
  {
    date: "2026-01-13",
    kind: "new",
    zh: "Pinzos 上线：迪拜期房的交互式地图。",
    en: "Pinzos launched — an interactive map of Dubai off-plan property.",
  },
]
