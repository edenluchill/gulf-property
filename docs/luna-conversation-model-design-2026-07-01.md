# Luna 会话模型重构设计(2026-07-01)

## 背景 / 问题
一段语音对话被切成多条 `luna_sessions` 记录。根因:**三个不同的生命周期被焊死在一起**,尤其"点药丸"这个手势既是「打断 AI」又是「结束对话」,而"结束"会拆掉整个连接+落库。于是**打断 = 结束 → 一段对话被切成多条**。之前加的 8 秒宽限只是事后把它们粘回去(治标、hacky)。

## 心智模型:一通电话
- 接起(open)→ 来回说 + 互相打断(turns)→ 挂断(✕/闲置)。
- **一通电话 = 一条记录。** 打断对方 ≠ 挂断;线路杂音(重连)≠ 挂断;只有"挂断"结束。

## 三个生命周期(边界归属)
1. **Connection(连接)**:到 Gemini Live 的 WebSocket。会掉线/重连/撞模型时长上限。**纯技术,对"对话"透明。**
2. **Turn(轮次)**:一次"用户输入 → Luna 回应"。可被打断(barge-in),只影响当前轮。
3. **Conversation(对话)**:从打开到结束。**记账单位(一条记录)**,有稳定 `conversationId`。

**规则:只有 Conversation 能创建/结束记录。Connection 和 Turn 都在其下,来去不影响记录。**

## 核心:conversationId 与连接解耦(确定性,非概率)
- 打开 Luna(从关闭态)→ 生成 `conversationId`(ref + sessionStorage,survive 刷新/SPA 导航)。
- 所有东西(语音轮/文字轮/工具调用/每次重连事件)append 到该 id(DB 按 conversationId upsert)。
- WebSocket 任意开/关/重连 —— **永不新建、永不结束对话**。
- 对话只在明确信号结束:**✕ / 闲置超时 / pagehide**。
- ⇒ 结构上不存在"中途切断"路径;无需 8 秒猜测,无需事后合并。

## 交互(定稿):保持"点药丸开/关",把「连接」和「记录」拆开(不加新按钮)
**点药丸只管「连接」;「一条记录」= conversationId + 5 分钟闲置。**
- **点药丸(idle)= 接起**:有"活着"的 conversationId(距上次活动 < 5min)→ **接回同一条记录**并重连(resume 上下文);否则新建。connect + listening。
- **点药丸(active)= 关闭连接**(和以前手感一样):`disconnect()` 停麦/停音/关 socket,回 idle。**不收尾记录**——conversationId 继续活着。
- **Luna 说话时说话就打断**(原生 barge-in:`interrupted`→`playerRef.stop()`,连接不断)。不用点。
- **记录收尾(finalize = 落库 + 清 conversationId)只在:5 分钟无活动 / pagehide。**
- 文字:发送 = 一个文字轮,归同一 conversationId;关面板 = 只断连接,记录靠闲置收尾。

**"断连接" ≠ "收尾记录" —— 两条独立生命周期(以前焊死 → 8 秒 hack;现在无竞态、无猜测)。**

## 状态机
```
idle ──接起──▶ connecting ──▶ active
                                 │  active = { listening ⇄ thinking ⇄ speaking }
                                 │  打断:speaking/thinking ──▶ listening(同一对话,不回 idle)
                                 │  掉线:active ──▶ connecting(重连)──▶ active(同一对话)
                                 ▼
                          ✕ / 闲置超时 / pagehide ──▶ idle(endConversation 落库)
```

## 代码结构(要改的)
新增清晰分层的动作(context):
- `openConversation()`:idle→若无活跃 conversationId 则新建 id + `startSession(id)`;connect。
- `interrupt()`:`playerRef.stop()`;`setPhase('listening')`;**不 disconnect、不 endSession**。(可选:给模型发 activityStart)
- `endConversation()`:`disconnect()`(关 socket)+ `endSession()`(落库)+ 清 conversationId + 清闲置定时器。
- 内部 `connect()/disconnect()`:只管 WebSocket(含 onopen/onmessage/onclose + 自动重连,重连复用 conversationId,log `RECONNECTED`)。
- **改点:** 药丸"激活时点击"从 `deactivate()` 改为 `interrupt()`。`endConversation` 只由 ✕ / 闲置超时 / pagehide 触发。
- **删:** `SESSION_GRACE_MS` 8 秒宽限 + deactivate 的延迟 endSession + activate 里的 grace-resume 分支(被 conversationId 取代)。
- **闲置定时器:** 每次轮次(USER_MESSAGE/发送文字/TURN_COMPLETE)重置;到期 `endConversation()`。
- `debugLogger`:记录 id = conversationId(沿用 session_id 列存 conversationId 值,DB/看板零改)。
- 语音 + 文字共用 conversationId(同一通电话里既能说也能打字 → 自然一条)。

## 数据 / 分析影响
- 一条记录 = 一个 conversationId,可含多模态(voice + text)轮次、多次重连。看板([[admin-analytics-luna-readability]] 的摘要/工具参数)照常按这条记录聚合。
- `luna_open`/`luna_close` 语义对齐:`luna_open` = 真·接起(新 conversationId);`luna_close` = 真·挂断(不再每次打断都发)。

## 分期
- **P1(治本,本次)**:conversationId 解耦 + 打断/结束拆分 + ✕ + 闲置超时;删 8 秒 hack。先覆盖语音(主 bug),文字沿用现面板但共用 conversationId。
- **P2(可选)**:语音/文字完全统一为一个"对话表面"(同一通电话里自由切说/打字),模态切换 = 开/关麦。

## 图 Diagrams

### 图 1 · 分层(谁包着谁)
```
╔══ CONVERSATION ══  conversationId = 唯一的一条记录  ═══════════════╗
║  接起 ▶ ....................................................  ◀ 结束 ║
║          只有 ✕ / 闲置超时 / 关页面 能结束它                          ║
║    ╭─── CONNECTION ───╮   掉线   ╭─── CONNECTION ───╮  自动重连      ║
║    │  Gemini WebSocket│┈┈┈┈┈┈┈▶│  resume,同一 id  │              ║
║    │   ╭Turn╮ ╭Turn╮  │          │  ╭Turn╮ ╭Turn╮  │              ║
║    │   ╰──▲─╯ ╰────╯  │          │  ╰────╯ ╰────╯  │              ║
║    │  打断在 Turn 里面 │          │                  │              ║
║    ╰───────────────────╯          ╰──────────────────╯              ║
╚═════════════════════════════════════════════════════════════════════╝
  打断 = Turn 内部 · 重连 = Connection 内部 → 都碰不到 CONVERSATION 记录
```

### 图 2 · 状态机
```
                 ┌─────────┐
        END ────▶│  IDLE   │
     ✕/闲置/关页  └─────────┘
        ▲             │ 点药丸(接起)
        │             ▼
        │       ┌────────────┐
        │       │ CONNECTING │◀── 掉线自动重连 ──┐
        │       └────────────┘                  │
        │             │ 接通                     │
        │             ▼                          │
   ┌────┴──────────────────────────────────┐    │
   │              ACTIVE                    │────┘
   │   listening ⇄ thinking ⇄ speaking      │
   │        ▲                               │
   │        └─ 打断(说话 / 点药丸):speaking→listening (仍在 ACTIVE)
   └────────────────────────────────────────┘
   只有 END 能离开 ACTIVE;打断和重连都留在 ACTIVE 里。
```

### 图 3 · 旧 vs 新
```
 旧(点药丸 = 打断 又 = 挂断)         新(打断 ≠ 挂断)
 接起 Q1 A1·点·Q2 A2·点·Q3·点·Q4      接起 Q1 A1·打断·Q2 A2·重连·Q3 … ✕
     └rec1┘  └rec2┘  └rec3┘ └rec4┘         └──────── 一条记录 ────────┘
              ✗ 4 条                              ✓ 1 条
```

### 图 4 · 手势/事件 → 动作 → 是否动记录
```
 点药丸(idle)        → 开对话          → ✅ 建一条
 Luna 说时你开口       → 打断(barge-in) → ❌
 点药丸(Luna 激活中) → 打断            → ❌
 WebSocket 掉线        → 自动重连        → ❌
 ✕ 按钮               → 结束对话        → ✅ 落库
 30 分钟无活动         → 结束对话        → ✅ 落库
 关标签页             → 立即结束落库    → ✅
```

## 概念为何站得住
1. **单一职责**:对话管记录 / 连接管 socket / 轮次管一问一答,边界不再互相污染。
2. **确定性**:记录绑 `conversationId`(显式身份),不绑会漂移的连接 → "一通电话一条记录"是结构保证,非概率。
3. **直觉**:电话模型秒懂;每个手势只有一个含义。
4. 唯一"软"的是闲置超时(30min)—— 行业标准 sessionization,且只是兜底,主结束靠 ✕,不损确定性。

## 待定(需用户拍板的数值/位置)
- ✕ 位置(建议药丸右上角小按钮,激活时出现)。
- 闲置超时时长(建议 30 分钟)。
