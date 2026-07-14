> # ⚠️ 半份过期(2026-07-13 核实)
>
> **§1(聚合气泡)已死** —— 主角 `supercluster` 在前端**零 import**,`ClusterBubble` 零命中,
> 已被 `ProjectCardMarker` 取代。那个 npm 依赖也已在本次大扫除中卸载。
>
> **§2(访客分析)仍然是活的** —— 那部分照旧有效。

# Cluster pill 重设计 + 访客级 analytics — 2026-06-19

## 1. Cluster pin 现代化

旧:深色圆圈 + 白数字,视觉很一般。
新:**白色圆角药丸** = 青→天蓝渐变数字圈 + 该簇**最低起价**(`起 Ð90万`)。
- supercluster 用 `map`/`reduce` 聚合每簇 `minPrice`;无价项目时只显示数字。
- 文件:`frontend/src/components/MapViewMapLibre.tsx`(ClusterBubble + superclusterIndex)。

## 2. 访客级 analytics(单用户行为 + 预测)

**问题**:dashboard 只有总量,看不到有多少 unique 用户、他们是谁、各自看了啥;"访客"也不清楚是总数还是去重。

**数据基础**(已有,无需建表):`app_events.visitor_id`(localStorage 级稳定浏览器 ID)是每个访客的稳定 key;`leads` 表有意向打分;`luna_sessions` 有对话。详见后端 `analytics-schema.sql` 等。

**后端**(`services/analyticsQueries.ts` + `routes/admin-analytics.ts`):
- `GET /admin/analytics/visitors?days=N` —— 按 `visitor_id` 聚合,每个唯一访客一行:email(若登录)、首次/最近、浏览/搜索/Luna 次数、distinct 项目、**意向评分**(沿用 leadScoring 权重)、**阶段**(hot/warm/cooling/cold,按分数+最近活跃)。
- `GET /admin/analytics/visitors/:id` —— 单访客完整画像:有序**行为时间线**(每个 event + 项目/区域/搜索词)、看过的项目(带价)、**预测**:预估预算(看过项目价格区间)、关注区域、搜索词、用没用 Luna、有没有联系方式。

**前端**(`components/analytics/Visitors.tsx` + `pages/AdminAnalytics.tsx`):
- 头部卡 "访客" → **"独立访客 … 去重"**,消除总数/unique 歧义。
- 新增 **「访客明细」表**(放在头部卡下方,最显眼):每行=一个唯一访客(id 短码/邮箱)+ 阶段徽章 + 评分 + 浏览/搜索/Luna + 最近活跃;点行 → 右侧滑出**单用户面板**:意向预测卡(阶段+评分+预估预算+关注区域+搜索词+**下一步建议**)+ 看过的项目 + 行为时间线。
- 下一步建议为规则推导(热 lead→人工跟进 / 高意向匿名→引流捕获联系方式 / 没用 Luna→推语音助手 / 关注某区→推该区新盘 等)。

实测(生产数据样例):某访客 score 30/warm,93 事件、19 浏览,预估预算 200万–1758万,关注 International City/City of Arabia,看过 GREENZ 等 7 个项目。

## 部署
- 后端两个新路由已部署(`api.pinzos.com`,403=已上线且鉴权)。
- 前端 push 后 Cloudflare 自动 deploy。dashboard 仍 owner-only(需登录 + dashboard key)。

## 后续可做
- 单访客「AI 分析」按钮:把行为时间线喂给 LLM 生成自然语言画像 + 精准 next-best-action(当前是规则版)。
- 把访客与 Luna 对话transcript 关联展开。
- 项目详情页图表也加 hover 交互(与区域面板一致)。
