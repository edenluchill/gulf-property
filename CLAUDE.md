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
# Deploy main API
$env:GITHUB_TOKEN = "your_token"
.\hetzner-deploy.ps1

# Deploy worker (separate server)
.\hetzner-deploy-worker.ps1
```

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

**最新模型版本 (截至 2026年2月):**

| 用途 | 模型ID | 说明 |
|------|--------|------|
| 通用 | `gemini-3.1-pro` | 最新最强，复杂推理 |
| 快速 | `gemini-3-flash` | 高性能，性价比高 |
| Live API (语音对话) | `gemini-2.5-flash-native-audio-preview-12-2025` | 实时语音对话，支持 VAD |
| Live API (新版) | `gemini-live-2.5-flash-native-audio` | 最新稳定版 (2026年3月后) |

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
