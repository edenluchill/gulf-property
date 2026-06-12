# 后端部署提速方案 — 2026-06-12

## 现状实测(本次部署全程计时)

| 阶段 | 耗时 | 说明 |
|------|------|------|
| API:`hetzner-deploy.ps1` 全程 | **3.6 min** | 见下面拆解 |
| ├ 前置检查 + hcloud 基建 reconcile | ~40s | SSH key/network/firewall/server/LB 每次都查一遍 |
| ├ docker build(本地) | ~80s | 缓存命中良好,主要是容器内 tsc 全量编译 |
| ├ docker push | ~30s | 24 层里 21 层命中缓存,只推 3 层(dist 等小层) |
| └ ssh 部署 + LB 健康检查等待 | ~60s | |
| worker:本地 build + push | **~2.5 min** | 大部分层 "Mounted from pinzos-backend" 共享 |
| worker:服务器 pull + recreate | ~40s | 含 GHCR 登录(token 会过期) |
| **合计** | **~7 min** | 全程占用本地机器,且是两套手动流程 |

**比时间更大的问题:** worker 部署是纯手动且(此前)无脚本无文档——生产 worker 跑了 **3 个月的旧代码**没人发现(今天 2026-06-12 才更新)。期间 backend/src/langgraph 的所有修复都没真正上线。流程慢的真实代价不是 7 分钟,是"懒得部署/忘了部署"。

### 顺便修掉的问题(2026-06-12)
- worker 入口已从废弃的顶层 `worker/` 包(stale langgraph 拷贝)移植到 `backend/src/worker/`,`Dockerfile.worker` 现在从 backend 单一代码源构建 ✅
- CLAUDE.md 中不存在的 `hetzner-deploy-worker.ps1` 已更正为真实流程 ✅
- 坑:PowerShell 5.1 管道给 ssh 传 token 会加 UTF-8 BOM 导致 GHCR 登录 denied,必须用 Git Bash `printf '%s'` 传

## 提速方案(按优先级)

### 1. GitHub Actions CI/CD(治本,强烈推荐)
push 到 main → GitHub runner 上**并行**构建两个镜像(`pinzos-backend` + `pinzos-worker`,registry layer cache)→ push GHCR → ssh 两台服务器 pull + restart。

- 体感部署成本:**git push,本地零占用**(现在 ~7 分钟盯着终端 → 0)
- API 和 worker **永远同步部署**,杜绝"worker 跑 3 个月旧代码"
- 不再依赖本地 Docker Desktop 和家庭上行带宽
- 需要:`.github/workflows/deploy.yml`、GitHub Secrets 放 Hetzner SSH 私钥 + GHCR 用 GITHUB_TOKEN(actions 自带)
- 预计无人值守 wall time 3-5 min;工作量约半天

### 2. 镜像瘦身(938MB → 预计 ~550MB)
`Dockerfile.production`/`Dockerfile.worker` 的 production stage 直接 `COPY --from=builder node_modules` —— **带着全部 devDependencies**(typescript、ts-node 等)进了生产镜像。
改法:production stage 单独 `npm ci --omit=dev`(canvas 等原生模块仍在 builder 编译后拷贝,或用相同 alpine 依赖重装)。
收益:冷启动 pull 快一半、GHCR 存储/流量减半;node_modules 层变化时的 push 也快。

### 3. deploy 脚本加 `-Quick` 开关
跳过 hcloud 基建 reconcile(key/network/firewall/LB 检查 ~40s),日常部署只做 build + push + ssh restart。基建变更时才跑全量。省 ~40s/次,工作量 10 分钟。

### 4. (可选)Watchtower 自动拉取
两台服务器跑 watchtower 监听 GHCR,push 即自动更新——可以省掉 CI 里的 ssh 步骤,但失去部署时机控制和失败反馈,有 CI 的 ssh 步骤后意义不大。

### 5. (可选)容器内 tsc → esbuild
build 阶段从 ~60s 降到几秒。但 build 不是大头,优先级最低。

## 建议执行顺序

**1(CI/CD)→ 2(瘦身)**,3 可顺手做。1+2 完成后:部署 = git push,约 3 分钟无人值守,两个服务永远同步。
