# Gulf Property → 经纪 SaaS 改版:潜力评估与产品延伸

> 日期:2026-05-30
> 背景:把现有 B2C 房产查询工具,改版为"让经纪向客户 demo 房产、收经纪订阅"的 B2B2C SaaS。

## 一句话重构

现状是 **B2C 房产查询工具**(用户自己来查)。
改版后是 **B2B2C 经纪成交武器**:经纪是付费客户,他的客户是观众。卖点不是"查房",而是帮经纪"显得专业 + 加速成交"。

---

## 一、已具备的能力(约 70% 核心引擎已就绪)

| 改版需要的能力 | 现状 | 说明 |
|---|---|---|
| 地图全套工具 | ✅ ~90% | 测距、热力图、POI(19类)、地铁线路、amenity_spokes 配套放射图、flyTo、卫星图切换。`frontend/src/components/MapViewMapLibre.tsx` |
| Luna 语音 agent + 工具 | ✅ ~85% | Gemini Live 原生音频 + 12 个工具(search_projects/fly_to_area/show_nearby_pois/measure_distance/analyze_area_amenities…)。`backend/src/services/voice-assistant-tools.ts`、`backend/src/routes/voice-tools.ts` |
| 历史涨幅/趋势/数据 | ✅ 权威 | DLD 官方成交(dld_transactions)+ Ejari 租约 + 年度/滚动指标(yield、yoy_growth、price_growth)。`backend/src/db/area-analytics-schema.sql` |
| 投资测算/ROI/图表 | ✅ ~80% | investment-calculator 5年三档预测、对比报告四维打分、买房报告、SVG 图表 |
| AI 帮客户找房 | ✅ 部分 | `POST /api/market/buying-report` 按目标+预算+卧室推 TOP3 区域 + 匹配项目 |
| 经纪品牌/署名 | ✅ | AgentPortal 已有 RERA号、机构、电话,导出报告带署名 |
| 认证 | ✅ | Supabase Auth(Google/微软/邮箱 OTP) |

结论:不是发明,而是"重新组装 + 补两块"。

## 二、真正缺的两块拼图

1. **分享/Session 机制 —— 当前 0%。** 无"生成链接给客户"代码。改版物理前提。
2. **订阅/支付 —— 当前 0%。** 代码注释明确"上线后再启用"。商业模式前提。

---

## 三、产品延伸(从"工具"到"武器"的 4 个点)

### ① 客户档案(Client)是核心对象,不是一次搜索
经纪在 dashboard 建 Client:预算、家庭结构(孩子→学区权重)、自住/投资、租金vs增值偏好、区域偏好。AI 策展 3–6 套 shortlist + 排序理由。档案是持久对象,可迭代。这是与 PropertyFinder/Bayut 的本质差异:他们是房源列表,这里是为某一个人定制的方案。

### ② 客户看到的是"会动的微站",不是 PDF
链接 = `pinzos.com/v/{sessionCode}`,免登录只读。地图标好房源 + 热力图/POI/地铁;每套房"为什么值得买"卡片(5年ROI图、区域涨幅趋势、周边成交对比 price-check);新闻/趋势叙事。

### ③ ⭐ Luna "导览播放"模式(杀手锏)
客户点 ▶️ → Luna 像导演一样:flyTo 定位 → measure_distance 画到地铁的线 → amenity_spokes 显示周边配套 → 切热力图讲涨幅,边说边画。

**关键架构(省钱+可控):**
- 导览脚本在经纪生成报告时**一次性预生成**(narration 文本 + 地图动作时间线)并存储;客户播放时是**确定性回放**(预录 TTS + 触发地图动作),不走 Live API → 成本近零,且经纪可先审后发。
- 仅当客户想"插话提问"时才接入 Gemini Live 实时对话。
→ 昂贵的 Live 分钟数只花在真正互动上。

### ④ ⭐ 回流数据给经纪 = CRM 闭环
记录客户:看了哪几套、停留最久的、回放次数、是否播导览、是否点电话。dashboard 显示"线索热度"。经纪为"查房"付的钱有限,为"帮我判断该追哪个客户"付很多。这一条决定能收到每月几百而非几十。

---

## 四、潜力评价

- **市场/痛点 —— 强。** 迪拜/海湾:高佣金(2%)、强 FOMO、大量远程海外买家(中俄印)。痛点=远程客户看不到、信不过。发个链接、客户在家被 AI 带逛一圈、自带 DLD 官方数据背书,直接命中。
- **护城河 —— 中高且加深。** 短期:AI 语音导览 + DLD 数据 + PDF 自动入库 三件组合,迪拜无竞品同时拥有(Emaar/Damac/JLL 均缺)。长期:客户档案 + 互动回流数据沉淀为迁移成本。
- **变现 —— 路径清晰。** 锚点:代码已设想 199/299 AED/月。分层 Free(带水印报告)/Pro(去水印+导览+无限档案)/Team(多经纪+线索分析)。成本主要是 Gemini Live 分钟 + Claude PDF token —— 延伸③的"预生成+回放"是控毛利关键。

**主要风险(可控但须正视):**
1. "为什么值得买" + 投资预测 = 合规/责任风险,叠加政治/新闻更甚。对策:叙事化 + 全程免责(已有清洗+免责机制);新闻只聚合不"建议";政治影响绝不量化进 ROI。
2. 新闻/政治数据是真窟窿(目前完全没接)。MVP 先不做自动抓取,改"经纪手动挑 2–3 条新闻插入";别让它拖死 MVP。
3. 冷启动双边问题。好在 DLD 数据已就绪(单边已解决),只需攻经纪获取。

**总体:潜力 8.5/10。** 最难的技术资产(语音+地图+权威数据+AI管线)已造好,改版主要是重新编排 + 补分享/支付。成败手在:延伸③导览够不够惊艳 + 延伸④数据闭环能否让经纪上瘾。

---

## 五、MVP 范围(目标 6–8 周)

**必做:**
1. Client 档案表 + dashboard 建档/AI 策展(复用 buying-report 逻辑)
2. Session 分享:sessions 表 + `pinzos.com/v/{code}` 免登录只读页
3. Luna 导览:预生成脚本 + 确定性回放(暂不做实时插话)
4. 基础回流追踪(浏览/停留/回放)+ dashboard 线索列表
5. Stripe 订阅(用 199/299 锚点)

**先砍(v2):**
- 自动新闻/政治抓取 → MVP 经纪手填
- 客户实时和 Luna 对话 → MVP 只回放
- VR 看房、抵押贷款计算器、社区评分

---

## 关键文件参考
- 地图:`frontend/src/components/MapViewMapLibre.tsx`
- Luna 工具:`backend/src/services/voice-assistant-tools.ts`、`backend/src/routes/voice-tools.ts`
- 投资测算:`backend/src/services/investment-calculator.ts`
- 买房报告/区域分级:`backend/src/routes/market.ts`
- 数据 schema:`backend/src/db/{residential-projects,dubai-analytics,area-analytics}-schema.sql`
- 经纪门户:`frontend/src/pages/AgentPortalPage.tsx`
