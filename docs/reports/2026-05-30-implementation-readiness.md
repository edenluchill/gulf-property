# 实现就绪度评估(Implementation Readiness)

> 日期:2026-05-30
> 针对 `docs/agent-demo-saas-spec.md` + `docs/reports/2026-05-30-tour-ux-config-audio-tradeoffs.md`
> 问题:这些文档够不够开始实现?基于真实代码库核实后的结论。

---

## 一、可直接动手的部分

- 数据库 schema / API 表面 / 领域模型 / 订阅模型:spec 完整无歧义,建表 + CRUD 可直接做。
- 底层可复用资产(已核实真实存在):
  - **11 个 voice tools**:`backend/src/services/voice-assistant-tools.ts`(fly_to / measure_distance / amenity_spokes / show_pois / highlight_projects 等)
  - **Gemini Live 全套**:token(`routes/voice-token.ts`)、tool 执行(`routes/voice-tools.ts`)、WebSocket(`routes/voice-chat.ts`)、前端 AudioPlayer/Recorder
  - **investment-calculator.ts**:纯函数,100% 可复用于离线预生成
  - **mapAction 系统** + `MapViewMapLibre.tsx`
  - **数据表全在**:residential_projects、project_unit_types、dld_transactions、dld_areas、dubai_areas、dubai_pois
  - **认证**:Supabase JWT + `middleware/auth.ts`(requireAuth/requireAdmin/optionalAuth)

---

## 二、文档缺口(只写了"做什么",没写"怎么做"——且是风险最高的三块)

### 必须先补/先验证
1. **AI 生成导览脚本的契约【最关键】**
   - 缺:prompt、LLM 输入(房源数据+config 如何喂)、输出 schema 约束(只允许合法 mapAction)、坐标来源、`at_ms` 时间轴排布逻辑。
   - 这是产品心脏,最易翻车,spec 完全未覆盖。
2. **预生成音频是全新子系统**
   - 现状:无 TTS-to-file、无 R2 上传;所有音频都是 Gemini Live 实时流。
   - "预生成 mp3 存 R2"需从零搭链路,工作量被低估。
3. **地图缺命令式接口**
   - `MapViewMapLibre` 为 props 响应式,无 ref / `executeMapAction()`。
   - 回放引擎按 `at_ms` 逐帧驱动地图需先加命令式接口。

### 中等缺口
4. **提问切 Live 的交接协议**:Live 启动时如何拿到"当前在看第 N 套房 / 已讲内容"上下文 —— spec 未写。
5. **AI 代配**:一句话 → config 的映射只有方向,无 schema/prompt。
6. **AI 策展排序**:`routes/market.ts` 的 buying-report 实际只是 price-check 价格体检,非"推荐 Top 3",需新写排序逻辑。
7. **缺数据层**:无 agents / clients / demo_configs / demo_sessions 等表;system instruction 固定为消费者版 Luna,需参数化为带经纪身份。
8. **set_heatmap** voice tool 未实现(spec 提到)。

---

## 三、起步建议:先做垂直切片验证心脏

不要一上来铺开建全部表。先做端到端最薄切片验证最不确定的部分:

> 写死 1 个客户 + 2 套房 → 跑通 `AI 生成 TourScript JSON`(验证 prompt+schema 能产出可用 mapAction 时间线)→ 前端按该 JSON 驱动现有地图回放 → 音频用浏览器 TTS 兜底。

心脏能跳,再做 CRUD / 订阅 / 预生成音频 / R2 等确定性工作。否则可能建完一堆表才发现 LLM 排不出像样的地图时间线。

---

## 四、简化后的整体体验(落到真实资产)

### 经纪侧(异步分享)
1. 建/选客户(新建 clients 表),档案带预算/目标/国籍
2. 从现有项目库选 2–3 套房(复用 residential_projects)
3. (可选)一句话意图 → AI 起草配置(新,三层配置藏后台)
4. 「生成导览」→ LLM + 房源数据(复用 DLD + investment-calculator)+ config → TourScript(核心新功能)
5. 文字脚本秒出可改;默认 auto_publish,审核可选
6. 一键分享 + WhatsApp
7. Dashboard 线索热度 + "正在看"提醒(新建)

### 买家侧(免登录)
1. `/v/{code}` 免登录(新建公开只读页)
2. 自动播 30s 速览:地图(复用 MapViewMapLibre,需加命令式接口)+ 旁白 + 房源卡/ROI 图(复用)按时间轴同步
3. 暂停 / 快退 / 跳段(预生成天然支持)
4. 暂停提问 → 切 Gemini Live(复用现有 voice,system instruction 换成经纪身份+当前房源上下文)→ 答完回放
5. ❤️ / WhatsApp / 电话联系经纪

核心:**预生成片子做骨架(便宜/可暂停/可复看/合规可审),Live 是提问才点亮的实时问答。**

---

## 五、可复用度速查

| 功能块 | 复用度 | 备注 |
|---|---|---|
| Voice 工具定义 | ⭐⭐⭐⭐⭐ | 11 个齐全;缺 set_heatmap |
| Tool 执行框架 | ⭐⭐⭐⭐⭐ | 可改造为经纪预设命令执行器 |
| investment-calculator | ⭐⭐⭐⭐⭐ | 纯函数,离线预生成直接用 |
| 地图 mapAction | ⭐⭐⭐⭐ | 格式成熟;缺命令式 ref |
| Gemini Live | ⭐⭐⭐⭐ | 需加经纪身份 system instruction 变体 |
| 认证 | ⭐⭐⭐ | Supabase JWT 可扩展;无 agent 用户类型 |
| 市场数据 | ⭐⭐⭐⭐ | DLD 全;策展排序需新增 |
| 音频流 | ⭐⭐⭐ | Live 实时可用;无预生成保存机制 |
