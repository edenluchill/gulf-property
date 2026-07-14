# 合伙人 75% 每周自动打款 — 设计 spec(2026-07-09)

> **⚠️ 状态(2026-07-09 定案):当前不实施本 Wise API 自动化。** 决定改为**手动每周转账 + 半年后切 Stripe Connect 原生自动分账**。原因:①给单个合伙人、过渡期仅半年,API 自动化性价比低;②Wise 沙盒不稳(service mesh 故障);③**更正**:Stripe Connect 其实能原生做 UAE 收款(境外平台建 UAE connected account + destination charges/on_behalf_of),门槛=connected account 须有 UAE trade license;合伙人合同强制 180 天内注册迪拜公司,届时可上 Connect。本 spec 存档备查,若将来 payout 对象变多再考虑重启 Wise API 方案。
> **现在做法**:开真实 Wise Business 账户,每周照分成对账页手动转 75% 至合伙人 NBF。见 [[revenue-split-settlement]]。


## 目标

Pinzos 平台收入全部进 FINDHOMEGO 的 Stripe(已 live);FINDHOMEGO 留 25%,**每周自动**把 75% 打到迪拜合伙人 SHUAI WANG 的 NBF 账户(IBAN `AE310380000012224027751`,SWIFT `NBFUAEAF`,AED)。取代当前的"每月手动 Wise 转账"。

理念(用户 2026-07-09):按时主动打款=建立信任、对合伙人公平;FINDHOMEGO 的真实杠杆是**技术/部署/支付通道控制权**(签署版合同 7.1/7.2 可在欠费/违约时暂停服务),不是"扣着对方的钱"。故自动打款不削弱任何地位。

## 为什么不能"每笔"自动、只能"每周批量"

- **Stripe Connect 跨境分账不通**:加拿大平台的 transfer 只支持 US/UK/EEA/CA/CH connected account,UAE 不在名单;合伙人也开不了 Stripe UAE(无 trade license)。所以无法在收款时自动切 75% 给他。
- **每笔转账不经济**:每笔 Wise 转账有手续费+汇差;$25/$49 的订阅逐笔切 75% 单独转,手续费吃利润,且无退款缓冲(7 天试用后退款时钱已转走,倒扣不回)。
- **每周批量**=手续费摊薄 + 留退款缓冲 + 保留资金控制,是最优解。
- 未来原生路:Stripe Global Payouts 2026-01 起支持打款到 UAE 银行(`ae_bank_account`);若将来对加拿大平台开放,可切成 Stripe 原生自动付,省掉 Wise。列为观察项。

## 架构

```
每周一 03:00 迪拜时间(定时任务,in-process 或 cron)
  1. 结算窗口 = 上一个完整 ISO 周(迪拜时区,周一~周日)
  2. 读该窗口 Stripe balance transactions 净额(扣退款+手续费)——复用 revenueShare 聚合逻辑,改成周桶
  3. owed = round(net × 0.75)
  4. 幂等检查:revenue_payouts 已有该 (week_start, currency) 行且 status in (sent, sending) → 跳过
  5. 护栏检查(见下)→ 不过则记 status=held + 告警,人工介入
  6. 若 WISE 未配置 或 DRY_RUN=on → 记 status=pending(只记账不打款)
  7. 否则 → 调 Wise API 打款 → 记 wise_transfer_id + status=sent/failed
  8. 失败 → status=failed + 告警(复用 perfMonitor 告警 / 邮件)
```

## Wise API 打款流程(每周执行一次)

1. **Recipient**(一次性,可缓存):创建收款人 = NBF 账户(accountHolderName `SHUAI WANG`,IBAN,currency AED,type iban)。
2. **Quote**:sourceCurrency(CAD 或 USD,取决于 Wise 余额币种)→ targetCurrency AED,targetAmount = 本周 owed(按 AED)或 sourceAmount(让 Wise 换)。**注意**:分成净额是 Stripe 结算币种(CAD),Wise 自动换 AED;汇率以打款时 quote 为准,台账两个币种都记。
3. **Transfer**:quote + recipient + customerTransactionId(=我们的幂等键,防重复)+ reference(如 `Pinzos week 2026-W28`)。
4. **Fund**:`POST /v3/profiles/{profile}/transfers/{id}/payments` type=BALANCE,从 Wise 余额扣款。
   - ⚠️ **SCA**:Wise 对 personal-token 的转账 funding 要求 2FA 签名——需预先注册一对公私钥(`/user-tokens` + `X-Signature`)。无人值守打款必须先登记密钥。
5. 轮询/或 webhook 确认 transfer 状态 → 回写台账。

## 安全护栏(动真钱必须全有)

- **幂等**:`revenue_payouts` 唯一约束 `(week_start, currency)`;Wise `customerTransactionId` = 稳定 UUID(由 week+currency 派生),Wise 侧也去重。
- **异常封顶**:owed > max(近 8 周均值 × 3, 绝对上限 env `PAYOUT_HARD_CAP_CENTS`)→ **不打、status=held、告警**,人工确认后手动放行。
- **最小阈值**:owed < `PAYOUT_MIN_CENTS`(如 $20)→ 跳过,累加到下周(免小额手续费)。
- **退款兜底**:某周 net 为负(退款>新收)→ owed 为负 → 不打,记 carry_cents 负数,下周结算里冲抵。
- **先空跑(dry-run)**:env `PAYOUT_DRYRUN=true` 时只算+记 pending 不真打。上线头 2~3 周先空跑,人工核对金额对上再关 dry-run。
- **告警**:失败 / held / 余额不足 → 告警(perfMonitor 告警条 + 邮件)。
- **Wise 余额监控**:打款前查余额,不足则 held + 告警(自动打款能发,但 Wise 里得有钱)。
- **完整审计**:每笔记 net/owed/汇率/wise_transfer_id/状态/时间,admin 可查、可对账。

## DB

```sql
CREATE TABLE revenue_payouts (
  id bigserial PRIMARY KEY,
  week_start date NOT NULL,            -- ISO 周一(迪拜时区)
  week_end   date NOT NULL,
  currency   text NOT NULL,           -- Stripe 结算币种(如 cad)
  net_cents  bigint NOT NULL,         -- 该周实收净额
  owed_cents bigint NOT NULL,         -- 75%(可负=退款周,走 carry)
  status text NOT NULL DEFAULT 'pending', -- pending|held|sending|sent|failed|skipped
  wise_transfer_id text,
  wise_target_ccy text,               -- 'AED'
  wise_target_amount numeric,         -- 实际到账 AED
  fx_rate numeric,
  reason text,                        -- held/failed 原因
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (week_start, currency)
);
```

## Admin 界面(分成对账 tab 扩展)

- 新增「每周打款」区:本周应付 75% + 打款台账(周/金额/状态/Wise 号),held/failed 红标可点开原因;
- held 的可"人工确认放行"按钮;dry-run 期显示"空跑中,未真打"提示。

## 分期

- **P0(现在,不需 Wise)**:写本 spec。过渡期每月手动 Wise 转账(照分成对账页数字)。
- **P1(拿到 Wise sandbox token 后)**:建 revenue_payouts 表 + 周结算计算 + admin 台账 + 定时任务骨架 + Wise 客户端(**沙盒测通**:recipient/quote/transfer/fund 全流程,含 SCA 签名)。全程 dry-run 不动真钱。
- **P2(切 live)**:换 Wise 生产 token,dry-run 空跑 2~3 周核对,关 dry-run 开真打。
- **P3(观察)**:Stripe Global Payouts 若对加拿大平台开放 UAE,评估切原生、退役 Wise。

## 用户前置清单(只有你能做,Wise 审核约几天)

1. 开 **Wise Business 账户**(FINDHOMEGO AI TECH INC 名义)。
2. 拿 **Personal API token + profile id**(business profile)。
3. **注册 2FA 公私钥**(SCA,无人值守 funding 必需)。
4. 提供**沙盒(sandbox)token** 先给我测;测通再给生产 token。
5. Wise 余额留够(从 TD 转 CAD 进 Wise,自动换 AED);或设 TD→Wise 自动补款。

## 开放问题

- Wise 源币种用 CAD(TD 提现币种)还是先换 USD?→ 用 CAD 直接换 AED,少一次换汇。
- 结算币种:Stripe 余额是 CAD(smoke 测见 CA$),故 net 以 cad 计;Wise 从 CAD 换 AED。若未来 Stripe 收 USD 客户,台账按币种分行分别打。
- 打款频率:默认每周一结上一周;可 env 调成每两周/每月。

相关:[[revenue-split-settlement]] [[stripe-billing]];分成对账实现见 `backend/src/services/revenueShare.ts` + admin `分成对账` tab;方案 A 决策见 `docs/reports/2026-07-07-stripe-revenue-split-plan.md`。
