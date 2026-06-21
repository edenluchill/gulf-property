# 应用内语音(Agora)+ 成本护栏 —— Spec / 接手指南

状态:**代码已上线生产,等填 Agora 凭证即生效**(2026-06-20)
归属:实时协作带看(`docs/luna-collaborative-tour-spec.md` §8.5 第二阶段)的「人声」部分
本轮范围:**只做应用内双向语音 + 成本护栏**。录音→转写→意向报告是下一步(未做)。

---

## 1. 你要做的唯一一步:填凭证

去 https://console.agora.io 建项目,**开启 App Certificate(安全/Secured 模式)**,拿到 App ID + App Certificate,填到 **API 服务器** env(然后重启 / 重新 deploy 后端):

```
AGORA_APP_ID=xxxxxxxx
AGORA_APP_CERTIFICATE=xxxxxxxx        # 机密,只放后端,绝不进前端
# 可选(都有默认):
AGORA_SESSION_MAX_SECONDS=1800        # 单场上限,默认 30min
AGORA_AGENT_DAILY_SECONDS=10800       # 每经纪每日,默认 3h
AGORA_GLOBAL_DAILY_SECONDS=21600      # 全局每日兜底,默认 6h
```

填完 `GET https://api.pinzos.com/api/voice-rtc/health` 应返回 `{"configured":true}`。在 Hetzner:改 `/opt/...` 的 env 或 docker-compose 后 `docker compose up -d`,或走 `backend/hetzner-deploy.ps1`(把 env 加进去)。

**App ID 是否机密?** 否。Agora 浏览器 SDK 加入频道时**必须**用 App ID,它本来就是公开标识(安全靠 token 签名 + TTL,不靠藏 App ID)。本设计里 App ID **也只放后端 env**,客户端在发起通话时从后端响应里现拿(不写进前端 bundle/env);运行时浏览器能看到 App ID 属正常、无害。**App Certificate 永远只在后端**,用来签 token,绝不下发。

---

## 2. 成本护栏(全部服务端硬 enforce)

| 护栏 | 怎么实现 | 在哪 |
|---|---|---|
| 单场 ≤ 30min | token TTL = 授权秒数,过期 Agora 自动断;客户端再跑倒计时到点主动 leave | `voiceRtc.ts` `SESSION_MAX` |
| 每经纪 ≤ 3h/日 | `/start` 前 `SUM(duration_seconds) WHERE agent_email=… AND 当日` ≥ 上限则 429 拒发 | `startVoiceSession` |
| 全局每日兜底 | 同上但不限 email,防伪造身份刷 token | `GLOBAL_DAILY` |
| 用量记录 | `voice_sessions` 一场一行;30s 心跳回填 `duration_seconds`(崩溃也记到最近一次),结束时最终回填 | `heartbeat`/`end` |
| token 滥用面 | `/start` 仅当房间真实存在(经纪建过)才签;`/viewer-token` 仅当该房有进行中的场 | `voice-rtc.ts` |

**授权时长** = `min(30min, 经纪当日剩余, 全局当日剩余)`。token TTL 是最硬的成本天花板。

> ⚠️ 身份说明:API 服务器没配 Supabase 验证,经纪 email 来自客户端(useAuth),理论可伪造。但①经纪是自己人、②全局每日兜底 + ③单场 TTL 限死爆炸半径。要更严可后续给 `/start` 加 DASHBOARD_SECRET 或服务端 Supabase 校验。

---

## 3. 代码地图

**后端**
| 文件 | 作用 |
|---|---|
| `backend/src/db/voice-sessions-schema.sql` | `voice_sessions` 表(用量/额度),已上生产 |
| `backend/src/services/voiceRtc.ts` | token 签发(`agora-token`)+ 额度计算 + start/viewer/heartbeat/end/usage |
| `backend/src/routes/voice-rtc.ts` | REST `/api/voice-rtc/{start,viewer-token,heartbeat,end,usage,health}` |
| `backend/src/index.ts` | 挂 `/api/voice-rtc` |

**前端**
| 文件 | 作用 |
|---|---|
| `frontend/src/luna-tour/collab/useCollabVoice.ts` | 语音 hook:经纪 `connect`(start)、客户 `connect`(join)、`toggleMute`、`leave`、倒计时、心跳。**Agora SDK 动态 import**(1.5MB chunk 按需加载) |
| `frontend/src/luna-tour/collab/CollabBar.tsx` | 🎤 按钮接上 voice:idle→开启 / connecting→转圈 / live→静音切换+剩余时长+挂断 / limit·unavailable·no_session 提示 |
| `frontend/src/pages/MapPage.tsx` | `useCollabVoice({mode,roomCode,agentEmail})` → 传给 CollabBar |

**API 流程**
- 经纪点🎤 → `POST /start{roomCode,agentEmail}` → 校验额度 → 建 session 行 → 返回 `{appId,channel,token,sessionId,allowedSeconds}` → 加入频道+推麦 → 倒计时+心跳。
- 客户点🎤 → `POST /viewer-token{roomCode}` → 仅当有进行中的场 → 返回 `{appId,channel,token,remainingSeconds}` → 加入+推麦。
- 双方同一 channel(=房间分享码)双向通话;字幕/聊天/地图同步走原有 collab WS,不变。

---

## 4. 测试(填完凭证后)

1. `GET /api/voice-rtc/health` → `configured:true`。
2. 经纪开带看 → CollabBar 🎤 点「开启语音」→ 浏览器请求麦克风权限 → 通话中显示剩余 mm:ss + 静音/挂断。
3. 客户(另一设备/微信)进房 → 点🎤 加入 → 双向能听到。
4. 等到 30min(或把 `AGORA_SESSION_MAX_SECONDS` 临时设小,如 60)→ 自动断 + 显示「已达上限」。
5. `cd backend && npx ts-node scripts/db-query.ts "SELECT agent_email,room_code,duration_seconds,allowed_seconds,ended_reason FROM voice_sessions ORDER BY id DESC LIMIT 5"` 看用量记录。
6. 当日累计够 3h 后再开 → 429 / 🎤 显示「已达上限」。

---

## 5. 下一步(未做)
- 通话录音 → R2 → Gemini 转写 → 拼进带看意向报告(spec §8.5);需进房**双方知情同意** UI。
- 经纪 dashboard 显示语音用量(已有 `GET /usage` + `voice_sessions` 表,缺前端展示)。
- 语音开启时经 collab WS 广播,让客户**自动收到「经纪已开启语音,加入?」**提示(现需客户手动点🎤)。
- `/start` 收紧鉴权(DASHBOARD_SECRET / 服务端 Supabase)。
