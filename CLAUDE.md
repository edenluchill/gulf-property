# Claude Code Guidelines for Gulf Property

## Database Access

**Never directly expose database credentials in commands.** Always use the provided DB tools:

```bash
# Run a SQL file
cd backend && npx ts-node scripts/db-runner.ts src/db/your-file.sql

# Run a single query
cd backend && npx ts-node scripts/db-query.ts "SELECT * FROM table LIMIT 10"
```

These scripts automatically read credentials from `backend/.env`.

## Project Structure

- `backend/` - Express.js API server
- `frontend/` - React + Vite frontend
- `backend/src/db/` - SQL schema and migration files
- `backend/scripts/` - Utility scripts (db-runner, db-query, etc.)

## Luna Tour — 改完必须跑的端到端跑分

```bash
cd backend && npx ts-node -T scripts/tour-e2e.ts          # 打生产,不扣额度
cd backend && npx ts-node -T scripts/tour-e2e.ts --keep   # 留着人眼看
```

走真实 HTTP 接口跑完整条链路（生成草稿 → 客户 404 → 大纲时间线 → 改文案 →
确认渲染 → 客户 200 → 语音），并做 **24 条内容体检**（念原始数字 / 阿拉伯语地名 /
推销售罄的房 / 户型缺席 / 镜头超 2 秒 / 泄露检索半径 / 低分项目主动报分 …）。

**不带 Authorization → 落到 demo 经纪 → 不扣任何额度**，可以随便跑。

⚠️ **先 `quick-deploy.ps1`，再跑分** —— 它打的是生产 API，不部署就是在测旧镜像。
⚠️ 视觉验证另有 `frontend/scripts/_tour-audit.mjs`（手机+桌面逐帧录制）。

## Common Tasks

### Update a database function
```bash
cd backend && npx ts-node scripts/db-runner.ts src/db/update-area-metrics-function.sql
```

### Check table structure
```bash
cd backend && npx ts-node scripts/db-query.ts "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'table_name'"
```

### Verify data
```bash
cd backend && npx ts-node scripts/db-query.ts "SELECT * FROM table LIMIT 5"
```

## Deployment Architecture

**Two-server architecture for performance:**

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│   Main API (cpx11 - €4/mo)  │     │   Worker (cpx32 - €15/mo)   │
│   Pinzos-backend-1          │     │   Pinzos-worker-1           │
│                             │     │                             │
│  • All API endpoints        │     │  • Polls DB for pending jobs│
│  • Upload PDFs → R2         │────▶│  • Downloads PDFs from R2   │
│  • Create task in DB        │     │  • Heavy PDF processing     │
│  • SSE progress (polls DB)  │◀────│  • AI analysis              │
│                             │     │  • Updates progress in DB   │
└─────────────────────────────┘     └─────────────────────────────┘
```

**Servers on Hetzner Cloud:**
- API Server: `Pinzos-backend-1` (cpx11 - 2 vCPU, 2GB RAM) - lightweight
- Worker Server: `Pinzos-worker-1` (cpx32 - 4 vCPU, 8GB RAM) - PDF processing
- Load Balancer: `Pinzos-lb`
- Location: Nuremberg, Germany (nbg1)

**Two API domains with different SSL handling:**
- `api.pinzos.com` - Proxied through Cloudflare (orange cloud)
- `upload-api.pinzos.com` - DNS-only (gray cloud), direct connection

**IMPORTANT: Why upload-api bypasses Cloudflare:**
- Cloudflare free plan has a 100MB upload limit
- The app needs to support 500MB+ PDF uploads for developer brochures
- `upload-api.pinzos.com` connects directly to bypass this limit
- Requires Let's Encrypt SSL certificate (auto-configured via Cloudflare DNS challenge)

**Deploy scripts:**
```powershell
# ⭐ Daily driver — deploys BOTH API and worker in one command (~2-3 min):
cd backend; .\quick-deploy.ps1          # or -SkipWorker / -SkipApi

# Full infra deploy (only when servers/LB/firewall need creating/reconciling):
$env:GITHUB_TOKEN = "your_token"   # usually already in user env
cd backend; .\hetzner-deploy.ps1

# Deploy worker — NO separate script. Worker runs image ghcr.io/edenluchill/pinzos-worker
# built from backend/Dockerfile.worker (entry: backend/src/worker/index.ts → dist/worker/index.js):
cd backend
docker build -f Dockerfile.worker -t ghcr.io/edenluchill/pinzos-worker:latest .
docker push ghcr.io/edenluchill/pinzos-worker:latest
# then on the worker server (compose file at /opt/pinzos-worker/docker-compose.yml):
#   ssh root@<worker-ip> "cd /opt/pinzos-worker && docker compose pull && docker compose up -d"
# NOTE: GHCR login on the server may expire; pipe the token via Git Bash (NOT PowerShell —
# PS 5.1 piping adds a UTF-8 BOM that corrupts the token):
#   printf '%s' "$GITHUB_TOKEN" | ssh root@<worker-ip> "docker login ghcr.io -u edenluchill --password-stdin"
```

ℹ️ The worker builds from `backend/src` (entry `backend/src/worker/index.ts`). The old top-level `worker/` directory (a stale langgraph copy, unused since 2026-06-12) was removed on 2026-06-28.

**Environment variables for worker mode:**
- `USE_WORKER_MODE=true` - API uploads to R2, worker processes
- `CLOUDFLARE_API_TOKEN` - For automatic SSL certificate generation

**SSH Access:**
```bash
# Main API
ssh -i ~/.ssh/Pinzos_ed25519 root@<api-server-ip>

# Worker
ssh -i ~/.ssh/Pinzos_ed25519 root@<worker-server-ip>
docker logs pinzos-worker -f  # Watch worker logs
```

## PDF Processing Debug

**Job output files are located in:**
```
backend/uploads/langgraph-output/job_{jobId}/
├── analysis-report-job_{jobId}.json   # Detailed extraction results
├── analysis-summary-job_{jobId}.txt   # Quick summary
└── job-log-job_{jobId}.log            # Full processing logs
```

To debug a failed extraction:
1. Find the job ID from the upload page or server logs
2. Check the analysis report JSON for extracted data
3. Search the log file for errors: `grep -i "error\|warning\|skip" job-log-*.log`

## Gemini API (Updated Feb 2026)

**官方文档:**
- Models: https://ai.google.dev/gemini-api/docs/models
- Live API: https://ai.google.dev/gemini-api/docs/live
- Live API Guide: https://ai.google.dev/gemini-api/docs/live-guide
- SDK: https://www.npmjs.com/package/@google/genai

**官方 SDK (推荐):**
```bash
npm install @google/genai
```

**模型 ID (2026-07-12 核对官方文档 + `ai.models.list()` 实测)**

> ⚠️ 这张表原来是错的(写着 `gemini-3-flash` / `gemini-3.1-pro`,**两个都 404**),
> 全站 6 个文件跟着写 → **每次调用先撞 404 再 fallback,整个项目的 AI 一直跑在 2.5 上**。已修。

| 用途 | 模型ID | 价格 (in/out per 1M) |
|------|--------|------|
| **默认(生成/创作/抽取)** | **`gemini-3.5-flash`** | $1.50 / $9.00 — GA 旗舰 Flash (2026-05-19) |
| 极省钱的轻活 / fallback | `gemini-3.1-flash-lite` | $0.25 / $1.50 — GA |
| 复杂推理 | `gemini-3.1-pro-preview` | $2.00 / $12.00 — 无免费额度 |
| Live API (语音对话) | `gemini-2.5-flash-native-audio-preview-12-2025` | 实时语音,支持 VAD |

❌ **别写**:`gemini-3-flash`·`gemini-3.1-flash`·`gemini-3.1-pro`(**404,不存在**)
❌ `gemini-3-flash-preview`(已废弃)·`gemini-3-pro-preview`(2026-03-09 已关停)
❌ `gemini-2.5-*` 全系(deprecated,最早 2026-10-16 关停)·`*-latest` 别名(会被静默热切换)

**两个必踩的坑(实测):**
1. **Gemini 3.x 用 `thinkingConfig.thinkingLevel`**(`minimal|low|medium|high`),
   **不是 `thinkingBudget`**(那是 2.5 的)。写错会被**静默忽略**。
   thinking **默认开着且按 output 价计费** —— 抽取类任务设 `minimal`(实测 thinking token 归 0,
   默认档要烧 1440 个)。
2. **结构化输出必须把字段全标 `required` + 允许 `null`**。字段 optional 时模型可以合法地
   「不填」→ **明说了的信息也会静默消失**(实测:optional schema 下「单身/自住/预算120万」
   只回了个名字,还编了个付款方式)。required 之后它填不出来就必须交 null,藏不住。

详见 `docs/reports/2026-07-12-gemini-model-lineup.md`

**Live API 使用 SDK 示例:**
```typescript
import { GoogleGenAI, Modality } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const session = await ai.live.connect({
  model: 'gemini-2.5-flash-preview-native-audio-dialog',
  config: {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } }
    }
  },
  callbacks: {
    onopen: () => console.log('Connected'),
    onmessage: (msg) => handleMessage(msg),
    onerror: (e) => console.error(e),
    onclose: () => console.log('Closed')
  }
})

// 发送音频
session.sendRealtimeInput({
  audio: { data: base64AudioData, mimeType: 'audio/pcm;rate=16000' }
})
```

**重要提醒:**
- ❌ 不要使用 `gemini-2.0-*` 模型，已废弃
- ✅ 使用官方 `@google/genai` SDK，不要手动处理 WebSocket
- ✅ SDK 自动处理 VAD、打断、音频格式转换

**音频格式:**
- 输入: 16-bit PCM, 16kHz, mono (`audio/pcm;rate=16000`)
- 输出: 24kHz

**可用语音:**
- Aoede, Puck, Charon, Kore, Fenrir
