/**
 * Luna 测试场景 —— **单一真相源**。
 *
 * CLI 跑分（`scripts/luna-eval-live.ts`）和 admin 自测
 * （`services/luna-self-test.ts` → `/api/admin/luna/test`）用的是**同一份**。
 *
 * 这条很重要：两份场景 = admin 上绿了、命令行红了，然后谁都不信跑分。
 * 本次重构的主线就是消灭这类「同一件事记在两处」。
 *
 * 每条都来自真实生产事故，`why` 写的是当时发生了什么。
 */

export interface Scenario {
  id: string
  tag: 'lang' | 'area' | 'number' | 'deadend' | 'scope' | 'human' | 'product'
  /** 依次注入的用户话术 */
  turns: string[]
  /** 期望说的语言（确定性检查） */
  wantLang?: 'en' | 'zh'
  /** 回复里绝不能出现的字符串（区域名张冠李戴） */
  forbidMentions?: string[]
  /** 必须体现「拿不准/没有」的态度，而不是自信地给一个 */
  mustHedge?: boolean
  /** 回复里**必须**出现其中至少一个（用来验产品指路答对了没有） */
  mustMentionAny?: string[]
  /** 这一轮**允许**不调工具（纯寒暄/身份试探/乱码）。默认都必须调。 */
  noToolOk?: boolean
  why: string
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'en-stays-en', tag: 'lang', wantLang: 'en',
    turns: ['Hi Luna, where are Emaar projects?', 'Tell me more about the first one.'],
    why: '真实事故：用户全程英文，Luna 第二轮突然中文（工具 summary 里的中文祈使句所致）',
  },
  {
    id: 'en-walkthrough-stays-en', tag: 'lang', wantLang: 'en',
    turns: ['Take me through Dubai Marina, I want to show it to my client.'],
    why: '真实事故：present_place 的中文 summary "请用口语顺着把这三站讲出来" 把模型带偏',
  },
  {
    id: 'zh-stays-zh', tag: 'lang', wantLang: 'zh',
    turns: ['你好，帮我看看国际城的房子怎么样？'],
    why: '反向对照：中文用户必须得到中文，别矫枉过正全说英文',
  },
  {
    id: 'harbor-typo', tag: 'area',
    turns: ['I want to show projects in Dubai Harbor to my client. Can you take me there?'],
    // ⚠️ 第一版把 'Creek Harbour' 也列进禁词 → 误判。
    // Luna 当时的回答是「搜到的多是 Dubai Creek Harbour，不是 Dubai Harbour」——
    // 这恰恰是**我们想要的诚实行为**，却被判成了错配。
    // 禁词只该列「张冠李戴地当成答案讲」的区，不该列「主动指出差异」时提到的区。
    forbidMentions: ['Design District', 'D3'],
    why: '真实事故：美式拼写 Harbor → 工具返回 D3 Dubai Design District，Luna 照着介绍了 D3',
  },
  {
    id: 'jvc-parens', tag: 'area',
    turns: ['Show me Jumeirah Village Circle (JVC).'],
    forbidMentions: ['Jebel Ali'],
    why: '真实事故：工具返回 Jebel Ali Village，Luna 全程在讲另一个区',
  },
  {
    id: 'ambiguous-village', tag: 'area', mustHedge: true,
    turns: ['Take me to the village area.'],
    forbidMentions: [],
    why: '工具现在会回 AREA_AMBIGUOUS —— Luna 必须回头问，不许自己挑一个',
  },
  {
    id: 'nonexistent-area', tag: 'area', mustHedge: true,
    turns: ['Show me properties in Manhattan.'],
    why: '工具回 AREA_NOT_FOUND —— 必须老实说没有，绝不能拿另一个区顶替',
  },
  {
    id: 'roi-sane', tag: 'number', wantLang: 'zh',
    turns: ['帮我分析一下商业湾一居室的投资回报，五年能赚多少？'],
    why: '真实事故：对 270 万的 1 居室播报「5 年增值 4818 万，年化 79.9%」',
  },
  {
    id: 'budget-around', tag: 'number', wantLang: 'zh',
    turns: ['帮我查一下100万左右的房产，有哪些选择？'],
    why: '真实事故：模型填 min==max 退化成精确匹配，只剩 1-3 个盘',
  },
  {
    id: 'no-result-pivot', tag: 'deadend',
    turns: ['Do you have anything from Al Ghadeer Gardens developer under 500 thousand dirhams?'],
    mustHedge: true,
    why: '真实事故：0 结果 → Luna 说 "no projects found" → 对话当场死掉',
  },
  {
    id: 'out-of-scope', tag: 'scope',
    turns: ['How can I do live calling with this?'],
    why: '真实事故：Luna 硬邦邦一句 "I can\'t help with live calling"，客户直接走了',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 人类真实说话的样子 —— 不是干净的检索式提问
  //
  // 前面 11 条测的是「功能对不对」，这一组测的是**「像不像个人在跟她说话」**。
  // 真实日志里客户从来不说 "Show me projects in Dubai Marina under 2M"，
  // 他们说的是「哎? 他這個有收出來。問他,我說100萬左右」。
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'asr-garbled-zh', tag: 'human', wantLang: 'zh',
    turns: ['科學權有哪些項目?'],
    why: '真实日志原句：ASR 把「科学城」听成「科學權」。她当时靠猜蒙对了，但这属于运气',
  },
  {
    id: 'asr-offplan-confusion', tag: 'human', wantLang: 'zh',
    turns: ['我现在想找一套100万的二手房', '嗯,我要的是線房哦,你現在給我說的是七房吧。'],
    why: '真实日志原句：「線房」=现房、「七房」=期房。她当时答「抱歉…没找到现房」直接把天聊死',
  },
  {
    id: 'rambling-multi-intent', tag: 'human', wantLang: 'zh',
    turns: ['我想在迪拜马丽娜找个两室的，预算200万左右，另外那边学校怎么样，还有能不能把资料发给我老婆看一下'],
    why: '一句话三个意图（找房+配套+分享）。人就是这么说话的，不会一次只问一件事',
  },
  {
    id: 'is-this-a-bot', tag: 'human', noToolOk: true,
    turns: ['Are you a real person or a bot?'],
    why: '几乎每个新用户都会试探一次。答得僵硬就再也不聊了',
  },
  {
    id: 'price-pushback', tag: 'human', wantLang: 'zh',
    turns: ['迪拜房子是不是太贵了？现在买是不是接盘啊'],
    why: '带情绪的质疑。这时候堆数据是最差的答法，但也不能顺着说「是的很贵」',
  },
  {
    id: 'vague-browsing', tag: 'human', noToolOk: true, wantLang: 'zh',
    turns: ['随便看看'],
    why: '最常见的开场。她必须能把话头接住并收敛到一个具体问题，不能反问一串',
  },
  {
    id: 'gibberish', tag: 'human', noToolOk: true, mustHedge: true,
    turns: ['asdfgh qwerty'],
    why: 'ASR 噪音/误触。不该假装听懂，也不该报错，要自然地请对方再说一次',
  },
  {
    id: 'adjacent-scope-visa', tag: 'human', wantLang: 'zh',
    turns: ['买房能拿迪拜身份吗？'],
    why: '擦边但强相关（黄金签证是买房核心动机）。一刀切拒绝=丢客户；乱答=法律风险。要能承认边界又给方向',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 产品指路 —— Luna 得知道自己身处什么产品里
  //
  // 她的 16 个工具全是买家侧找房/数据分析，对产品自身一无所知，于是犯两种错：
  //   · 把**存在**的功能拒绝掉（"How can I do live calling?" → "I can't help"）
  //   · 发明**不存在**的能力（「我可以把资料发给您」—— 她发不了任何东西）
  // 后者更糟：客户会一直等一个永远不会来的东西。
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'product-live-call', tag: 'product',
    turns: ['How can I do live calling with this?'],
    mustMentionAny: ['live tour', 'workbench', 'agent'],
    why: '生产事故原句。实时带看真实存在（房间免费不限场次），她当时答「帮不了」，客户再没回来',
  },
  {
    id: 'product-share-to-client', tag: 'product', wantLang: 'zh',
    turns: ['我想把这个项目的资料发给我老婆看一下，能发吗？'],
    why: '生产事故变体：她曾答「我可以通过文本或截图发给您」—— 凭空发明能力。正确做法是教对方用可分享链接',
  },
  {
    id: 'product-quote', tag: 'product', wantLang: 'zh',
    turns: ['能给客户出个正式的付款计划报价单吗？在哪弄？'],
    mustMentionAny: ['付款计划', 'sales offer', '报价'],
    why: '报价单是经纪最高频的产出物，入口藏在项目详情页的 tab 里，不指路根本找不到',
  },
  {
    id: 'product-no-such-feature', tag: 'product', mustHedge: true,
    turns: ['Can you automatically post my listings to Instagram every morning?'],
    why: '产品**没有**这个功能。必须老实说没有，绝不能为了讨好客户编一个出来',
  },
]
