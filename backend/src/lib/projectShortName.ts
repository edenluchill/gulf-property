/**
 * 楼盘名瘦身 —— **把真正的楼盘名从噪音里捞出来**。
 *
 * ## 客户原话（2026-08-13，微信）
 *
 * 「咱们那个查成交的，有些前面有些地名太长的，能给隐藏起来不？」
 * 「地名可以隐藏起来，主要显示楼盘名，我觉得」
 * 「**经纪人大多都是只搜楼名**」
 *
 * 他截的图里搜 "district"，出来两条：
 *   `Mohammed Bin Rashid Al Maktoum City District One Wes…`
 *   `Mohammed Bin Rashid Al Maktoum City, District 11- Opal …`
 * —— 真正的楼盘名（District One West / District 11 Opal Gardens）被挤到省略号外面，
 * 两条看起来一模一样，等于没法选。
 *
 * ## 数据说噪音有两类，不是一类
 *
 * 查了 61 万条带 master_project 的记录：
 *   · **地名前缀**只占 9.3%（57,121 条以 master_project 开头）—— 但正是客户截到的那种
 *   · **开发商后缀**更普遍：`Ashwood Residences by Skyland Horizons Real Estate Development`（62 字符）、
 *     `AL SERH RESIDENCES 11 BY ASAK REAL ESTATE DEVELOPMENT`（53）
 *
 * 只剥地名前缀解决不了大多数长名字，所以两类都剥。
 *
 * ## 原则：宁可少剥，不可剥错
 *
 * 剥过头会把两个不同的楼盘变成同名（`Tower A` / `Tower A`），那比长名字糟得多。
 * 所以：剥完太短就整个放弃、结果重名的风险由调用方保留 `full` 来兜。
 * **完整名永远保留** —— 搜索匹配、去重、跳转都用它，短名只用于显示。
 */

/** 开发商后缀 —— `… by XXX Development(s) / Real Estate / Properties / Homes` */
const DEVELOPER_SUFFIX =
  /[\s,\-–—]+(by|By|BY)\s+[A-Za-z0-9&.' ]{2,60}?\s*(real\s+estate\s+)?(development[s]?|properties|property|homes|group|holding[s]?|llc|l\.l\.c\.?)\s*$/i

/**
 * 纯 `by 某某` 结尾（没有 Development 这类词），如 `Serenz by Danube`。
 *
 * ⚠️ **字符类里绝不能有连字符。** 第一版有，于是
 * `Serenz by Danube - TOWER A` 被整段剥成 `Serenz` —— **TOWER A 是楼栋标识**，
 * 同一项目的 A/B/C 栋会全部塌成同一个名字。那比长名字糟得多
 * （正是本文件开头「宁可少剥」那条的具体形态，靠单测抓到）。
 * 代价是开发商名里带连字符时剥不掉 —— 可接受。
 */
const BY_ONLY_SUFFIX = /[\s,\-–—]+(by|By|BY)\s+[A-Za-z0-9&.' ]{2,40}$/

/** 剥完至少要剩这么多字符，否则说明剥过头了，放弃。 */
const MIN_KEPT = 4


/**
 * 「城中城」前缀 —— 一大片楼盘共用同一个超长开头，前缀本身不提供任何辨识度。
 *
 * ⚠️ **为什么是写死的表，不是通用算法。**
 *
 * 本来想用 `master_project` 自动剥，实测行不通：那一列对这些项目要么是
 * **字符串 `"null"`**，要么拼写对不上（项目名里写
 * `Mohammed Bin Rashid Al Maktoum City,` 而 master 是
 * `Mohammed Bin Rashid AL Maktoum District 11`，少一个词、大小写还不同）。
 *
 * 也想过「被 N 个楼盘共享的长前缀就剥」。跑了 2824 个楼盘名做共享前缀分析：
 *   38 个 · "Mohammed Bin Rashid Al Maktoum City District"   ← 真噪音
 *   14 个 · "Emirates Living Springs"    13 个 · "DAMAC LAGOONS LAGOON VIEWS"
 *   11 个 · "Arabian Ranches lll"         9 个 · "Nad Al Sheba Gardens Phase"
 * 除了第一条，**其余全是品牌名** —— 剥掉 "DAMAC LAGOONS LAGOON VIEWS" 只剩个
 * "1"/"2"，比长名字糟得多。共享数量根本区分不了「噪音」和「品牌」。
 *
 * 所以这里只收真正的城中城。加一条之前先问：**剥完剩下的还认得出是哪个盘吗？**
 */
const CITY_PREFIXES = [
  'Mohammed Bin Rashid Al Maktoum City',
  'Mohammed Bin Rashid Al Maktoum',
]

/**
 * ⚠️ **按词数切会切错。** 第一版是「规范化后比对 → 在原串上跳过 N 个词」，
 * 但库里写的是 `…MAKTOUM CITY-DISTRICT ONE PHASE II VILLAS` ——
 * `CITY-DISTRICT` 中间没有空格算作一个词，跳过它就把 `DISTRICT` 一起吃掉，
 * 结果剩下 `ONE PHASE II VILLAS`（单测抓到）。
 *
 * 改成直接在**原串**上匹配：词与词之间允许任意空白/逗号/连字符。
 */
const SEP = String.raw`[\s,\-–—]+`
const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const CITY_PREFIX_RES = CITY_PREFIXES.map(p =>
  new RegExp('^' + p.split(/\s+/).map(escapeRe).join(SEP) + String.raw`[\s,\-–—:·]*`, 'i')
)

function stripCityPrefix(name: string): string {
  for (const re of CITY_PREFIX_RES) {
    if (!re.test(name)) continue
    const rest = name.replace(re, '').trim()
    if (rest.length >= MIN_KEPT) return rest
  }
  return name
}

function stripPrefix(name: string, master?: string | null): string {
  if (!master) return name
  const m = master.trim()
  // 🔴 库里 master_project 存着**字符串** "null"（不是 SQL NULL）——
  // 实测 MBR City District One West 那条就是。当成合法前缀会去比对 "NULL" 开头。
  if (/^(null|n\/a|-|—)$/i.test(m)) return name
  if (!m || m.length < 4) return name
  if (name.length <= m.length + MIN_KEPT) return name          // 剥完没剩什么
  if (name.slice(0, m.length).toUpperCase() !== m.toUpperCase()) return name
  // 前缀后面通常跟着分隔符（空格 / 逗号 / 连字符），一并吃掉
  const rest = name.slice(m.length).replace(/^[\s,\-–—:·]+/, '').trim()
  return rest.length >= MIN_KEPT ? rest : name
}

function stripSuffix(name: string): string {
  for (const re of [DEVELOPER_SUFFIX, BY_ONLY_SUFFIX]) {
    const cut = name.replace(re, '').trim()
    if (cut.length >= MIN_KEPT && cut !== name) return cut
  }
  return name
}

/**
 * 显示用的短名。**永远不要拿它做匹配或去重** —— 那是 `full` 的活。
 *
 * @param name   DLD 原始 project_name / building_name
 * @param master 该项目的 master_project（有就用来剥前缀）
 */
export function projectShortName(name: string | null | undefined, master?: string | null): string {
  const raw = (name || '').trim()
  if (!raw) return ''
  const short = stripSuffix(stripPrefix(stripCityPrefix(raw), master)).replace(/\s{2,}/g, ' ').trim()
  return short || raw
}

/**
 * 被剥掉的那部分 —— 前端可以拿去当小字副标题，
 * 让人仍然看得出「这是 MBR City 里的」。剥不掉就返回 null。
 */
export function projectNamePrefix(name: string | null | undefined, master?: string | null): string | null {
  const raw = (name || '').trim()
  if (!raw || !master) return null
  const short = projectShortName(raw, master)
  if (short === raw) return null
  return raw.toUpperCase().startsWith(master.trim().toUpperCase()) ? master.trim() : null
}
