/**
 * 给 dubai_areas 补 阿语 / 俄语 / 法语 区域名。
 *
 * WHY:地图区域名代码本就支持 i18n(area.translations[lang].name,缺失回退英文),
 * 但数据里 231 个区只有 zh 填了,ar/ru/fr 全空 → 阿语界面地图整片显示英文。
 * 这脚本用 Gemini 批量翻译并写回 translations JSONB(jsonb_set,只动目标语言,
 * 不碰已有 zh)。
 *
 * 用法:
 *   npx ts-node -T scripts/translate-area-names.ts            # 只补缺的(ar/ru/fr 任一为空)
 *   npx ts-node -T scripts/translate-area-names.ts --langs ar # 只补阿语
 *   npx ts-node -T scripts/translate-area-names.ts --force    # 全部重译(覆盖已有)
 *   npx ts-node -T scripts/translate-area-names.ts --dry      # 只打印不写库
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { resolve } from 'path'
import { callGemini } from '../src/services/ai/gemini'

config({ path: resolve(__dirname, '../.env') })

type Lang = 'ar' | 'ru' | 'fr'
const ALL_LANGS: Lang[] = ['ar', 'ru', 'fr']

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const FORCE = argv.includes('--force')
const langsArg = argv.includes('--langs') ? argv[argv.indexOf('--langs') + 1] : ''
const LANGS: Lang[] = langsArg
  ? (langsArg.split(',').filter((l): l is Lang => (ALL_LANGS as string[]).includes(l)))
  : ALL_LANGS

const LANG_NAME: Record<Lang, string> = {
  ar: 'Arabic (العربية)',
  ru: 'Russian (Русский)',
  fr: 'French (Français)',
}

function stripFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

interface AreaRow {
  id: string
  name: string
  zh: string | null
  have: Record<Lang, boolean>
}

async function translateBatch(
  batch: AreaRow[]
): Promise<Record<number, Record<Lang, string | null>>> {
  const list = batch
    .map((a, i) => `${i}. "${a.name}"${a.zh ? ` (中文: ${a.zh})` : ''}`)
    .join('\n')

  const langLines = LANGS.map((l) => `  "${l}": "${LANG_NAME[l]} name"`).join(',\n')

  const prompt = `你是迪拜房地产本地化专家。下面是迪拜的区域 / 楼盘名称(英文,部分带中文参考)。
把每一个翻译成:${LANGS.map((l) => LANG_NAME[l]).join('、')}。

规则:
- 阿拉伯语:优先用迪拜官方 / DLD 常用的阿语地名(这些都是真实存在的迪拜区域,如
  Business Bay = الخليج التجاري、Downtown Dubai = وسط مدينة دبي)。楼盘 / 开发商名
  若无官方阿语名,按标准音译。
- 俄语 / 法语:地名用当地通行译名,没有约定俗成的就音译。人名 / 品牌名(如 Emaar、
  Damac、Sobha)保留品牌惯用写法。
- 每个名字都必须给出全部目标语言,不能省略;实在无法翻译才填 null。
- 只输出 JSON 数组,不要任何解释。

输出格式(数组长度必须 = ${batch.length},i 与输入编号一一对应):
[
  {
    "i": 0,
${langLines}
  }
]

需要翻译的名称:
${list}`

  const { text } = await callGemini({
    task: 'area-name-i18n',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      thinkingLevel: 'minimal',
    },
  })

  const parsed = JSON.parse(stripFence(text)) as Array<
    { i: number } & Partial<Record<Lang, string | null>>
  >
  const out: Record<number, Record<Lang, string | null>> = {}
  for (const row of parsed) {
    if (typeof row.i !== 'number') continue
    const rec = {} as Record<Lang, string | null>
    for (const l of LANGS) {
      const v = row[l]
      rec[l] = typeof v === 'string' && v.trim() ? v.trim() : null
    }
    out[row.i] = rec
  }
  return out
}

async function run() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  })
  await client.connect()

  const { rows } = await client.query(`
    SELECT id, name,
           translations->'zh'->>'name' AS zh,
           translations ? 'ar' AS has_ar,
           translations ? 'ru' AS has_ru,
           translations ? 'fr' AS has_fr
    FROM dubai_areas
    WHERE name IS NOT NULL AND name <> ''
    ORDER BY name
  `)

  const all: AreaRow[] = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    zh: r.zh,
    have: { ar: r.has_ar, ru: r.has_ru, fr: r.has_fr },
  }))

  // 需要处理的:force=全部;否则任一目标语言缺失
  const todo = all.filter((a) => FORCE || LANGS.some((l) => !a.have[l]))
  console.log(
    `共 ${all.length} 个区域,需处理 ${todo.length} 个(langs=${LANGS.join(',')}${FORCE ? ', force' : ''}${DRY ? ', dry' : ''})`
  )
  if (!todo.length) {
    await client.end()
    return
  }

  const BATCH = 40
  let updated = 0
  for (let start = 0; start < todo.length; start += BATCH) {
    const batch = todo.slice(start, start + BATCH)
    process.stdout.write(`  批次 ${start / BATCH + 1}(${batch.length} 个)... `)
    let map: Record<number, Record<Lang, string | null>>
    try {
      map = await translateBatch(batch)
    } catch (e) {
      console.log('翻译失败,跳过:', e instanceof Error ? e.message : e)
      continue
    }

    for (let i = 0; i < batch.length; i++) {
      const area = batch[i]
      const rec = map[i]
      if (!rec) continue
      // 只写:该语言缺失(或 force)且这次拿到了非空译名
      const toSet: Array<[Lang, string]> = []
      for (const l of LANGS) {
        if ((FORCE || !area.have[l]) && rec[l]) toSet.push([l, rec[l]!])
      }
      if (!toSet.length) continue

      if (DRY) {
        console.log(
          `\n    [dry] ${area.name} → ${toSet.map(([l, v]) => `${l}:${v}`).join('  ')}`
        )
        updated++
        continue
      }

      // 逐语言 jsonb_set —— 注意:目标语言键是全新的(顶层不存在),jsonb_set 只能
      // 创建**一层**缺失键,若写 '{ar,name}' 会因 ar 这一层也缺失而**静默不改**。
      // 所以整块设 '{ar}' = {"name": v}(只缺 ar 一层),保留已有 en/zh。
      let sql = `UPDATE dubai_areas SET translations = `
      let expr = `COALESCE(translations, '{}'::jsonb)`
      const params: any[] = []
      let p = 1
      for (const [l, v] of toSet) {
        expr = `jsonb_set(${expr}, '{${l}}', jsonb_build_object('name', $${p}::text), true)`
        params.push(v)
        p++
      }
      sql += `${expr} WHERE id = $${p}`
      params.push(area.id)
      await client.query(sql, params)
      updated++
    }
    console.log(DRY ? 'done(dry)' : 'written')
  }

  console.log(`\n✅ 完成,${DRY ? '预览' : '更新'} ${updated} 个区域`)
  await client.end()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
