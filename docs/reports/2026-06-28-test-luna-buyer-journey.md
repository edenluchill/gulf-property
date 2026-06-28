# Luna 语音 — 买家旅程自动化测试报告

日期:2026-06-28
测试者:Claude(自主跑,无需真人语音)

## 怎么测的(可复跑)

无法在 CI 里说话/听音,所以用**文字驱动真实会话 + 截图**覆盖除"真人语音识别/VAD/音质/iOS外放"外的全部链路:

1. **静态守卫** `frontend/scripts/check-voice-tools.mjs` —— diff「前端声明 / 提示词引用 / 后端执行器」三处工具一致性,1 秒拦"光说不做"。
2. **测试钩子** `__lunaTest`(`VoiceAssistantContext.tsx`,仅 `?lunatest=1` 或 localStorage `luna_test=1` 开启,客户碰不到):`say(text)` 往真实 Gemini 会话注入文字,`open/close/stopMic/connected/state` 控制+读状态。register-once(ref 读实时值),不会中途消失。
3. **Playwright harness** `frontend/scripts/luna-flow-test.mjs` —— 无头 Chromium + 假麦克风,加载线上 `pinzos.com/?lunatest=1`,开 Luna→停麦→按真实节奏(等气泡相对上一轮**变化**才算新回复)逐轮注入买家话术,逐轮截图 + 抓 console(工具调用/计时/关闭/报错),检测卡死/被忽略。
   ```
   node frontend/scripts/luna-flow-test.mjs   # SHOT_DIR=... 自定义输出
   ```

买家话术(连贯旅程):预算推荐 → 带我看看 X 区 → 周边方便吗 → 预算内项目 → 看第一个详情 → 5年回报。

## 发现 & 修复(共 5 轮迭代)

| # | 发现 | 修复 |
|---|------|------|
| 1 | `present_place`(三步带看)**光说不做**:提示词把示例开场白"好我带你看看X分三步"当台词,模型照念却不调工具(turn 2 零 tool call,地图无反应) | 重写提示词:删诱饵示例 + "必须先 emit 函数调用,只说不调=失败"(`voice-token.ts`,已 quick-deploy) |
| 2 | 0 结果死局:问没房源的区域,Luna 只说"没找到"就卡住 | 提示词:0 结果主动转向预算内有房源的区域 |
| 3 | 测试钩子中途消失致 harness 崩 | `__lunaTest` 改 register-once + ref 读实时值;harness 防御性轮询 + localStorage 兜底(跳转丢 query 也不怕) |
| 4 | harness 把上一轮残留气泡误判为"已回复",节奏过快(连珠炮)致 turn 5 偶发被忽略 | 改成"气泡相对上一轮变化"才算新回复,节奏更像真买家;turn 5 随即稳定触发 |

## 最终结果(第 5 轮,真实节奏,干净 6/6)

| 轮 | 买家说 | 工具 | 首回复 | 结果 |
|---|--------|------|--------|------|
| 1 | 300万预算推荐区域 | recommend_by_budget | 4.3s | ✓ Al Safouh/Al Barsha/DIP + 收益涨幅 |
| 2 | 带我看看 Al Safouh First | **present_place** | 2.9s | ✓ 地图飞入+三步带看面板(优势/环境/成交+上下步) |
| 3 | 周边方便吗 | analyze_area_amenities | 2.9s | ✓ 便利度100/100+各距离放射图 |
| 4 | 预算内有哪些项目 | search_projects | 2.9s | ✓ 113 RESIDENCES 等真实项目+户型价格 |
| 5 | 带我看第一个详情 | navigate_to_project | 4.3s | ✓ 打开详情页,Luna 存活继续介绍 |
| 6 | 5年回报值得吗 | (investment) | 2.2s | ✓ 年化2.6%+收益曲线+"指示性预测非保证"免责 |

- 无卡死、无被忽略;延迟 2.2-4.3s(原生音频+工具往返合理范围)。
- 截图存 `scratchpad/luna-test5/`(00-06)。买家视角合理:推荐→带看→便利度→选盘→详情→回报闭环。

## 生产安全

- 全部修复已上线(前端 Cloudflare 自动部署、后端 quick-deploy 已验 health OK),第 5 轮即对线上验证。
- `__lunaTest` 钩子**仅** `?lunatest=1`/localStorage 开启,只能驱动用户自己的会话、不碰密钥/鉴权/他人数据 → 留作回归测试入口,安全。
- 未覆盖(需真机):真人语音识别准确率、VAD 对真嗓音时机、音质、iOS 外放路由。

## 第二轮(用户反馈后的优化,2026-06-28 下午)

用户真机反馈 3 个体验问题 + 要求测全部工具。又跑了 ~8 轮迭代:

| 反馈 | 根因 | 修复 | 验证 |
|------|------|------|------|
| ① 第一次带看失败,等10秒没反应,要重新强调 | Luna 口头应承("好的这就带您看看")却隔一轮才真调 present_place | 提示词:**调用前根本不知道数据 → 必须先调用**,禁止凭空叙述 | tourprobe **4/4** 触发;buyer 6/6 |
| ② 推荐项目时看不出她说的是哪个 | `highlight_projects` 只飞镜头、**没高亮项目**(projectIds 被忽略) | 前端:`flashProjectIds` → `ProjectPinMarker` emerald 脉冲环(animate-ping),6s 后清 | 已上线(动画需真眼看) |
| ③ 介绍环境时 Luna 不说话,光看很奇怪 | present_place 只回一句空话,三站要点没喂给模型 | 后端 summary 带三站口语要点 + 提示词"调用后顺着要点边看边讲" | 带看时已朗读"回报X% 地铁X km 成交X万" |
| 全部工具 | — | harness 加 JOURNEY=tools/tourprobe | 见下 |

**全部工具实测(JOURNEY=tools)**:check_affordability ✓、get_area_info ✓、rent_vs_buy ✓(带免责)、purchase_costs ✓(费用明细)、fly_to_area ✓、area_investment_report ✓、navigate_to_project ✓、search_projects ✓、recommend_by_budget ✓、analyze_area_amenities ✓、present_place ✓。

**测试机制经验**:文字注入(sendClientContent)在 Luna **长语音还没说完**时发下一句会被丢(turn 显示 stuck)——真人语音靠 VAD 自然等她说完不会遇到。harness 加 settle(等 listening+无工具+气泡稳 4.9s)后 buyer **干净 6/6**。

**已知待办(非阻塞,已记录)**:
- `area_investment_report` 后端端点 `/api/ai/analytics/report` 慢(~15-20s/次),"对比"时模型调两次 → ~30s。需端点层优化(查询/缓存)。
- "对比 A vs B" 模型用 area_investment_report×2 而非 compare_market(能对比但慢)。
- 金额偶发说错数量级(180万→1.8万),已加提示词防护,待复验。

## 复跑命令
```
node frontend/scripts/check-voice-tools.mjs               # 工具一致性(每次改工具必跑)
node frontend/scripts/luna-flow-test.mjs                   # 买家旅程 6 轮 + 截图
JOURNEY=tools node frontend/scripts/luna-flow-test.mjs     # 其它 8 个工具
JOURNEY=tourprobe node frontend/scripts/luna-flow-test.mjs # present_place 可靠性(4次)
```
