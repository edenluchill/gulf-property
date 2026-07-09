# 客户体验巡检与修复报告 — 2026-07-07

巡检范围:最近 3 天 app_events 错误事件、perf_alerts 报警、api_calls 慢端点。
结论:发现 4 个真实客户面向的问题,全部修复并于当日部署上生产(commit `d5ceb5b`)。
**不需要增加服务器** —— 报警和慢的根源是缺缓存与报警口径问题,不是容量不足。

---

## 巡检发现

### 1. 地图整页白屏崩溃(最严重)🔴
- **现象**:`render_crash` "No cluster with the specified id.",3 天 20 次,至少 5 个真实访客,`/` 和 `/map` 均有,崩溃从 07-05 开始(正是「两项目重叠拆双 pin」上线当天)。
- **根因**:`MapViewMapLibre.tsx` 双 pin 拆分路径在渲染期调 `superclusterIndex.getLeaves(cluster_id)`。`clusterFeatures` 是 state(moveEnd 才刷新),而 `superclusterIndex` 是 useMemo(projects 一变同帧重建)——旧 cluster_id 查新索引,supercluster 直接 throw,ErrorBoundary 兜住 = 整页崩。已用 supercluster 本地复现实锤。
- **修复**:`getLeaves` / `getClusterExpansionZoom` 加 try/catch;stale 帧回退渲染普通气泡,下一帧 recompute 自愈;点击气泡兜底「放大两级」。

### 2. 项目详情页 insights 接口极慢 🔴
- **现象**:`/api/residential-projects/:id/insights` 24h 内 106 次真实调用,**avg 7.8s / p95 15s / max 22.7s**。这是 HIGH_LATENCY 报警(7 天 130 次,均值 9.4s)的主源,每个打开详情页的客户都在等。
- **根因**:`getProjectInsights` 完全没缓存,每次重跑 `resolve_project_development`(实测 1.3s)+ `get_development_metrics`(实测 **7.1s**,DLD 全表聚合)。同文件的 `getProjectTransactions` 反而有 1h 缓存。
- **修复**:
  - `getProjectInsights` 套 microCache(TTL 7h,单飞+stale-on-error);
  - 全项目预热(仅 21 个项目):启动 45s 后一轮,之后每 6h,`prime()` 原子换入 —— 预热期间旧缓存继续服务,没人等冷加载;
  - `getProjectTransactions` TTL 1h→7h,同轮预热;
  - 项目编辑(PUT /:id)后 `invalidateProjectInsights` 立即失效,审核人不看旧数据。
  - **实测:冷 8.4s → 热 5ms**(HTTP 端到端)。

### 3. SLOW_QUERIES 报警刷屏(报警失去意义)🟡
- **现象**:7 天 354 次 SLOW_QUERIES 报警,爆发时 100-185 条/3min 且 `req=0`。
- **根因**:是 `warmAreaInsights`(market.ts,每 5h 预热 210 个区域)自己的预热风暴,不是客户流量。设计上正确的维护行为把报警信道整个淹了,真事故根本看不见。
- **修复**:perfSink 加 `beginMaintenance()/endMaintenance()` 窗口,预热期间慢查询不计入报警计数(query_count 照常);区域预热和新的项目预热都已包上。另加 `PERF_FLUSHER_DISABLED=1`,本地起服连生产库时不再覆写线上 perf_minute。

### 4. 配额耗尽后非地图页静默空白(丢高意向客户)🟡
- **现象**:今天一位匿名访客(先后逛了 `/login`、`/choose-role`、`/agent/join` —— 明显想注册)额度用尽后打开成交页,4 个接口全 429,页面空白无任何解释。
- **根因**:mapMeter 服务端拦的是整个数据面(`/api/market`、`/api/residential-projects`、`/api/dubai*`),但配额引导 UI(MapMeterGuard)只挂在地图页;其它页面的 fetcher 安全回退成空数据。
- **修复**:新组件 `GlobalQuotaGate` 挂 Layout,全局监听 fetch 拦截器广播的 `MAP_QUOTA_EVENT`:地图路径不管(MapMeterGuard 自己处理),`requiresPlan` 跳 `/agent/plans`,匿名显示与地图同款的登录引导卡(登录免费不限时)。已截图验证。

### 其它观察(未动)
- 07-07 上午 localhost 的 `/pp` hooks 崩溃 + `basePrice is not defined` 都是开发期自测,对应修复已在 `0829d50` 上线,生产无此错。
- `/api/favorites/merge` avg 471ms × 101 次 —— 不影响体验(登录后台操作),观察。
- `auth_signed_out` 3 天 11 次,继续按 [session-logout-investigation] 攒数据。

## 验证记录(上生产前)
- backend / frontend `tsc --noEmit` 全过;`vite build` 过。
- supercluster 复现脚本证实旧 id 查新索引 throw 的正是生产那条报错。
- 本地起后端(禁 perf 写入)+ vite:insights 冷 8.4s→热 5ms;地图截图 pin/双 pin/气泡渲染正常无 pageerror;成交页人工触发配额事件,登录卡正确弹出。

## 容量结论(用户问「是否要加服务器」)
**暂不需要。** 本轮慢与报警的根源是"该缓存的没缓存 + 报警口径把维护流量当事故",修完后:
- 详情页 insights 从 7.8s 降到 ms 级,DB 每 6h 只跑 21×~8.5s 的预热;
- HIGH_LATENCY / SLOW_QUERIES 两类报警的既知来源都已消除,以后再红就是真事故。

真正的容量债(已知、不紧急):单 Node 进程无 cluster、22 个超大区 area-insights 待月度预聚合(spec: `docs/area-insights-preaggregation-spec.md`)、突发 1000 人/分钟仍会劣化(见 `docs/reports/2026-06-27-api-load-test.md`)。到推广/放量前再做即可。

## 部署
- 前端:push `d5ceb5b` → Cloudflare Pages 自动部署。
- 后端:`quick-deploy.ps1 -SkipWorker`(本次改动仅 API 进程)。
- 部署后验证:生产 insights 端点热缓存命中、报警静默(见当日会话)。

---

## 第二轮:回归验证 + 监控降噪 + 留痕 + 自动化(同日)

### 回归验证(全绿,无 regression)
- 生产 11 个核心端点全 200(健康/地图数据面/成交/详情/insights),最慢 0.7s(/dubai/areas 含网络);
- 服务器日志:`[project-insights] warmed 21/21`、`[market] area insights warmed: 229/229`,insights 服务端 ~1ms;
- 生产地图截图(SHOT_URL=www.pinzos.com):双 pin 拆分/数字气泡/区域标签全部正常,无 pageerror;
- 部署后 50+ 分钟:**0 api_error、0 新报警、unresolved 报警=0**(恢复后系统自动 resolve,admin 红条已净),全站 p95 698ms。

### 监控降噪(让错误监控只剩新问题)— commit `1b98b5c`,deploy tag `20260707-140854`
- **摄入层**:eventIngest 丢弃 payload 含 localhost 的 api_error(dev 自测流曾占错误列表 1/3,已生产实测:localhost 事件被弃、真实域事件正常入库);
- **分类修正**:errorCapture 不再把 `map_quota_exhausted` 记成 api_error(是计量门正常工作,服务端 mapMeter 有账,UI 由 Guard/Gate 承接);
- **历史清理**:删除 42 条 localhost 噪音 + 53 条 quota 假错误 + 15 条已修复的旧 cluster 崩溃(部署前的)。现在 48h 错误列表只剩 4 条真实网络抖动;**今后再出现 render_crash/同类错误 = 新问题,一眼可见**。

### 留痕
- `agent_runs` 落了一条 status=fixed 的记录(run id 2):4 个修复 + 降噪,每条带根因/commit/deploy_tag/验证证据 → owner 在 dashboard「看护」tab 直接可见。

### 第三轮:报警消音幽灵(同日晚,commit `c25828b`,tag `20260707-150513`)

**现象**:全天每条报警创建后 13~33 秒就被 resolve、下一分钟又插一行新的("10 分钟 9 行"怪象)——报警系统实际处于被消音状态。

**抓鬼过程**:
1. 两个 flusher 的 tick 秒偏移不同(开=:24 生产 API,关=:57 未知);
2. 诱饵行 21:58:35 插入 → 21:58:57 被秒关,幽灵在线实锤;
3. 高频采样 pg_stat_activity 抓到现行:查询来自开发机本机 IP;
4. 本机 25 个残留 dev 进程,其中 **8 个 `ts-node-dev --respawn src/index.ts` 旧后端**(最老 7/5 起)连着生产库——空 sink 每分钟把线上刚开的报警 resolve 掉。杀过占端口的 child 没用:`--respawn` 父进程会再拉起新 child。

**修复**:清 25 个残留进程(父子一起);代码根治:flusher 仅 `NODE_ENV=production` 启动 + SIGTERM 立即 stopPerfFlusher + `PERF_FLUSHER_DISABLED=1` 逃生阀。

**验证**:清理+部署后诱饵 2 只被生产 :24 tick 正常 resolve,无 :57 触碰。**报警系统自此才真正可信**(前两轮修的是误报,这轮修的是漏报)。

**教训**:新增任何 setInterval 写库的后台任务必须加同款 production 门;排查线上神秘数据改动先查 `pg_stat_activity` 的 client_addr。

### 自动接手(未来)
- cx-guardian 巡检剧本已升级(commit `fe825a2`):新增 render_crash 检测、api_calls p95>1.5s 慢端点排行(修法=microCache+预热范式)、perf_alerts 核查(req=0 风暴=内部预热要包 maintenance)、修完删旧噪音行的收尾闭环、本地起服带 PERF_FLUSHER_DISABLED=1。
- 启用方式:`/loop` 本地循环跑 cx-guardian(它云端跑不了,要本地 env/docker)。
