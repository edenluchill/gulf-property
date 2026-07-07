# Pinzos 收款与 25% 分成方案(2026-07-07 定稿:方案 A)

## 背景

- 合伙协议(2026-06-30 定稿):FINDHOMEGO AI TECH INC.(加拿大 BC)将 Pinzos 平台授权给迪拜合伙人运营,FINDHOMEGO 获 **25% 平台收入**(防稀释)。
- 合伙人(王帅 / SHUAI WANG)提供了收款账户函:
  - 银行:National Bank of Fujairah (NBF)
  - 户名:SHUAI WANG(**个人账户**,非公司)
  - 账号:012224027751
  - IBAN:`AE310380000012224027751`
  - SWIFT:`NBFUAEAF`
  - 币种:AED(开户 2026-06-22)
- 原始诉求:客户付款先进合伙人 NBF 账户,每笔自动 25% 转入 FINDHOMEGO。

## 核实结论:逐笔自动分账在该架构下不可行

三条硬限制(2026-07-07 查 Stripe 官方文档确认):

1. **单一 Stripe 账户的 payout 只能绑定一个银行账户**(每币种一个),无法按比例分给两家银行。
2. **Stripe Connect 跨境分账两个方向都不通**:
   - 加拿大平台的 cross-border transfers 仅支持 US / UK / EEA / CA / CH 的 connected account,UAE 不在名单。
   - UAE 平台只能使用 UAE 本地的 Custom connected accounts,加拿大公司无法作为其 connected account。
   - 来源:[Cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts)、[Custom accounts](https://docs.stripe.com/connect/custom-accounts)
3. **合伙人现有账户开不了 Stripe UAE**:Stripe UAE 激活要求有效 UAE trade license(sole establishment / sole proprietorship 亦可)+ 绑定 UAE 银行 IBAN,审批 2-4 周。个人账户(无执照)不满足;且平台收入进个人账户在 UAE 有 corporate tax 合规问题,与协议主体不符。
   - 来源:[UAE account activation requirements](https://support.stripe.com/questions/uae-account-activation-requirements)、[Selecting a Business Type for a UAE account](https://support.stripe.com/questions/selecting-a-business-type-for-a-uae-account)

备注:Stripe Global Payouts 自 2026-01-28 起支持付款至 UAE 银行账户(`ae_bank_account`),未来若对加拿大平台开放,可实现「收款进 FINDHOMEGO Stripe → API 自动付 75% 至 NBF」全自动;目前作为观察项。
来源:[Global Payouts 15 new countries](https://docs.stripe.com/changelog/clover/2026-01-28/cross-border-payouts-new-countries)

## 已选定:方案 A —— 收款进 FINDHOMEGO,按月结算 75% 给合伙人

```
客户付款 (Stripe Checkout, USD)
        │
        ▼
FINDHOMEGO AI TECH INC 的 Stripe 账户(加拿大主体激活)
        │  payout
        ▼
FINDHOMEGO 加拿大银行账户(100% 入账)
        │  每月结算
        ├── 25% 留存 FINDHOMEGO(协议分成)
        └── 75% 经 Wise 付 AED → 合伙人 NBF 账户
             IBAN AE310380000012224027751 / SWIFT NBFUAEAF / SHUAI WANG
```

### 为什么选 A

- 25% 分成"先到手",不依赖对方每月主动转账。
- Stripe 报表天然构成协议要求的平台收入审计凭证。
- 现有 Stripe 集成(托管 Checkout/Portal/quota gating)零改动,只差激活切 live。
- 与协议角色一致:FINDHOMEGO 是 licensor/平台所有方。

### 代价与注意

- 跨境转账成本:Wise CAD/USD→AED 手续费+汇差(约 0.5-1%),月结一次摊薄。
- FINDHOMEGO 全额确认收入、再列 75% 为合作方成本/分成支出——**记账口径建议与加拿大会计确认**(licensing 收入 vs 代收代付)。
- 付款对象是合伙人**个人**账户:他自己的 UAE 税务责任由他承担;建议在协议附件里书面记录该收款账户,避免日后争议。

## 行动清单

1. **激活 Stripe live**(用户操作,Dashboard):主体填 FINDHOMEGO AI TECH INC(加拿大 BC),payout 绑 FINDHOMEGO 加拿大银行账户。⚠️ 主体/国家一旦激活不可改。
2. **切 live 的技术迁移**(Claude 可做):
   - live 模式需在 live 下**重新创建全部 Product/Price**(test 模式 price ID 在 live 无效),并更新 DB 中的 Stripe price 列(price ID 全落在 DB 列,见 memory map-metering-tiered-pricing)。
   - 服务器 compose(`/opt/pinzos/docker-compose.yml`)换 live secret key + live webhook signing secret(新建 live webhook endpoint)。
   - 记忆坑:新 env 变量必须手动加进服务器 compose,quick-deploy 不会带。
3. **开 Wise Business 账户**(FINDHOMEGO 名义)用于 AED 付款;首次小额测试打款到 NBF 验证到账。
4. **Admin 后台「月度分成对账单」页**(待做,已有 admin 计费/用量基础):按 Stripe 实收(扣退款/手续费口径需与合伙人书面约定:建议按 net of Stripe fees)自动算 25/75,生成双方可见对账记录,转账凭单执行。
5. **协议侧**:与合伙人确认资金流方向变更(原设想是钱进他账户);把结算周期(每月 X 日)、口径(net of processing fees)、收款账户写进补充条款或备忘。

## 未选方案存档

**方案 B(钱先进合伙人)**:他需先注册 UAE trade license → 公司名义开 Stripe UAE(审批 2-4 周)→ payout 绑公司 NBF 账户 → 每月按后台对账单转 25% 至 FINDHOMEGO。FINDHOMEGO 收款依赖对方执行;现个人账户不可用。若未来合伙人设立 UAE 主体且双方希望切换,可重议(但 Stripe 账户国家不可迁移,需另开新账户)。
