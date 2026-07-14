# 付款 checkout 500 事故 + Stripe 已切 Live — 诊断与修复方案(未部署)

**发现**:cx-guardian 第38轮巡检(2026-07-09 ~12:35Z)抓到 `/api/billing/checkout` 连续 3 次 HTTP 500,触发 HIGH_ERROR_RATE 报警(5.1%)。这是**真实客户在尝试付款订阅时被挡**。按 cx-guardian 铁律(billing/支付不自动改),此文只诊断+给方案,**未改代码、未部署**,等 owner 决定。

## 两个关键事实

### 1. ⭐ Stripe 已经切到 LIVE 模式(开始收真钱了)
服务端日志里 Stripe 响应头 `x-stripe-routing-context-priority-tier: livemode-critical`、account `acct_1TmRxcLQ2nIWAGfr`、`stripe-version: 2026-06-24.dahlia`——**live 模式**。项目 memory 里记的还是"测试模式,切 live 待用户激活"。**owner 已经激活了 live Stripe**,这是重大状态变更,后续所有 billing 判断都要按"真钱"对待。

### 2. 根因:test 模式建的 Stripe customer 在 live 模式不存在
精确报错:
```
[billing] checkout failed: StripeInvalidRequestError: No such customer: 'cus_UqvbAPGjpO7gm0'
  code: 'resource_missing', param: 'customer', statusCode: 400
```
- 客户 `admin@yesir.ai`(lt_agents.id 085b7f13…)早先在 **test 模式**创建过 Stripe customer `cus_Uqvb…`,存进了 `lt_agents.stripe_customer_id`。
- 切到 **live 模式**后,那个 customer 在 live 账户里不存在 → checkout 复用它 → `resource_missing` → 500。
- **代码没有自愈**:`ensureCustomer`(billing.ts:122-123)只要 DB 里有 `stripe_customer_id` 就直接返回,**从不校验它在当前 Stripe 账户是否存在**。
- 客户是靠**手动清空** DB 列绕过的(stripe_customer_id 现已变成新的 live customer `cus_UqzC…`,第4次 12:39 成功 200)。**手动绕过,不是代码修复——bug 仍在**。

## 影响面
- 当前只有 **1 个**经纪有 stripe_customer_id(就是撞错这个,已手动解开)。爆炸半径小。
- 但**代码 bug 仍活着**:今后任何 agent 只要 DB 里存着一个在 live 账户不存在的 customer(test 残留、或 live 里被删),首次 checkout 就会 500,直到人工清列。切 live 初期尤其危险。
- 同样隐患在 **`/portal`(billing.ts:250)**:直接用 `customerId` 建 portal session,不校验,stale 时同样炸。

## 建议修复(现成,待 owner 批准后我部署)
让 `ensureCustomer` 校验存量 customer,`resource_missing` 就重建并回写。改 billing.ts:113-135:

```ts
async function ensureCustomer(
  stripe: Stripe,
  agent: { id: string; email: string; name: string }
): Promise<string> {
  const { rows } = await pool.query<{ stripe_customer_id: string | null }>(
    `SELECT stripe_customer_id FROM lt_agents WHERE id = $1`,
    [agent.id]
  )
  const existing = rows[0]?.stripe_customer_id
  if (existing) {
    // 校验它在当前(live)账户仍存在——test→live 迁移后旧 customer 会 resource_missing,
    // 直接复用会让 checkout 500。校验失败就往下走,建一个新的并覆盖。
    try {
      const c = await stripe.customers.retrieve(existing)
      if (!(c as Stripe.DeletedCustomer).deleted) return existing
    } catch (err) {
      if ((err as Stripe.errors.StripeError)?.code !== 'resource_missing') throw err
      console.warn(`[billing] stale stripe customer ${existing} for agent ${agent.id}, recreating`)
    }
  }

  const customer = await stripe.customers.create({
    email: agent.email,
    name: agent.name,
    metadata: { lt_agent_id: agent.id },
  })
  await pool.query(`UPDATE lt_agents SET stripe_customer_id = $2 WHERE id = $1`, [
    agent.id,
    customer.id,
  ])
  return customer.id
}
```

`/portal` 也应改成走 `ensureCustomer`(而非裸读 DB 列),或加同款 resource_missing 兜底。

**风险评估**:低。只在"存量 customer 已失效"时才重建,正常路径多一次 `customers.retrieve`(~100ms)。不改价格/金额/订阅逻辑。可选:上线前先把 DB 里所有 test 模式残留的 `stripe_customer_id`(`cus_` 但在 live 不存在的)批量清空,让所有人首次 checkout 自然重建。

## 需要 owner 确认
1. **是否已正式切 live 收真钱**?若是,memory 和相关文档要更新;若只是测试 live,注意别真扣款。
2. 批准上面的 `ensureCustomer` 修复我就部署(billing 改动我不擅自动手)。
3. `admin@yesir.ai` 是真客户还是你的测试号?若真客户,其付款流程已手动解开、第4次成功,但可回访确认订阅状态。
