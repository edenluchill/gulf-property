/**
 * i18n 裸键巡检 —— 代码里引用的每个 t() key,在 5 语言里是不是都真的解析得出字符串?
 *
 * 【为什么需要它】
 * i18next 找不到译文时**不报错**,原样把 `editor.saveFailed` 这串 key 吐到界面上。
 * tsc 也拦不住(动态拼的 key 全都 cast 成 string 了)。于是「翻译漏一个键」这种事
 * 只有等真人打开那个页面、在那个语言下、走到那个分支,才看得见 —— 基本等于看不见。
 *
 * 【它查什么】
 *   1. 静态 `t('key')` / `t('ns:key')` / `errText(d,'ns:key')` → 5 语言逐一解析
 *   2. 解析不出、或解析出的不是字符串(撞了组名)→ 报错
 *
 * 【它查不到什么 —— 别以为绿了就万事大吉】
 *   运行时拼的键(`t(\`editor.kind.${k}\`)`)正则抓不到。这类必须在下面 DYNAMIC 里
 *   手工枚举 —— 加了动态键就来这儿补一条,不然它就是个盲区。
 *
 * ⚠️ **两类东西不是裸键,规则必须放过**(第一版没放过 → 报了 115 处全是假阳性;
 *    整齐的 100% 失败 = 规则错了,不是数据错了):
 *    1. **复数键**:传了 `{count}` 时 i18next 查的是 `key_one`/`key_other`
 *       (阿语还有 `_zero/_two/_few/_many`),JSON 里**根本不会有裸的 `key`**。
 *    2. **带默认值**:`t('key', 'Some default')` 或 `t('key', { defaultValue: 'x' })`,
 *       键缺了也会渲染那句英文。**不是裸键,但 ar/ru/fr 会看到英文** —— 属于降级,
 *       归轨道 A 的尾巴,不归这个工具管。
 *    3. **注释里的示例**:`// 走 t('compare:yieldVsArea.KEY')` 是文档不是调用。
 *       必须先剥注释再扫,否则报的是自己文档里的占位符。
 *
 * 用法: node scripts/i18n-key-check.mjs        (有裸键则 exit 1)
 */
import fs from 'fs'
import path from 'path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
const SRC = path.join(HERE, '..', 'src')
const R = path.join(SRC, 'i18n', 'locales')
const LANGS = ['en', 'zh-CN', 'ar', 'ru', 'fr']

const cache = new Map()
const load = (l, ns) => {
  const k = `${l}/${ns}`
  if (!cache.has(k)) {
    const f = path.join(R, l, `${ns}.json`)
    cache.set(k, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null)
  }
  return cache.get(k)
}
const get = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o)
const nsExists = (ns) => load('en', ns) !== null

// i18next 复数后缀。传 {count} 时它查的是 key_one / key_other,裸 key 不存在是正常的。
const PLURAL = ['zero', 'one', 'two', 'few', 'many', 'other']
/** 这个 key 在这份 JSON 里解析得出字符串吗?(裸键 或 任一复数形态) */
const resolves = (bundle, p) => {
  if (typeof get(bundle, p) === 'string') return true
  return PLURAL.some((s) => typeof get(bundle, `${p}_${s}`) === 'string')
}

/** 运行时拼出来的键 —— 正则看不见,手工枚举。加动态键请来这里补。 */
const CATS = ['metro_station', 'school', 'mall', 'hospital', 'supermarket']
const TIERS = ['excellent', 'good', 'fair', 'remote']
const DYNAMIC = [
  ['lunaTour', 'editor.kind', ['intro', 'arrival', 'life', 'numbers', 'outro', 'beat']],
  ['lunaTour', 'editor.camera', ['orbit', 'push', 'aerial']],
  ['lunaTour', 'gen.stage', ['confirmProjects', 'fetchRealData', 'aiWritesScript']],
  // luna-tour/amenityLabel.ts —— helper 自己没有 useTranslation(t 由调用方传),
  // 且键是拼的 → 正则双重看不见。两个消费方的 ns/前缀不同,各列一份。
  ['factSheet', 'amenityCat', CATS],
  ['factSheet', 'amenityTier', TIERS],
  ['factSheet', '', ['amenityCatNamed']],
  ['lunaTour', 'tourOverlay.amenityCat', CATS],
  ['lunaTour', 'tourOverlay.amenityTier', TIERS],
  ['lunaTour', 'tourOverlay', ['amenityCatNamed']],
]

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'i18n' ? [] : walk(p)
    return /\.tsx?$/.test(e.name) ? [p] : []
  })
}

const findings = []
const seen = new Set()

function check(ns, keyPath, where) {
  const id = `${ns}:${keyPath}`
  if (seen.has(id)) return
  seen.add(id)
  if (!nsExists(ns)) return // ns 推断不出来就跳过,别造假阳性
  for (const l of LANGS) {
    if (!resolves(load(l, ns), keyPath)) findings.push(`${where}: ${l} 解析不出 ${id}`)
  }
}

/** 剥掉注释(保留换行以免行号漂移)—— 注释里的 t('...') 是文档,不是调用。 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')

for (const file of walk(SRC)) {
  const raw = fs.readFileSync(file, 'utf8')
  const src = stripComments(raw)
  // 该文件的默认 ns:useTranslation('x') —— 拿不到就只查带 `ns:` 前缀的键
  const defNs = (src.match(/useTranslation\(\s*['"`]([\w]+)['"`]/) || [])[1] || null
  const rel = path.relative(SRC, file).replace(/\\/g, '/')
  // 尾部两个可选组 = 看 key 后面跟的是不是默认值:
  //   (2) `, 'Some default'`      → 字符串形式的 defaultValue
  //   (3) `, { defaultValue: …`   → 选项对象形式
  const re = /(?:\bt\(|errText\([^,]+,\s*)['"`]([a-zA-Z][\w.]*(?::[\w.]+)?)['"`]\s*(?:(,\s*['"`])|(,\s*\{\s*defaultValue))?/g
  for (const m of src.matchAll(re)) {
    if (m[2] || m[3]) continue // 有默认值 → 缺键也不会把 key 露给用户
    const k = m[1]
    if (k.includes(':')) check(k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1), rel)
    else if (defNs) check(defNs, k, rel)
  }
}
for (const [ns, base, subs] of DYNAMIC) for (const s of subs) check(ns, base ? `${base}.${s}` : s, 'DYNAMIC')

if (findings.length) {
  console.log(`\n🔴 ${findings.length} 处裸键(界面上会直接显示 key 本身):\n`)
  for (const f of findings) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log(`✅ ${seen.size} 个引用键 × ${LANGS.length} 语言全部解析命中`)
