/**
 * 往产品日记加一条 —— 中文写一句，四种译文让 AI 补，直接插进 changelog.ts。
 *
 * 🔴 **为什么不从 git commit 自动生成**(这个问题被问过,答案要留在这):
 * commit 是写给自己看的 —— 里面有收入数字、用户邮箱、「唯一付费客户扣款失败」
 * 这类东西,还有一堆客户根本不关心的实现细节。自动同步一次就会把它们公开出去,
 * 而且**收不回来**(页面会被爬、被缓存)。所以「哪些改动该告诉客户」永远是人来判。
 *
 * 这个脚本消灭的是**另一个**摩擦:一条日记要写五种语言。手写五遍这件事,
 * 忙起来的第一反应就是「下次再补」,然后就没有下次了 —— 日记页一停更就死了。
 * 现在:中文写一句，剩下四种它来。
 *
 *   cd backend
 *   npx ts-node -T scripts/diary-add.ts --kind fix "测距的数字挪到线段中间了"
 *   npx ts-node -T scripts/diary-add.ts --kind new --agent "带看新增语音通话入口"
 *   npx ts-node -T scripts/diary-add.ts --kind improve --date 2026-07-20 "..."  # 补旧的
 *
 *   --kind      new | improve | fix          (必填)
 *   --agent     标成经纪专属 —— **买家看不到这条**
 *   --date      默认今天
 *   --dry       只打印,不写文件
 *
 * ⚠️ `--agent` 的判据只有一条:**一个纯买家账号能不能碰到这个改动?** 碰不到才加。
 *    带看/报价单/楼书解析/CRM = 经纪专属;地图/成交数据/收藏/账号 = 所有人。
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { callGemini } from '../src/services/ai/gemini'

const FILE = path.resolve(__dirname, '../../frontend/src/data/changelog.ts')
const KINDS = ['new', 'improve', 'fix'] as const

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? (process.argv[i + 1] ?? null) : null
}
const has = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const kind = arg('kind') || ''
  if (!(KINDS as readonly string[]).includes(kind)) {
    console.error(`--kind 必须是 ${KINDS.join(' | ')}`)
    process.exit(1)
  }
  const zh = process.argv.filter((a, i) =>
    i >= 2 && !a.startsWith('--') && process.argv[i - 1] !== '--kind' && process.argv[i - 1] !== '--date'
  ).join(' ').trim()
  if (zh.length < 6) {
    console.error('把中文那句写上(用引号包起来)。')
    process.exit(1)
  }
  // ⚠️ 本地日期,不能用 toISOString() —— 晚上写的日记会被 UTC 记成明天,
  //    页面上就出现一条「未来」的更新。
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = arg('date') || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const audience = has('agent') ? 'agent' : null

  /**
   * ⚠️ 结构化输出**每个字段都要 required**。字段 optional 时模型可以合法地「不填」,
   * 于是某个语言会**静默消失** —— 而缺一种语言这页对那批客户就是坏的,还不报错。
   */
  const schema = {
    type: 'object',
    properties: {
      en: { type: 'string' }, fr: { type: 'string' },
      ru: { type: 'string' }, ar: { type: 'string' },
    },
    required: ['en', 'fr', 'ru', 'ar'],
  }

  const r = await callGemini<{ text: string }>({
    task: 'changelog-translate',
    contents: [{
      role: 'user',
      parts: [{
        text: [
          '把下面这条产品更新日记译成英语、法语、俄语、阿拉伯语。',
          '受众是迪拜期房的买家和地产经纪，语气平实、只陈述事实，不要营销腔、不要感叹号。',
          '保留产品名(Pinzos / Luna)和数字不译。译文长度和中文相当，别扩写。',
          '',
          `中文原文：${zh}`,
        ].join('\n'),
      }],
    }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      // 抽取/翻译类任务不需要 thinking —— 默认档是**按 output 价计费**的
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  })

  const tr = JSON.parse(r.text) as Record<'en' | 'fr' | 'ru' | 'ar', string>
  for (const k of ['en', 'fr', 'ru', 'ar'] as const) {
    if (!tr[k]?.trim()) { console.error(`模型没给 ${k},没写文件。`); process.exit(1) }
  }

  // 单引号的中文/俄语文本里可能有 ' —— 统一用双引号包，并转义内部双引号
  const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const entry = [
    '  {',
    `    date: '${date}',`,
    `    kind: '${kind}',`,
    ...(audience ? [`    audience: '${audience}',`] : []),
    `    zh: ${q(zh)},`,
    `    en: ${q(tr.en)},`,
    `    fr: ${q(tr.fr)},`,
    `    ru: ${q(tr.ru)},`,
    `    ar: ${q(tr.ar)},`,
    '  },',
  ].join('\n')

  console.log(`\n${entry}\n`)
  console.log(`(${r.model} · ${r.ms}ms · $${r.usd.toFixed(5)})`)

  if (has('dry')) { console.log('\n--dry:没写文件。'); return }

  const src = readFileSync(FILE, 'utf8')
  /**
   * ⚠️ **换行符不能写死。** 原来锚点是 `'...= [\n'`,而 changelog.ts 在 Windows 上
   * 被 git 换成了 CRLF → `indexOf` 找不到,脚本翻译烧完钱才报「文件结构变了?」。
   * 现在用正则匹配行尾,并**沿用文件自己的换行符**写回去(免得插进去一行 LF、
   * 其余 CRLF,diff 整片泛红)。
   */
  const m = /export const CHANGELOG: ChangeEntry\[\] = \[\r?\n/.exec(src)
  if (!m) { console.error('没找到 CHANGELOG 数组开头,文件结构变了?'); process.exit(1) }
  const eol = m[0].endsWith('\r\n') ? '\r\n' : '\n'
  const cut = m.index + m[0].length
  const block = entry.split('\n').join(eol)
  writeFileSync(FILE, src.slice(0, cut) + block + eol + src.slice(cut), 'utf8')
  console.log(`✅ 已插到 changelog.ts 开头。跑一下 frontend/scripts/_shot-diary-audience.mjs 对个账。`)
}

main().catch((e) => { console.error(e); process.exit(1) })
