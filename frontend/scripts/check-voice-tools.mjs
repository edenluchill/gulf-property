// Static consistency guard for Luna's voice tools — runs in ~1s, no secrets.
//
// Luna's tools live in THREE places that drift apart (see memory
// voice-tool-declaration-drift). When the system prompt tells Gemini to use a tool
// that the frontend never DECLARED, Gemini can't call it → Luna narrates the action
// but nothing happens ("光说不做"). This catches that before it ships.
//
//   node frontend/scripts/check-voice-tools.mjs
//
// Exit 1 on any hard error so it can gate CI / pre-deploy.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const FE = read('frontend/src/contexts/VoiceAssistantContext.tsx')
const PROMPT = read('backend/src/routes/voice-token.ts')
const BE = read('backend/src/services/voice-assistant-tools.ts')

// Tools handled entirely on the frontend (intercepted in executeTool before the
// backend call) — they legitimately have no backend executor case.
const FRONTEND_ONLY = new Set(['capture_contact'])

const names = (re, src) => {
  const out = new Set()
  let m
  while ((m = re.exec(src))) out.add(m[1])
  return out
}

// Frontend = tools DECLARED to Gemini (only these are callable by the model).
const declared = names(/name:\s*'([a-z_]+)'/g, FE)
// Backend = tools with an executor (case 'x':). This is the universe of real tools.
const executors = names(/case\s*'([a-z_]+)'/g, BE)

// Prompt-referenced = any real tool name that appears as a word in the system prompt.
const referenced = new Set(
  [...executors, ...declared].filter((t) => new RegExp(`\\b${t}\\b`).test(PROMPT))
)

const errors = []
const warns = []

// HARD: prompt pushes a tool the frontend never declared → Luna will narrate, not act.
for (const t of referenced) {
  if (!declared.has(t)) {
    errors.push(`Prompt references "${t}" but frontend voiceTools does NOT declare it → Gemini can't call it (Luna will "光说不做").`)
  }
}
// HARD: frontend declares a tool with no backend executor → the tool call will fail.
for (const t of declared) {
  if (!executors.has(t) && !FRONTEND_ONLY.has(t)) {
    errors.push(`Frontend declares "${t}" but backend has NO executor (case '${t}') → tool call will fail.`)
  }
}
// SOFT: a real tool exists but the prompt never tells Gemini when to use it.
for (const t of executors) {
  if (declared.has(t) && !referenced.has(t)) {
    warns.push(`Tool "${t}" is declared + executable but the prompt never mentions it (model may underuse it).`)
  }
}

console.log(`declared(frontend)=${declared.size}  executors(backend)=${executors.size}  referenced(prompt)=${referenced.size}`)
if (warns.length) { console.log('\n⚠️  WARNINGS:'); warns.forEach((w) => console.log('  - ' + w)) }
if (errors.length) {
  console.log('\n❌ ERRORS:'); errors.forEach((e) => console.log('  - ' + e))
  console.log(`\nFAILED: ${errors.length} tool-consistency error(s).`)
  process.exit(1)
}
console.log('\n✅ PASS: every prompt-referenced tool is declared, every declared tool is executable.')
