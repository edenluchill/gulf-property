# POST /api/luna/agent/avatar 返回 500 —— 根因与修复

日期：2026-07-18
触发：admin/analytics 性能告警「POST /avatar 返回 500（1 次，受影响：1723545835@qq.com）」

## 实际影响

告警说「1 次」，实际是 **同一个经纪连试 3 次全失败然后放弃**：

| 时间(2026-07-17) | 用户 | 状态 | 耗时 |
|---|---|---|---|
| 12:46:24 | 1723545835@qq.com | 500 | 98ms |
| 12:47:09 | 1723545835@qq.com | 500 | 104ms |
| 12:48:41 | 1723545835@qq.com | 500 | 34ms |

同期其他经纪全部 200（耗时 ~1200ms，那是 R2 上传时间）。所以不是服务故障，是**这个用户的这张图**。

## 根因

`backend/src/luna-tour/agent-router.ts` 的上传口：

```ts
router.post('/avatar', multer({ ..., limits: { fileSize: 5 * 1024 * 1024 } }).single('file'),
  async (req, res) => { try { ... } catch { res.status(500) } })
```

两处叠加：

1. **上限 5MB 太小** —— 手机原图（iPhone/安卓 12MP+）轻松超过。
2. **multer 的 LIMIT_FILE_SIZE 是中间件层错误，不进 handler 的 try/catch** —— 直接冒泡到
   `src/index.ts:197` 的全局兜底，返回 `500 {"error":"Internal server error"}`。

用户侧看到的是「上传失败」，没有任何提示说「图太大」，于是重试三次、换不了小图、放弃。

耗时只有几十毫秒的原因：nginx 默认 `proxy_request_buffering on`，先把整个 body 缓冲完再一次性喂给 node，
node 侧计时从那一刻才开始——所以「很快失败」不代表没收到大文件。

### 复现（修复前，生产）

```
$ curl -X POST https://api.pinzos.com/api/luna/agent/avatar -F "file=@6mb.png;type=image/png"
status=500  {"success":false,"error":"Internal server error"}
```

## 修复

后端 `agent-router.ts`：

- 上限 5MB → **25MB**
- 显式接管 multer 错误 → `413 avatar_too_large`「图片超过 25MB，换一张小一点的」
- 收到图后一律 **sharp 压成 512×512 webp**（`.rotate()` 吃掉 EXIF 方向，否则手机竖拍头像会躺着）
- 解码失败 → `400 avatar_unsupported_format`「这张图打不开（iPhone 的 HEIC 常见），存成 JPG/PNG 再传」
- **R2 key 带内容指纹** `agent-photos/{agentId}-{sha1:10}.webp`
  —— 顺带修掉一个潜在 bug：R2 写的是 `max-age=31536000, immutable`，原来 key 固定，
  换头像后 CDN 会长期回旧图。

前端 `AgentCardEditor.tsx`：`accept` 与 mime 校验从 `jpeg|png|webp` 放宽到 `image/*`
（格式判断交给服务端，HEIC 至少能被选中并拿到人话提示）。

## 验证（打生产，部署后）

| 场景 | 结果 |
|---|---|
| 30MB 文件 | 413 `avatar_too_large` |
| 6MB 非图片字节 | 400 `avatar_unsupported_format` |
| text/plain | 400 `avatar_not_image` |
| **9.6MB 真 JPEG（修复前必 500）** | **200，1.76s，webp 落 R2** |

匿名调用落到 demo 经纪，测试期间它的 `photo_url` 被改写，**测完已还原**为 `https://i.pravatar.cc/200?img=12`。

## 待办

- 前端那一行改动要 `git push` 才随 CF Pages 上线（后端已上线，主因已解除）。
- 可以回访 1723545835@qq.com：他的头像至今没传上去。

## 可复用的教训

**Express 中间件（multer/body-parser 等）抛的错不会进 handler 的 try/catch**，一律落到全局兜底 →
用户看到裸 500。凡是挂中间件的路由，都要用 `mw(req, res, err => {...})` form 自己接错误，
把它翻译成人话 + 稳定 code。
