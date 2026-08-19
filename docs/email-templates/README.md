# 客户反馈邮件模板（HTML）

品牌壳：teal 顶条 + logo + 编号问题（第 3 条用琥珀色突出）+ 浅色回复提示条 + 页脚。
logo 直接引线上地址 `https://www.pinzos.com/icon-192.png`（已验证 200，勿改成本地路径，
邮件里加载不出来）。

## 怎么发（Gmail）

1. 用 Chrome 打开对应的 `.html` 文件（双击即可）
2. `Ctrl+A` 全选 → `Ctrl+C`
3. Gmail 里点 Compose → 正文 `Ctrl+V`
4. 把 `[Name]` 换成收件人名字，标题填文件第一行注释里的 Subject
5. 发之前自己先发一封给自己看一眼（尤其手机端）

## 文件对照

| 文件 | 发给谁 | Subject |
|---|---|---|
| `agent-trialing.html` | 经纪 · 试用中：Behyad / Rohit Achnoor / Monali Patil / 李加惠 | Thank you for using Pinzos! |
| `agent-trial-ended.html` | 经纪 · 试用已结束：Lei Zhu / lydia / Summer Tang / 13828783446 / Kermit Lee / leining988 / MM2334 | Thank you for trying Pinzos! |
| `developer.html` | 开发商：WW Grace / Jocelyn Wang / Linli Wang / Aileen Young / Olivia / Farzad Razzaghi | Thank you for using Pinzos! |
| `buyer.html` | 买家（英文）：tczhulei2001 / shuchang5681 / 澳房之吕 / 費南鹤 / Ying Hua | Thank you for using Pinzos! |
| `buyer-zh.html` | 买家（中文，QQ/163 邮箱优先用这版） | 感谢您使用 Pinzos！ |
| `unknown-role.html` | 未选角色：Nicolloyd Dinham | Thank you for trying Pinzos! |

名单和优先级见 `../reports/2026-07-29-outreach-shortlist-value-accounts.md`。

## 改文案

**别手改 `.html`** —— 它们是生成出来的。改 `build.mjs` 里的 `VARIANTS` 然后：

```bash
node docs/email-templates/build.mjs
```

## 铁律

- 正文绝不引用后台行为数据（撞了几次上限、报了几次错、从没建过 tour）——会像监视。
  那些数据只用来决定发给谁、问什么。见记忆条 `customer-outreach-email-tone`。
- 一次只发一档（先 S 档 5 人），等回信摸清话术再铺开。
