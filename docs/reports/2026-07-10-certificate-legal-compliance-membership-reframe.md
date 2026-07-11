# 证书 → 会员欢迎卡:合规重构（2026-07-10）

## 背景 / 触发
经纪同事看到平台颁发的 "certificate" 后提醒:迪拜房地产合规审查极严,**违规宣传或使用未经官方批准的认证头衔,罚款 AED 50,000 起**。经评估决定把"认证证书"整条链路改成"平台会员欢迎卡"。

## 风险判断（非法律意见）
迪拜房地产由 **RERA / DLD** 强监管,经纪职业头衔、认证、对外广告(Trakheesi 许可)都归其管。原证书上真正踩线的是"官方发证"口吻:

| 原文案 | 为什么危险 |
|---|---|
| DUBAI REAL ESTATE CERTIFICATION | 像迪拜官方发证机构 |
| CERTIFIED / ACCREDITED / 认证专员 | 受监管的职业头衔,平台无权颁发 |
| professional designation | 暗示执业资质,而非平台会员 |
| QR verify + 凭证编号 | 像官方登记/注册系统 |

经纪拿去发朋友圈/WhatsApp 招客 → 被客户/同行/监管视为"声称持有迪拜官方认证" → 投诉 → 罚款。

## 决策:方案 A —— 会员欢迎卡 + 欢迎页
同一张美术,措辞从"发证"改为"欢迎入驻 / 平台会员身份"。**原则:去掉 Certified/Certification/Accredited/Dubai Real Estate/professional designation/verify;换成 Welcome/Member/Partner/入驻/Member since;清楚是"我们平台的会员等级",不是职业资格。**

## 已改动（本地完成,待用户点头后部署）

### 前端
- `frontend/src/lib/roleBadge.ts`
  - `certTitle` 逐档:Pinzos Member / Pinzos Pro Member / Pinzos Agency Partner / Pinzos Developer Partner（团队成员 Pinzos Team Member / Pinzos Developer Member）
  - `titleZh/titleEn` 短 chip:经纪会员/Agent Member、经纪公司会员、开发商会员（去"认证/Certified"）
  - `subZh/subEn`:PINZOS 会员 · X / PINZOS Member · X
  - `drawCertificate` 文案:副标 AGENT PARTNER NETWORK、眉标 PINZOS PROUDLY WELCOMES、斜体 "welcomed to the Pinzos platform as a"、正文 "A valued member of…"、日期 MEMBER SINCE、QR "Scan to view · pinzos.com"
  - `sealMedal` 印章文字 CERTIFIED → MEMBER
  - 装饰:新增阿拉伯卷草花纹（`flourish`/`volute`/`scrollLeaf`/`rosette`),顶部两角对称,烫金细线
- `frontend/src/components/RoleBadgeDialog.tsx`:眉标"我的会员卡"/celebrate"欢迎入驻"、庆祝语"恭喜入驻,欢迎成为 Pinzos 会员 🎉"、下载文件名 pinzos-membership-*
- `frontend/src/components/auth/UserMenu.tsx`:菜单项"我的会员卡(分享朋友圈)"
- `frontend/src/pages/RoleSelectPage.tsx`:收集页"完善会员信息 / 会员卡署名"
- `frontend/src/pages/PricingPage.tsx`:"开发商会员卡"、"品牌盖章"
- `frontend/src/pages/VerifyPage.tsx`:整页改 Membership 口吻 + 明确免责"Membership is a platform status — not a regulatory or professional certification."

### 后端
- `backend/src/luna-tour/agent-router.ts`:`CERT_TITLES` 逐档改成 Pinzos Member 系列（与前端同源;verify 页展示用）。需 `quick-deploy.ps1 -SkipWorker` 部署。
- 注:`lt_certificates` 已有旧行 cert_title 是老头衔;弹窗打开会重新 upsert(视 ON CONFLICT 是否更新 cert_title 决定是否需回填,生产仅 3-6 行)。

## 待办 / 后续
- 用户确认卡片后:前端 push（Cloudflare 自动）+ 后端 quick-deploy。
- "欢迎页"是否要独立整屏页(解锁清单 + 进工作台),还是庆祝弹窗即可 —— 待用户定。
- 正式上线前建议 UAE 持牌顾问过一眼措辞。
