# 5.6(e) 代码副本购买(合伙关系不变)条款 —— 成稿(2026-07-05)

**场景**:乙方不动甲方的 25% 股权与 25% 平台费,只想单独购买一份可部署平台代码副本(自运营/技术安全感)。现行协议无此路径(副本只出现在 7.3 托管释放、5.6(c) 全额买断、9.3(f) 散伙买断)。

**核心风险**:25% 费的真实保障是甲方控制基础设施(Stripe/root/7.2 停服)。副本交出+乙方自运营后,执行只剩审计与诉讼——所以本条的设计重心是把付费从"靠自觉"换成"靠机制"(自动分账 + 许可以付费为条件)。

**谈判提示**:若乙方只要安全感,先推 7.3 源码托管(免费得多);本条保持"须双方同意"(甲方有拒绝权),别做成乙方单方权利。

**甲方底线**:①须双方同意;②价格下限(别让它变成绕开 5.6(c) 5–7× 买断的后门);③交易时自动分账 25% 为强制条件;④欠费 30 天→副本许可终止;⑤明写 5.1(e) 递减不适用+6.1/6.4 义务中止。

---

## English — insert as 5.6(e)

> **(e) Code-Copy Purchase — Partnership Continuing (by mutual agreement).** The Parties may at any time agree — each in its sole discretion — that the Company purchase a perpetual, non-exclusive, non-transferable right to a deployable copy of the then-current Platform, for the Company's own business within the Territory, while the partnership otherwise continues unchanged: Party A retains its equity (5.2) and the Platform Fee continues at 25% of Gross Revenue (5.1), re-characterised, to the extent the Company operates its own copy, as a continuing **licence royalty** for the Platform IP. In that case: (i) **Price.** A one-time technology-transfer payment agreed by the Parties, being no less than the greater of **US$[300,000]** and **[1.5]× the trailing-12-month Platform Fee** — this pays for the copy only, not for Party A's equity or fee stream, which continue unaffected; (ii) **Conditional licence.** The copy right is conditional on continued payment of the Platform Fee and compliance with 6.3: the Company shall continue to process all Platform revenue through the authorised digital payment gateway with **automatic settlement of Party A's 25% at the point of transaction** where technically feasible; Party A's audit right under 5.5 increases to **twice per year**, including access to payment-processor reports; (iii) **Non-payment.** Failure to pay the Platform Fee, uncured within **30 days** of written notice, **terminates the copy licence** (with injunctive relief available), without affecting Party A's other rights; (iv) **Service hand-back.** While the Company operates its own copy, Party A's obligations under 6.1 and 6.4 are suspended (no uptime or development duty), and **Section 5.1(e) (fee step-down on abandonment) does not apply** — the Company's election to self-operate is not an Abandonment; access to Party A's ongoing updates may be agreed as continuing services on 5.6(d) terms; (v) **Restrictions.** Section 2.4 continues to apply; the copy is for the Company's own business within the Territory only, with no sub-licence, sale or transfer, and all Platform IP remains Party A's.

## 中文 —— 作为 5.6(e) 插入

> **(e) 代码副本购买——合伙关系不变(须双方同意):** 双方可随时约定(各自有完全的自主决定权),由公司购买一份对当时版本平台的**永久、非独家、不可转让**的可部署副本使用权,仅供公司在区域内自身业务使用,合伙关系其余一切不变:甲方保留其股权(5.2),平台费按毛收入 25% 继续支付(5.1);在公司自行运营副本的范围内,该费重新定性为对平台知识产权的持续**授权使用费**。此时:(i) **价格:** 双方约定的一次性技术转让费,不低于 **[30 万美元]** 与 **[1.5]× 过去 12 个月平台费** 中的较高者——该价款仅购买副本,不涉及甲方的股权与费权,二者不受影响地继续存在;(ii) **附条件许可:** 副本使用权以持续支付平台费并遵守 6.3 为条件:公司应继续将全部平台收入通过指定数字支付通道处理,并在技术可行时**于交易发生时自动向甲方分账 25%**;甲方依 5.5 的审计权提高为**每年两次**,并可查阅支付通道原始报表;(iii) **欠费后果:** 未支付平台费、经书面通知 **30 天**仍未纠正的,**副本许可终止**(甲方可申请禁令救济),且不影响甲方其他权利;(iv) **服务交接:** 公司自行运营副本期间,甲方在 6.1 与 6.4 项下的义务中止(无可用率与开发义务),且 **5.1(e)(弃管费率递减)不适用**——公司选择自运营不构成弃管;公司如需甲方的持续更新,可按 5.6(d) 条款另行约定持续服务;(v) **限制:** 2.4 继续适用;副本仅限公司在区域内自身业务使用,不得转授权、出售或转让,平台全部知识产权仍归甲方。

---

## 加入后的完整选择树(给乙方讲的版本)
| 乙方诉求 | 条款 | 代价 |
|---|---|---|
| 怕甲方出事,要安全感 | 7.3 源码托管 | 托管年费(最便宜) |
| 要副本自己运营,关系不变 | **5.6(e)(新)** | 一次性副本费 + 25% 照付(自动分账) |
| 彻底独立、摆脱 25% | 5.6(c) 全额买断 | 5–7× 年费 + 股权 FMV |
| 买断后仍要甲方维护 | 5.6(d)(新) | 服务费 ~10%(见另一文档) |

## 待定数字
- 价格下限 `US$[300,000]`:锚定平台重置成本(约 US$200k)+溢价;别低于重置成本。
- 倍数 `[1.5]×`:防收入做大后副本变相白菜价;可谈区间 1–2×。
