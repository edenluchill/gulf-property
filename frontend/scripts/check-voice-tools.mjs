// Luna 工具接线的静态守卫 —— ~1s，无密钥，可进 CI / pre-deploy。
//
// ## 2026-08-10 重写：不变量变了
//
// 旧版守的是「前端声明 vs 后端执行器 vs 提示词」三方一致。
// 现在**工具声明只有一个源**：后端 `luna-live-manifest.ts` 随 `/api/voice/token`
// 下发，前端不再硬编码。所以要守的东西换了：
//
//   1. 前端**不得**再出现硬编码的工具声明数组（那是漂移回归）
//   2. manifest 必须从 `voiceAssistantTools` 派生 —— 手写子集会让能力静默消失
//   3. Live 能看到的工具 ⊆ 有执行器的工具 + 前端直连的工具
//   4. 两段式必须两端成对（半边接线 = Luna 说完就永远沉默）
//
// 背景（为什么 Live 必须看到完整清单）见 `luna-live-manifest.ts` 顶部：
// **工具的 description 就是模型的能力清单**，砍成一个抽象入口它就不查了。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const FE = read('frontend/src/contexts/VoiceAssistantContext.tsx')
const PROMPT = read('backend/src/routes/voice-token.ts')
const BE = read('backend/src/services/voice-assistant-tools.ts')
const MANIFEST = read('backend/src/services/luna-live-manifest.ts')
const BRAIN = read('backend/src/services/luna-brain.ts')
const TOOLS_ROUTE = read('backend/src/routes/voice-tools.ts')

const names = (re, src) => {
  const out = new Set()
  let m
  while ((m = re.exec(src))) out.add(m[1])
  return out
}

const executors = names(/case\s*'([a-z_]+)'/g, BE)
const errors = []
const warns = []

// ── 1. 前端不得硬编码工具声明 ───────────────────────────────────────────
// 指纹：`functionDeclarations` 数组 + 一串 `name: 'xxx'`。
// 只抓**硬编码数组字面量** `functionDeclarations: [{ name: …`。
// `functionDeclarations: liveToolsRef.current` 是正确用法，不能误报。
if (/functionDeclarations\s*:\s*\[\s*\{/.test(FE)) {
  errors.push(
    'VoiceAssistantContext.tsx 里又出现了 `functionDeclarations` —— 工具声明必须只来自后端 manifest。' +
    '前端硬编码一份就是三处漂移的老毛病复发（memory voice-tool-declaration-drift）。'
  )
}

// ── 2. manifest 必须从执行器派生，不能手写子集 ──────────────────────────
if (!/voiceAssistantTools\[0\]\?\.functionDeclarations/.test(MANIFEST)) {
  errors.push(
    'luna-live-manifest.ts 不再从 `voiceAssistantTools` 派生声明 —— ' +
    '手写子集会让一部分能力对 Live 静默消失，而它正是靠 description 才知道自己能干什么。'
  )
}

// ── 3. 前端必须真的用后端下发的 tools ───────────────────────────────────
if (!/tokenData\.tools/.test(FE)) {
  errors.push('前端没有读 `tokenData.tools` —— Live 会拿不到任何工具声明，然后凭空作答。')
}
if (!/tools:\s*liveToolsRef\.current\.length/.test(FE)) {
  errors.push('前端 live.connect 没有使用 `liveToolsRef` —— 后端下发的清单没接上。')
}
if (!/tools:\s*liveToolManifest\(\)/.test(PROMPT)) {
  errors.push('/api/voice/token 没有下发 `tools` —— 前端拿不到工具清单。')
}

// ── 4. 所有工具调用必须过 Brain ─────────────────────────────────────────
// 前端直连 `/tools/execute` 会绕开全部护栏（数据边界/诚实规则/澄清出路）。
// 只抓真实的 fetch 调用，注释里提到它不算。
if (/fetch\([^)]*voice\/tools\/execute/.test(FE)) {
  errors.push(
    '前端又在直连 `/api/voice/tools/execute` —— 那条路绕开 Brain 的全部护栏。' +
    '所有工具调用都必须走 /tools/ask，由 Brain 决定真正调什么。'
  )
}

// ── 5. 两段式必须成对 ───────────────────────────────────────────────────
// 生产事故：start=8 / resume=4，一半的对话说完过渡句就永远沉默。
const twoStageOn = /process\.env\.LUNA_TWO_STAGE === '1'/.test(TOOLS_ROUTE)
if (!twoStageOn && /pending:\s*true/.test(TOOLS_ROUTE) && !/LUNA_TWO_STAGE/.test(TOOLS_ROUTE)) {
  errors.push('两段式无条件返回 pending，但它在真机上会把客户挂断 —— 必须由 LUNA_TWO_STAGE 控制。')
}
if (twoStageOn && !/ask_luna_more/.test(MANIFEST)) {
  warns.push('LUNA_TWO_STAGE 开关存在但 manifest 里没有 ask_luna_more —— 开启它之前必须先把这个工具加进 manifest。')
}
if (!/['"`]\/ask-more['"`]/.test(TOOLS_ROUTE)) {
  warns.push('后端没有 /ask-more 路由；两段式当前不可用（默认关闭，正常）。')
}

// ── 6. 提示词点名的工具必须真实存在 ─────────────────────────────────────
const referencedInPrompt = [...executors].filter(t => new RegExp(`\\\`${t}\\\``).test(PROMPT))
for (const t of referencedInPrompt) {
  if (!executors.has(t)) errors.push(`提示词点名 "${t}" 但没有执行器。`)
}

console.log(
  `executors(backend)=${executors.size}  ` +
  `manifest=从执行器派生  frontend硬编码=${/functionDeclarations\s*:\s*\[\s*\{/.test(FE) ? '有 ❌' : '无 ✅'}  ` +
  `两段式=${twoStageOn ? '开关控制' : '未接'}`
)
if (warns.length) { console.log('\n⚠️  WARNINGS:'); warns.forEach(w => console.log('  - ' + w)) }
if (errors.length) {
  console.log('\n❌ ERRORS:'); errors.forEach(e => console.log('  - ' + e))
  console.log(`\nFAILED: ${errors.length} tool-consistency error(s).`)
  process.exit(1)
}
console.log('\n✅ PASS: 工具声明单一真相源，所有调用都过 Brain。')
