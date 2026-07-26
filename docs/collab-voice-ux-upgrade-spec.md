# 实时带看语音 UX 升级(Task B)

**日期**：2026-07-26
**状态**：需求已明确,待实现。owner 反馈四点。

## owner 要的
1. **买家找不到怎么加入语音** → 加入的入口要大、要本能就能点(现在是底部一颗小「接听」pill,漏)。
2. **买家想主动说话却只能等经纪开** → 买家能自己发起语音,不用干等经纪先开。
3. **显示谁在说话(像 Discord)** → 正在说话的参与者头像高亮(声浪圈)。
4. **行为提示音/效果** → 有人进来叮一声、加入/离开通话有音效等。

## 现状(代码事实)
- 语音引擎 `frontend/src/luna-tour/collab/useCollabVoice.ts` + UI `CollabBar.tsx`。
- 只有 **presenter** 调 `/voice-rtc/start` 建 session;**viewer** 调 `/viewer-token`,
  房里没在通话就 409(no_session)→ 所以买家现在**没法主动发起**,只能等经纪开。
- 计费:session 记在**经纪**名下(`voice_sessions.agent_email`),按 user-分钟结算积分。
- 已有 `client.remoteUsers` 精确人数口径,但**没开** Agora 音量指示 → 不知道谁在说话。

## 实现清单
### ① 买家可主动发起语音(核心)
- 后端:让 viewer 也能「start-or-join」。房没在通话时,由 viewer 触发**建 session**,
  但**账记在房主经纪头上**(从 collab 房 → 经纪 email 反查;room = lt_demo_sessions /
  collab_rooms,presenter 身份已知)。复用 startVoiceSession,agentEmail 取房主而非调用者。
  → 新端点 `/voice-rtc/join`(start-or-join):有活动场返回 viewer-token;没有则按房主
     经纪额度建场再返回。额度/积分闸不变(经纪没额度 → 402,前端提示「经纪额度不足」但
     **对买家措辞要体面**,别甩锅买家)。
- 前端:viewer 的 `connect()` 不再依赖 presenter 先开;点大按钮即 start-or-join。

### ② 加入入口做大做直觉
- viewer 进带看、还没在通话时:一个**大而醒目的常驻 CTA**「🔊 点这里和经纪通话」
  (不是藏在底栏的小 pill)。经纪已开语音时更强调(脉冲/来电感)。
- 一旦加入,收起 CTA,底栏只留静音/挂断(别再 nag)。

### ③ 谁在说话(Discord 式)
- `client.enableAudioVolumeIndicator()` + 监听 `volume-indicator` 事件 → 得到每个
  远端 uid 的音量。把说话中的参与者**头像加声浪高亮**(CollabBar 的 participant dots)。
- uid ↔ 参与者映射:Agora uid 与 collab connId 要能对上(join 时把 connId 带进 uid 或
  维护一张映射;最简是让说话高亮只按「有没有人在说 + 谁」,先做经纪/买家二元也行)。

### ④ 提示音/效果
- 有人进房 / 加入通话 / 离开:短音效(内置 base64 wav,别拉外链,墙内加载)。
- 克制:经纪讲话时别叮个不停;进出各一声即可。iOS 需用户手势后才能播(首次交互解锁)。

## 为什么单开一轮做
要真机两端测(经纪一端 + 买家一端):说话高亮、start-or-join、音效、iOS 解锁都得
双人对拨才验得了,无头脚本测不出。建完必须两台设备实拨一遍。

## 关联
- 30min 到点自动挂断(「重进」一大来源)已在 voiceRtc 无限时长那次移除。
- 见 [[collab-video-and-call-billing]] 计费口径;[[voice-agora-cost-guards]] 成本闸。
