# 四角色 Onboarding + 按角色付费墙 + 认证勋章 — 实施方案 2026-07-05

需求(Eden):首次登录在**一个页面**选 4 个角色(可视化、好看可爱、区分度高的按钮),选之前**不显示价格**,但提醒"选对角色否则缺功能";选完后买家直接用,其余 3 个角色**必须付费**、各有专属付费页(**各自只看到自己的价格,不显示免费选项**);购买后**颁发认证勋章**,登录可见,且能**生成发朋友圈的勋章图**。

## 角色与套餐映射

| 角色(user_profiles.role) | 套餐(lt_subscription_plans) | 价格 | 内容 |
|---|---|---|---|
| buyer 买家 | 无(免费) | — | 全站浏览/收藏/Luna,行为进 lead 引擎 |
| agent 经纪人 | rookie(便宜)+ agent(Pro) | $25 / $99 月 | 现有两档,7 天试用 |
| agency 经纪公司 | founder(展示名「经纪公司版」) | $699 月 | 多席位(含加席 $49/席)+ lead 优先分发(分发规则后续) |
| developer 开发商 | **developer(新建)** | **$299 月 / $2990 年(暂定,可改)** | 上传楼书 + 项目管理 + 销售工具(经纪台能力),7 天试用 |

- Stripe 产品/价格由 `scripts/setup-stripe-prices.ts` 幂等创建回填 DB(key 从服务器容器取);当前 test 模式,价格随时可调。
- 付款成功 webhook 即自动审批(现有机制),owner 后台可撤销。

## 勋章(购买后颁发,按生效订阅推导,不落新表)

| 套餐 | 勋章 |
|---|---|
| rookie | 认证经纪人 Certified Agent(蓝) |
| agent | 金牌经纪人 PRO(靛金) |
| founder | 认证经纪公司 Certified Agency(紫) |
| developer | 认证开发商 Certified Developer(琥珀) |

- 展示:登录后头像菜单(UserMenu)常显勋章条 + 「我的勋章」入口。
- 朋友圈图:前端 canvas 生成 1080×1350 分享卡(品牌+徽章+称号+邮箱+日期+pinzos.com),一键保存。

## 门禁

- `mapMeter`:role ∈ {agent, agency, developer} 且无生效订阅 → 地图数据立即锁(引导去各自 plans 页);buyer 免费。
- `can-upload`:admin / upload_permissions 白名单 / **developer 且订阅生效** → 可上传楼书。
- 经纪台(/agent):agent、agency、developer(销售工具)都可进。

## 分期

- P1(本轮):角色模型 4 值、四卡选择弹窗、/agent/plans(rookie+agent)、/agency/plans(founder=经纪公司版)、/developer/plans(developer 新档)、developer Stripe 产品、mapMeter/can-upload 门禁、勋章推导+UserMenu 展示+朋友圈分享卡。
- P2(待做):agency lead 分发规则;开发商 sales 细化(自有项目 CRM);勋章落表(颁发时间/编号);选错角色的自助改角色入口(现走后台/联系)。
