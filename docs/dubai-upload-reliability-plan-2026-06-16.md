# 迪拜上传断链:诊断与修复方案

> 日期:2026-06-16
> 问题:迪拜同事上传 PDF 楼书(500MB+)总是断链,无法完成 upload → process。

## 1. 当前上传链路(实测)

```
前端 (DeveloperPropertyUploadPageV2.tsx)
  └─ XMLHttpRequest + FormData,整个文件一次性 POST
     → ${UPLOAD_API_URL}/api/langgraph-progress/start
        └─ nginx (Hetzner, 德国 Nuremberg)
           └─ Express + multer diskStorage → ./uploads/temp-pdfs/
              └─ (USE_WORKER_MODE) 读回 Buffer → uploadPdfForProcessing() → R2
                 └─ 返回 jobId,worker 异步处理
```

关键文件:
- 前端上传:`frontend/src/pages/DeveloperPropertyUploadPageV2.tsx` (handleProcessPdfs, 行 105-167)
- 前端配置:`frontend/src/lib/config.ts` (UPLOAD_API_URL, 行 13)
- 后端路由:`backend/src/routes/langgraph-progress.ts` (multer, 行 54-79)
- 后端 server 超时:`backend/src/index.ts` (keepAlive/headers/timeout = 600s)
- R2 服务:`backend/src/services/r2-storage.ts` (requestTimeout 60s)
- nginx:`backend/nginx.conf`(500M / 300s)、`backend/nginx.production.conf`(1500M / upload-api 600s, api 300s)

## 2. 根因(两个叠加)

### 真凶 1 — 架构:单请求跨洲长连接,无分片/续传/重试(主因)
- 前端用 `XMLHttpRequest + FormData` 把整个 500MB 文件作为单个 multipart 请求体一次性上传。
- 无 chunk、无断点续传、无重试,`xhr.timeout` 也未设置。
- 文件先完整传到德国后端落盘,再由后端中转上传 R2(双倍路径)。
- 迪拜→德国 ~4500km 裸 TCP 长连接需维持数分钟,任一网络抖动 → 整请求失败,从 0 重传。
- `upload-api.pinzos.com` 是 DNS-only(灰云),故意绕过 Cloudflare,因此**没有任何 CDN/边缘加速**。

### 真凶 2 — 配置:上传可能没绕过 Cloudflare,撞 100MB 墙(待确认,易定位)
- `config.ts:13`:`UPLOAD_API_URL = import.meta.env.VITE_UPLOAD_API_URL || API_BASE_URL`
- 若 Cloudflare Pages 构建未设 `VITE_UPLOAD_API_URL`,上传 fallback 到 `api.pinzos.com`(橙云)→ 撞 Cloudflare 免费版 100MB 上传硬墙 → 大文件被截断。

### 次要超时坑
- `api.pinzos.com` 的 nginx `proxy_read_timeout 300s`(仅 5 分钟)。
- R2 client `requestTimeout 60s`(大文件中转可能超时)。
- 前端 XHR 无 timeout,失败无重试。
- Express body limit 500MB < multer 1GB,实际单文件上限 500MB。

## 3. 修复方案(三档递进)

### A. 排查(~10 分钟)
1. 确认 Cloudflare Pages 生产构建是否设置了 `VITE_UPLOAD_API_URL = https://upload-api.pinzos.com`。
2. 让迪拜同事打开浏览器 Network 面板,看上传请求实际发到哪个域名、失败时的 HTTP 状态码:
   - `413` → 撞 body/CF 大小限制
   - `504` / `connection reset` → 超时或连接被掐
   - 走了 `api.pinzos.com` → 真凶 2 坐实

### B. 止血(~半天,治标)
- nginx 上传端点超时 300s → 1200s(`nginx.conf` 与 `nginx.production.conf` 的 api server 段)。
- `r2-storage.ts` requestTimeout 60s → 调大或改用 multipart。
- 前端加 `xhr.timeout = 600000` + `ontimeout` 处理。
- 前端失败自动重试整文件 3 次(指数退避),限制并发文件数。
- 临时:让迪拜同事压缩 PDF、用有线/更稳网络。
- 注意:仍是跨洲单连接,大文件下依然脆弱。若计划做 C,可跳过 B。

### C. 治本(~1-2 天,推荐)——前端直传 R2 + multipart 分片续传
**后端**(新增 3 个轻量 endpoint,基于已有 S3Client):
- `POST /api/upload/r2/create` → `CreateMultipartUpload`,返回 key + uploadId
- `POST /api/upload/r2/sign` → 为每个 partNumber 生成 presigned `UploadPart` URL
- `POST /api/upload/r2/complete` → `CompleteMultipartUpload`,然后用已知 R2 key 创建 job(复用现有 task 创建逻辑)

**前端**(重写 handleProcessPdfs 上传段):
- 把文件切成 5–10MB 片,逐片 `PUT` 到 R2 presigned URL。
- 并发 3–4 片,失败的片单独重传(指数退避)。
- 进度 = 已完成片数 / 总片数。
- 全部完成后调用 complete 创建 job,后续 SSE 进度流不变。

**收益**:
- R2 在迪拜有本地 Cloudflare 边缘节点 → 上传就近上边缘,不再连德国(解决真凶 1 的距离 + 真凶 2 的 CF 墙)。
- 断片只重传单片,彻底抗网络抖动。
- 后端不再中转大文件,cpx11 小机器减负。

## 4. 推荐路径
**A + C 一起做**:先 10 分钟排查(可能直接定位真凶 2),再上 C 治本。B 仅作为不做 C 时的临时替代。

## 5. 排查结论(2026-06-16,已验证)
- DNS:`upload-api.pinzos.com` = DNS only(灰云)指向 `91.98.0.248`,配置正确。
- CF Pages 环境变量:`VITE_UPLOAD_API_URL = https://upload-api.pinzos.com` **已配置**。
- → **真凶 2(撞 CF 100MB 墙)排除**。上传确实走 upload-api 直连德国。
- 现场:iPad 在迪拜上传 4 个文件共 ~112MB,报 `Network error during upload`。
- → **坐实真凶 1**:跨洲单请求长连接,网络抖动即整批失败。唯一根治 = 分片直传 R2(方案 C)。

## 6. 实现记录(2026-06-16,方案 C 已落地)

**后端(worker 零改动,复用现有 pending-pdfs 流程):**
- 新增 `backend/src/services/r2-multipart.ts`:R2 multipart presign 封装
  (create / signPart(6h 有效) / complete / abort)。
- 新增 `backend/src/routes/r2-upload.ts`:`/start`(建 job+multipart)、
  `/sign`(presign 各 part)、`/complete`(完成上传 + `taskManager.createTask`,
  与旧 worker 路径同款 pdfUrls)、`/abort`(失败清理)。
- `backend/src/index.ts`:注册 `app.use('/api/r2-upload', r2UploadRouter)`。
- 依赖:`@aws-sdk/s3-request-presigner@3.986.0`(对齐 client-s3 版本)。
- 后端 tsc 通过。

**前端(生产走直传,dev 回退旧路径):**
- 新增 `frontend/src/lib/r2-upload.ts`:`uploadFilesToR2()` —— 8MB 分片、
  4 并发、每片重试 4 次(指数退避)、整体失败 abort,进度回调。
- `frontend/src/lib/config.ts`:新增 `USE_DIRECT_UPLOAD`(生产默认开,
  `VITE_DIRECT_UPLOAD=false` 可强制旧路径)。
- `frontend/src/pages/DeveloperPropertyUploadPageV2.tsx`:上传段改为
  `USE_DIRECT_UPLOAD ? 直传R2 : 旧XHR`,jobId 之后的 SSE 流程不变。
- 前端 tsc 通过。

## 7. 上线前必做(用户侧)
1. **配 R2 bucket CORS**(关键!否则浏览器 PUT 被拦或读不到 ETag):
   ```json
   [
     {
       "AllowedOrigins": ["https://pinzos.com", "https://www.pinzos.com", "http://localhost:5173"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Cloudflare R2 → 选 bucket → Settings → CORS Policy 粘贴。
2. **部署后端**:`cd backend; .\quick-deploy.ps1`(新路由 `/api/r2-upload/*` 才会生效)。
3. **前端**:push 到 main,CF Pages 自动 deploy。
4. 验证:迪拜同事重新上传那 4 个文件,确认分片进度平滑、断网重连后单片重传、最终成功。

## 8. 备选/补充
- 若暂不部署直传,可临时止血:nginx 上传端点超时 300s→1200s、前端加 xhr.timeout。
- 后端 CORS 白名单 `index.ts:47` 写的是 `upload.pinzos.com`(少 `-api`),
  当前不影响(上传 origin 是 pinzos.com),建议顺手修正为 `upload-api.pinzos.com`。
