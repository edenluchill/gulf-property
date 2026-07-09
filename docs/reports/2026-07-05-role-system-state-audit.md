# 四角色体系全状态审计(细节版)— 2026-07-05

对照代码逐条验证(App.tsx 路由 / Layout / Header / MobileNav / RoleSelectRedirect / mapMeter / AgentLayout / billing / agents / profile)。
符号:✅正常 ⚠️别扭可走通 ❌断裂(标「已修」= 本日修复并上线)。

---

## 0. 身份状态的判定来源(谁说了算)

| 状态 | 判定来源(代码) |
|---|---|
| 角色 | `user_profiles.role`(buyer/agent/agency/developer/NULL);前端 sessionStorage `pinzos-role` 会话缓存 |
| 订阅 | `lt_subscriptions.status`(active/trialing 为"生效"),按 `lt_agents`(email)挂;席位成员经 `billing_agent_id` 挂团队订阅 |
| 经纪台准入 | `agents.status = approved`(付款 webhook autoApprovePaid;owner 恒 approved) |
| admin | `ADMIN_EMAILS` 白名单(lzp6529 + shelldubai26),前后端同表 |
| owner | `OWNER_EMAILS`(仅 lzp6529):dashboard 数据、经纪审批、上传授权管理 |
| 上传权限 | admin/owner ∪ `upload_permissions` 白名单 ∪ (role=developer 且订阅生效) |
| 地图计量豁免 | 分享码 / admin / owner / 买家或无角色的登录用户 / 内部测试号;**匿名 10min/天**;**agent·agency·developer 无生效订阅 = 立即锁** |

---

## 1. 全路由清单 × 守卫(谁能进门)

| 路由 | 守卫(代码级) | 备注 |
|---|---|---|
| `/` `/map` `/v/:code` `/t/:code` | 无(Layout 常驻地图) | 数据层被 mapMeter 计量;/v /t 分享码豁免 |
| `/choose-role` | 页面内:匿名→"请先登录"卡;有生效订阅→"身份由订阅决定"卡(并自动补落 role) | 首登无角色由 RoleSelectRedirect 送入 |
| `/agent/plans` `/agency/plans` `/developer/plans` | 无守卫(可匿名看) | 订阅按钮:匿名→送 /agent 登录 |
| `/pricing` | 无 | 公共四卡(不含开发商档) |
| `/agent`(+clients/tour/report/billing) | AgentLayout:未登录→LoginGate;agents.status≠approved→"审核中/未开通"卡+选套餐按钮;?status=success 时轮询 ~12s(已修竞态) | `/api/agents/me` 会给任何登录访问者自动建 pending 行 |
| `/agent/tour/:id/edit` | 无路由守卫,页面内 API 鉴权 | ⚠️ 直接访问渲染空态,不算断裂 |
| `/agent/join` | 无(纯转发 → /choose-role;已有 profile.agent → /agent) | 旧免费旁路已封(已修) |
| `/developer/upload` | ProtectedRoute requireUploader(admin ∪ 白名单 ∪ 付费开发商) | canUpload=null 时显示 loading 不闪拒绝 |
| `/admin/tasks` `/admin/tasks/:id/review` `/admin/properties` `/admin/property/edit/:id` | requireUploader | 同上 |
| `/admin/dubai` | requireAdmin | 区域IP保护,仅 admin |
| `/admin/analytics` | requireAdmin 路由级;页内数据 owner-only | shelldubai26 能开页,数据接口被 owner 门拦 |
| `/r/:code` `/cr/:code` `/pp/:code` `/factsheet/:code` | 无(公开分享,chromeless) | 计量豁免(不走被计量前缀) |
| `/profile` `/favorites` `/compare` `/transactions` `/areas` `/report` `/about` `/privacy` `/terms` | 无 | |
| `/login` `/auth/callback` | 无 | RoleSelectRedirect 的 quiet 路径 |
| `/langgraph/test` | 无 | ⚠️ 遗留测试页裸奔(P2:该挂 requireUploader 或删) |

RoleSelectRedirect quiet 路径(不会被拽去选角色):`/t/ /v/ /r/ /cr/ /pp/ /factsheet/ /auth/ /login /choose-role /agent/plans /agency/plans /developer/plans /pricing /agent/join`。

---

## 2. 逐角色 · 完整链路

### R1 匿名访客
| 触点 | 表现 |
|---|---|
| `/` 地图 | 可看;数据层 10min/天(visitor+IP 桶),用尽 429 → 前端引导登录 |
| Luna | ~25万 token/天(≈10min),用尽弹登录引导;分享 tour 完全豁免 |
| Header/手机导航 | 登录按钮;无经纪台/管理;手机 4 tab(探索/分析/成为经纪→现指 choose-role/登录) |
| `/choose-role` 直访 | "请先登录"卡(已修:原来点卡片静默失败) |
| 三个 plans 页直访 | 可看价格;点订阅 → 送 /agent 登录 ⚠️(登录后需自己回来,P2 可带 return url) |
| 分享页 /pp /r /t /v | 完整可看,免登录免计量 ✅ |

### R2 已登录 · 无角色(新注册,或选了付费角色未付款)
| 触点 | 表现 |
|---|---|
| 任意非 quiet 页 | RoleSelectRedirect → `/choose-role` 四卡页 |
| 地图数据 | ✅ 豁免计量(登录且非从业者角色) |
| 选买家 | 落 role,整页回地图 |
| 选付费角色 | **不落 role**,去对应 plans 页;不付款 → 下次仍回本状态(可重选,不会被锁)✅ |
| 有订阅但 role 空(席位成员/comp/竞态) | `/choose-role` 检测到订阅 → **自动按套餐补落 role**(已修死循环)✅ |

### R3 买家(buyer)
| 触点 | 表现 |
|---|---|
| 地图/Luna/收藏/成交/详情/对比 | 全功能;地图不限时;Luna 免费档 ~70万 token/天 |
| Header | 地图探索 · 成交记录 · **个人中心** · 关于(无经纪台,无管理) |
| 手机导航 | 探索/分析/我的(无经纪入口,由「我的」页升级)|
| 头像菜单 | 角色徽章 🏠买家;「切换身份」→ /choose-role;无勋章 |
| ProfilePage | 「我的身份」卡(买家 chip + 切换身份);「成为经纪」→ /choose-role(已修:原直接写 role) |
| 直访 `/agent` | ⚠️ 会被登记 pending,看到"审核中"卡 + 选套餐按钮(有出口,语义稍怪,P2) |
| 直访 `/developer/upload` 等 | "无权限"卡 ✅ |
| `/choose-role` | 四卡可重选(免费身份间即时切换) |

### R4 经纪人 · 未付费(选了 agent 已付过又取消到期 / 存量)
| 触点 | 表现 |
|---|---|
| 地图数据 | **立即锁**(不给每日额度)→ 429 → 前端弹层 → `/agent/plans?from=map` |
| plans 页 | 顶部横幅讲规则 + 「选错身份?重新选择角色→」;左上「←重新选择角色」;底部同链 ✅ |
| `/choose-role` | 无生效订阅 → 四卡可重选(退买家即解锁地图)✅ |
| `/agent` | agents.status 若曾 approved(付过款)→ 能进但功能被 quota 拦(免费档归零);未 approved → "审核中"卡+选套餐 |
| 头像菜单 | 🧑‍💼经纪人 chip;「切换身份」可用(无勋章) |

### R5 经纪人 · 已付费(rookie / agent 档)
| 触点 | 表现 |
|---|---|
| 地图/数据 | 不限时(订阅豁免计量)✅ |
| `/agent` 经纪台 | approved(webhook 自动)→ 全功能;积分额度按档(200/2500 月) |
| 头像菜单 | 🧑‍💼chip + 勋章条(启程=认证经纪人💼 / 专业=金牌经纪人PRO🏅)+「我的勋章」分享卡 +「订阅与套餐」(**无切换身份**,身份锁定)✅ |
| `/choose-role` 直访 | "身份由订阅决定"引导卡(管理订阅/回地图)✅ |
| 升级 founder | /agent/billing 升级 → webhook 自动把 role 改为 agency、勋章变认证经纪公司 ✅ |
| 取消订阅 | 期末到期 → 回 R4(锁地图,可重选角色)✅ |
| 扣款失败 past_due | ⚠️ 勋章暂隐、「切换身份」重现;若切走后扣款恢复,webhook 把 role 改回 —— 状态自洽但语义跳(P2:past_due 也锁切换) |

### R6 经纪公司(agency,founder 档本体)
R5 全部 + :
| 触点 | 表现 |
|---|---|
| `/agent/billing` | 团队席位管理:邀请/移除/加席($49/席,Stripe 按比例)✅ |
| 头像菜单 | 🏢经纪公司 chip + 认证经纪公司勋章 ✅ |
| 手机导航 | 经纪台入口 ✅(已修:原漏 agency → 显示"成为经纪") |
| Lead 独占优先 | ⚠️ 文案已上,**分发规则未实现**(P2 计划内) |

### R7 Founder 席位成员(被邀请的打工经纪)
| 触点 | 表现 |
|---|---|
| 首次登录 | role 空 + 有团队订阅 → /choose-role 自动补落 role=**agent**(已修死循环;按成员不按公司)✅ |
| 地图/经纪台 | 团队订阅生效 → 不限时 + 经纪台可用(共享积分池)✅ |
| 勋章 | ⚠️ 目前按套餐显示「认证经纪公司」,语义应为「认证经纪人」(P2) |
| 被移出团队 | 订阅失效 → 回 R4 逻辑 ✅ |

### R8 开发商 · 已付费(developer 档)
| 触点 | 表现 |
|---|---|
| 上传链 | canUpload=true(role+订阅查库)→ Header/手机「管理」菜单(上传楼书/项目管理/任务管理三项,无数据管理/地图编辑)→ /developer/upload 全流程 ✅ |
| 经纪台(sales) | isAgent 含 developer(Header+MobileNav,后者已修)→ CRM/带看/报告可用 ✅ |
| 头像菜单 | 🏗️chip + 认证开发商勋章 ✅ |
| 取消到期 | 上传权限随订阅失效;地图锁;可重选角色 ✅ |
| 未付费 developer | 同 R4 逻辑(锁地图 → /developer/plans)✅ |

### R9 上传白名单帮手(蕾姐:buyer + upload_permissions)
| 触点 | 表现 |
|---|---|
| 地图 | buyer 豁免计量,不进付费墙 ✅(**角色保持 buyer 是正确组合,别让她选开发商**) |
| 上传链 | canUpload=true → 桌面/手机「管理」菜单(三项)→ 上传/审核/项目管理 ✅(手机端已修) |
| admin 页 | 数据管理/地图编辑不可见不可达 ✅ |

### R10 admin(shelldubai26)
| 触点 | 表现 |
|---|---|
| 角色选择 | 永不弹/不重定向(isAdmin 跳过)✅ |
| 地图/Luna | 计量豁免 ✅ |
| 管理菜单 | 全五项;/admin/analytics 页能开,**数据接口 owner-only** → 看到空/受限 ⚠️(既有设计:admin≠owner) |
| 经纪台 | owner 恒 approved;admin 走 agents 表(shelldubai26 已 approved)✅ |

### R11 owner(lzp6529)
R10 全部 + dashboard 数据、经纪审批(含套餐赠送/上传授权)、无限额度 ✅。
⚠️ 注意:owner 手动赠送套餐(comp)不触发 webhook —— 受赠人 role 由 /choose-role 自动补落(已修),但**不会自动 approve agents 表**(P2:comp 时顺手 approve,现可在同一后台手点)。

---

## 3. 同行为 × 角色矩阵

| 行为 | 匿名 | 无角色 | buyer | agent未付 | agent付 | agency | 席位成员 | developer付 | 白名单帮手 | admin | owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 地图数据 | 10min/天 | 不限 | 不限 | **锁** | 不限 | 不限 | 不限 | 不限 | 不限 | 不限 | 不限 |
| Luna 额度 | ~25万/天 | 70万 | 70万 | 70万(经纪功能被quota拦) | 按积分 | 按积分(×0.6) | 共享池 | 按积分 | 70万 | 无限 | 无限 |
| 经纪台 /agent | 登录门 | 审核卡 | 审核卡⚠️ | 审核卡/受限 | ✅ | ✅+席位 | ✅ | ✅ | 审核卡 | ✅ | ✅ |
| 上传楼书 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ | ✅ | ✅ | ✅ |
| 管理菜单(桌面/手机) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 3项 | 3项 | 5项 | 5项 |
| /choose-role | 登录卡 | 四卡 | 四卡 | 四卡 | 锁定卡 | 锁定卡 | 锁定卡 | 锁定卡 | 四卡 | 四卡(不会被自动送来) | 同左 |
| 头像菜单第三行 | — | — | 切换身份 | 切换身份 | 订阅与套餐 | 订阅与套餐 | 订阅与套餐 | 订阅与套餐 | 切换身份 | 视订阅 | 订阅与套餐 |
| 勋章 | — | — | — | — | 💼/🏅 | 🏢 | 🏢⚠️ | 🏗️ | — | 视comp | 🏢(comp) |
| dashboard 数据 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 页开数据拦⚠️ | ✅ |

---

## 4. 本日修复汇总(commit debd874 + 378f667 等)

| # | 断裂 | 修复 |
|---|---|---|
| 1 | 订阅生效但 role 空(席位成员/comp/竞态)→ /choose-role 死循环 | 检测订阅自动按套餐补落 role(席位成员按 agent) |
| 2 | /agent/join「免费早鸟开通」绕过付费墙 | 纯转发 /choose-role |
| 3 | ProfilePage「成为经纪」先写 role 再付款 → 未付款被锁 | 改跳 /choose-role |
| 4 | 付款回跳早于 webhook → 被"审核中"拦,落role/勋章不执行 | ?status=success 轮询审批 ~12s |
| 5 | 匿名 /choose-role 点卡静默失败 | "请先登录"卡 |
| 6 | 手机端无角色徽章/切换/勋章入口 | ProfilePage「我的身份」卡 |
| 7 | 手机导航 isAgent 漏 agency/developer → 付费公司/开发商看到"成为经纪" | 与 Header 对齐 |
| 8 | 手机「管理」入口漏 canUpload(白名单/开发商手机无上传入口) | 与 Header 同规则+条目过滤 |

## 5. 遗留 P2(按优先级)

1. 席位成员勋章按「认证经纪人」显示(现按套餐显示公司勋章);
2. past_due 期间锁切换身份(现可切,恢复扣款后 webhook 覆盖,语义跳);
3. buyer 直访 /agent 被登记 pending + "审核中"文案(应显示"选择套餐即可开通"的中性文案,且不该给买家建 pending 行);
4. 匿名在 plans 页点订阅 → 登录后不回跳(带 return url);
5. owner comp 赠送不自动 approve agents 表;
6. /langgraph/test 测试页裸奔(挂 requireUploader 或删);
7. agency lead 分发规则、开发商 sales 细化(原计划)。
