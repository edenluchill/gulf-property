# 实时带看(co-presence)体验修复方案 — 2026-06-29

经纪朋友实测反馈的 4 个问题。根因都已定位,基建比预期好(鼠标 `cur` 后端早已转发)。
分两批上线。

## 现状架构(关键事实)
- 前端 `frontend/src/luna-tour/collab/`:`CollabClient`(WS+重连退避)、`useCollab`(集成)、
  `useCollabPresenter`(镜头采样)、`useCollabFollow`(viewer 跟随)、`protocol.ts`(线协议)。
- 后端 `backend/src/services/collab-rooms.ts`(**纯内存房间**)、`routes/collab.ts`(WS + REST 建房)。
- 模式由 `MapPage` 从 URL 推导:`/t/:code`=viewer、`?host=code`=presenter、其余=browse。
- 房间纯内存:**部署/重启清空**,空房 10min TTL 回收 → code 失效。

## 四个问题 → 根因 → 方案

### ① 经纪不知道要分享链接(点完只回地图)
根因:只有左下角不起眼的分享条,无引导。
方案:开始带看后弹醒目引导卡(`CollabPresenterGuide`):复制 / WhatsApp 发送 + 「等待客户加入…」,
客户一进自动翻成「客户已加入」并 2.4s 后自动消失。**Batch 1 ✅**

### ③ 断线后同链接连不回
根因:房间纯内存(部署/TTL 失效)+ presenter 重连时房间没了后端直接 `room_not_found` 关闭 +
每次开始带看生成新随机 code。
方案:
- 后端 `ensureRoomWithCode`:presenter 用某 code 进房而房间不存在 → **用同一 code 重建**(viewer 仍提示离线)。
- 稳定 code:前端 `deriveHostCode(user.id)` 确定性派生 5 位 code,「开始带看」复用 → 经纪/客户永远同一链接。
  POST /rooms 接受 `code` 复用/复活房间(配额仍按显式 start 收一次)。**Batch 1 ✅**

### ④ 看不到经纪鼠标 / 在干嘛
根因:协议有 `cur`、后端已转发,只差前端两头未实现。
方案:`useCollabCursor` —— presenter 采样指针(归一化、~25Hz、pointerdown 发 `tap`),
viewer 渲染带名字的光标 + tap 涟漪(纯命令式 DOM,零重渲染)。手机经纪用 tap 涟漪。**Batch 1 ✅**

### ② 客户切到别的页就断  —— **Batch 2(待做)**
根因:viewer 完全由路径 `/t/:code` 决定,一离开路径 → mode=browse → socket 断。
方案(下一批):
- 把 viewer/presenter 会话提升为**持久会话**:进入 `/t/:code` 后把 code 存进持久 state + `sessionStorage`,
  离开路径不立即断;reload/误关自动重连(`CollabClient` 已支持 resumeSeq)。
- 常驻吸顶条「🔴 带看中 · 回到带看」,客户怎么逛都能一键回到同步地图。
- 风险点:MapPage 是常驻挂载(persistent-map),会话 state 已能跨导航存活;主要新增是
  sessionStorage 持久化 + 路径解耦。注意别破坏 browse 路径零开销。

## Batch 1 落地文件
- 后端:`collab-rooms.ts`(buildRoom/ensureRoomWithCode/normalizeCode)、`routes/collab.ts`(hello 重连 + POST 接 code)
- 前端:`protocol.ts`(CurMsg.tap)、`collabApi.ts`(deriveHostCode + createCollabRoom(code))、
  `useCollabCursor.ts`(新)、`useCollab.ts`(接线)、`CollabPresenterGuide.tsx`(新)、`MapPage.tsx`(稳定 code + 引导)
- 测试:15 个 collab 单测全过;前后端 type-check 通过。

相关记忆:[[collaborative-tour-intent-engine]]、[[voice-agora-cost-guards]]
