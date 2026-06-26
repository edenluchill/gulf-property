# Stripe 配置一步步教程(经纪台订阅)

> 给非工程背景也能照做。代码已全部就位,这份文档只讲**你需要在 Stripe 后台和服务器上做的配置**。
> 配置环境变量、注册 webhook 全部完成后,告诉我「配好了」,我来部署 + 真卡验收。
>
> 全程先用 **测试模式(Test mode)** 跑通,再切真实模式(Live mode)。两套密钥完全独立,不会互相影响。

---

## 名词速查(2 分钟)

| 名词 | 是什么 | 长什么样 |
|---|---|---|
| **Product(产品)** | 你卖的东西,比如「Agent 经纪版」 | — |
| **Price(价格)** | 产品的某个定价,比如「$99/月」 | `price_1Q...` |
| **Secret key(密钥)** | 后端调用 Stripe 的钥匙,**绝不能泄露/进前端** | `sk_test_...` / `sk_live_...` |
| **Webhook(回调)** | Stripe 付款成功后通知我们服务器的地址 | 我们的:`api.pinzos.com/api/billing/webhook` |
| **Webhook secret** | 验证回调真的来自 Stripe 的钥匙 | `whsec_...` |
| **Test mode** | 沙盒,用假卡(4242…)不扣真钱 | — |

---

## 第 0 步:注册/登录 Stripe

1. 打开 https://dashboard.stripe.com → 注册或登录。
2. 右上角确认有个 **「Test mode」开关 / Sandboxes**,**打开它**(本教程全程在测试模式)。
   - 新版界面叫 **Sandboxes**,选一个 sandbox 即可;老版界面右上角是 **Test mode** 切换。
3. (可做可不做)左侧 Settings → Business 填一下公司名,发票上会显示。

---

## 第 1 步:建两个产品和价格

我们要建 **2 个 Price**:Agent $99/月、Founder $699/月。(Explore 免费,不用建。)

### Agent 经纪版

1. 左侧菜单 **Product catalog**(产品目录)→ 右上 **+ Add product**(添加产品)。
2. 填:
   - **Name(名称)**:`Agent`
   - **Description**(可选):`Pinzos 经纪版 — 实时带看 + Luna 导览 + 意向报告`
3. 往下找 **Pricing(定价)** 区:
   - **Pricing model**:选 **Standard pricing / Recurring(订阅,周期性)** —— ⚠️ 一定要选 **Recurring**,不是 One-off。
   - **Amount(金额)**:`99`
   - **Currency(币种)**:**USD**
   - **Billing period(计费周期)**:**Monthly(每月)**
4. 点 **Save product / Add product**。
5. 保存后进入该产品详情,在 **Pricing** 那一行能看到一个以 `price_` 开头的 ID(点一下可复制)。
   👉 **把它记下来 = `STRIPE_PRICE_AGENT`**,例如 `price_1QabcAgent...`

> 💡 7 天免费试用**不用**在这里设 —— 我们代码里在 Checkout 时自动加 `trial_period_days: 7`,无需在 Stripe 产品上配置。

### Founder 创始会员

重复上面,只改:
- **Name**:`Founder`
- **Amount**:`699`,Currency **USD**,Billing period **Monthly**

保存后复制它的 `price_...` ID。
👉 **记下来 = `STRIPE_PRICE_FOUNDER`**

---

## 第 2 步:拿后端密钥(Secret key)

1. 左侧 **Developers(开发者)** → **API keys**(API 密钥)。
   - 新版:右上头像旁 **Developers** → **API keys**。
2. 找 **Secret key**,点 **Reveal / 显示**,复制。
   - 测试模式下它以 `sk_test_` 开头。
   👉 **记下来 = `STRIPE_SECRET_KEY`**

> ⚠️ 这把钥匙等于你 Stripe 账户的后门,只放服务器,别发微信/别截图/别进前端代码。

---

## 第 3 步:注册 Webhook,拿 Webhook secret

让 Stripe 在付款/订阅变化时通知我们的服务器。

1. 左侧 **Developers** → **Webhooks** → **+ Add endpoint**(添加端点)。
2. **Endpoint URL(端点地址)**填:
   ```
   https://api.pinzos.com/api/billing/webhook
   ```
3. **Select events(选择事件)** → 勾这几个(搜关键词找):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. 点 **Add endpoint** 保存。
5. 进入刚建好的 endpoint 详情页,找 **Signing secret(签名密钥)** → **Reveal**,复制。
   - 以 `whsec_` 开头。
   👉 **记下来 = `STRIPE_WEBHOOK_SECRET`**

到这里你应该攒齐了 **4 个值**:

```
STRIPE_SECRET_KEY      = sk_test_xxxxx
STRIPE_WEBHOOK_SECRET  = whsec_xxxxx
STRIPE_PRICE_AGENT     = price_xxxxx
STRIPE_PRICE_FOUNDER   = price_yyyyy
```

---

## 第 4 步:把这 4 个值写到服务器

环境变量放在 **API 服务器**(`Pinzos-backend-1`)的 `/opt/pinzos/.env` 文件里。
代码已经在 docker-compose 里映射好这几个变量了,你只需要把值加进 `.env`。

> ℹ️ 我(Claude)不直接读写 `.env`(避免密钥暴露),所以这步由你来。在本会话里用 `!` 开头就能直接跑命令、输出会回到对话里。

### 4.1 找到 API 服务器 IP

如果你不确定 IP,先在本会话输入(`!` 开头我会执行):

```
! ssh -i ~/.ssh/Pinzos_ed25519 root@<api-server-ip> "hostname"
```

(`<api-server-ip>` 换成实际 IP;不知道的话告诉我,我帮你从部署脚本里查。)

### 4.2 追加到 .env(把 4 个值换成你的)

用一条命令安全追加(不会覆盖原文件):

```bash
! ssh -i ~/.ssh/Pinzos_ed25519 root@<api-server-ip> "cat >> /opt/pinzos/.env <<'EOF'
STRIPE_SECRET_KEY=sk_test_把你的贴这里
STRIPE_WEBHOOK_SECRET=whsec_把你的贴这里
STRIPE_PRICE_AGENT=price_把你的贴这里
STRIPE_PRICE_FOUNDER=price_把你的贴这里
APP_URL=https://www.pinzos.com
EOF"
```

> ⚠️ 等号两边**不要加空格**,值**不要加引号**。
> ⚠️ 如果 `.env` 里已经有同名变量,先删旧的再加,别留两份。

检查写进去了(只看键名,不打印密钥值):

```
! ssh -i ~/.ssh/Pinzos_ed25519 root@<api-server-ip> "grep -o '^STRIPE[A-Z_]*' /opt/pinzos/.env"
```

应能看到 4 个 `STRIPE_...` 键名。

---

## 第 5 步:回填 Stripe price_id 到数据库(可选但推荐)

后端解析 price 时**优先读 env**(第 4 步已配),所以这步严格说不是必须的。
但回填到数据库后,`/api/billing/plans` 也能带上 price,数据更完整。本会话执行:

```
! cd backend && npx ts-node scripts/db-query.ts "UPDATE lt_subscription_plans SET stripe_price_id='price_把AGENT贴这里' WHERE id='agent'"
! cd backend && npx ts-node scripts/db-query.ts "UPDATE lt_subscription_plans SET stripe_price_id='price_把FOUNDER贴这里' WHERE id='founder'"
```

---

## 第 6 步:叫我部署

上面都做完后,在对话里跟我说 **「Stripe 配好了,部署吧」**,我会:

1. 跑 `backend/quick-deploy.ps1` 部署后端(让 billing 端点 + webhook 生效)
2. push 代码触发前端 Cloudflare Pages 自动部署(`/pricing` + `/agent/billing` 上线)

> 在那之前别让我部署 —— 没配密钥时点「订阅」会报 503。

---

## 第 7 步:真卡(测试卡)验收

部署后,我们用 Stripe 的**测试卡**走一遍(测试模式不扣真钱):

| 卡场景 | 卡号 | 有效期 | CVC |
|---|---|---|---|
| 成功 | `4242 4242 4242 4242` | 任意未来日期 | 任意 3 位 |
| 需要 3DS 验证 | `4000 0027 6000 3184` | 同上 | 同上 |
| 拒付 | `4000 0000 0000 0002` | 同上 | 同上 |

验收清单(我会陪你跑):
1. 登录经纪台 → 「订阅」tab → 点「免费试用 7 天」→ 跳到 Stripe Checkout → 用 4242 卡付款。
2. 回到 `/agent/billing` 应显示 **试用中 / Agent**,额度变成 20。
3. Stripe 后台 Developers → Webhooks → 看到事件 **200 成功**(不是 400/500)。
4. 点「管理订阅」→ 跳到 Stripe Portal,能看到订阅、能取消。
5. 在 Portal 取消 → 回来状态变 **已取消**。

---

## 第 8 步:从测试切到真实模式(等测试通过后再做)

确认测试模式一切正常,再上线收真钱:

1. Stripe 右上角**关掉 Test mode**(切到 Live)。
2. **重新做第 1、2、3 步**(Live 模式下产品/价格/密钥/webhook 都是另一套):
   - 重新建 Agent / Founder 两个 Price(Live)→ 新的 `price_...`
   - 拿 Live 的 `sk_live_...`
   - 重新注册 webhook 端点(同一个 URL)→ 新的 `whsec_...`
3. 用 Live 的值**替换**服务器 `/opt/pinzos/.env` 里的那 4 个(第 4 步)。
4. 数据库 price_id 也换成 Live 的(第 5 步)。
5. 叫我重新部署。
6. 用一张**真实银行卡**小额走一遍(可立即在 Portal 退订),确认线上能扣款。

> 💡 真要上线收款前,Stripe 可能要求你完成账户**激活/资料审核**(Activate account:公司信息、银行账户、负责人身份)。在 Dashboard 顶部横幅按提示填完即可,否则 Live 模式收不了款。

---

## 常见问题

**Q:webhook 一直 400 / 签名验证失败?**
最常见是 `STRIPE_WEBHOOK_SECRET` 配错或没配。确认它来自**你注册的那个 endpoint**的 Signing secret,且测试/真实模式没串。

**Q:点订阅报 "Billing not configured" / 503?**
`STRIPE_SECRET_KEY` 没读到。检查第 4 步是否写进 `/opt/pinzos/.env` 且部署后容器重启了。

**Q:点订阅报 "No Stripe price for plan agent"?**
`STRIPE_PRICE_AGENT` 没配,或数据库 `stripe_price_id` 为空。补第 4 或第 5 步。

**Q:测试卡哪来的?**
Stripe 官方:https://docs.stripe.com/testing —— 上面第 7 步那几张就是。

**Q:7 天试用怎么没在 Stripe 产品里设?**
不需要。代码在创建 Checkout 时自动给 Agent 加 7 天试用(`trial_period_days: 7`),且强制收卡,到期自动转扣费。

---

## 你要交给我的(汇总)

做完第 1–5 步,你手上/服务器上应该有:

- [ ] 服务器 `/opt/pinzos/.env` 里有 `STRIPE_SECRET_KEY`(`sk_test_...`)
- [ ] `STRIPE_WEBHOOK_SECRET`(`whsec_...`)
- [ ] `STRIPE_PRICE_AGENT` / `STRIPE_PRICE_FOUNDER`(`price_...`)
- [ ] webhook endpoint 已在 Stripe 后台注册并勾了 4 个事件
- [ ] (可选)数据库 price_id 已回填

然后跟我说「配好了,部署」即可。🚀
