# 付款计划:上传后可编辑 + 支持「每月 X%」分期

**日期**：2026-07-25
**状态**：设计已定，待实现（Task 4）

## 问题
- `components/developer-upload/PaymentPlanSection.tsx` 是**只读展示**组件(百分比条 + 每
  milestone 一行),没有任何增删改控件。它虽被 `property-editor/PropertyEditorForm.tsx`
  引用,但编辑页里付款计划**看得到、改不了** → 这就是「上传后没法编辑 paymentplan」。
- 缺「每月 1%」这种迪拜常见的**递延分期**(建造期 1%/月 × N 月)。

## 已定设计(owner 拍板:折叠成一行)
「每月 X%」在买家项目页折叠成**一行**:`1%/月 × 40月  40%  建造期`,不展开成 40 行。

### 数据模型(milestone 加一个字段)
现有 `PaymentMilestone { milestone, percentage, date?, intervalMonths?, intervalDescription? }`
新增 **`monthlyCount?: number`**:
- 有值 = 递延分期行,含义「`percentage`% 每月 × `monthlyCount` 个月」,
  对总额贡献 = `percentage * monthlyCount`;`intervalMonths` = 起始月偏移。
- 无值 = 普通单次里程碑(现状,不变)。

### 合计计算(改所有算 total 的地方)
`sum( m.monthlyCount ? m.percentage * m.monthlyCount : m.percentage )`,仍要 ≈100%。

## 要改的文件(实现清单)
1. **milestone 类型**:`components/developer-upload/PaymentPlanSection.tsx` 里的 interface +
   `components/property-editor/types.ts`(若也定义)+ 后端 `SubmitProjectRequest`/
   `transformPaymentPlanToJson`(已支持 intervalMonths,补 monthlyCount 透传)。
2. **PaymentPlanSection 改成可编辑**:增删行 + 每行改 名称/百分比/时机;
   一个「按月分期」开关 → 露出「每月百分比 + 月数 + 起始月」三个输入,生成/编辑一条
   recurring 行。合计实时校验 100%。**方便 admin** = 加行默认值合理、可拖动排序可选。
3. **展示位全部认识 recurring 行**(否则买家看到错的):
   - 项目详情页付款计划展示(找 `paymentPlan` 消费处)
   - 报价单 / SalesOfferDialog(payplan-share)
   - 客户报告 / 分享报告 里若印付款计划
   → 统一一个 `formatMilestone(m)`:recurring 显示「{percentage}%/月 × {monthlyCount}月」,
     百分比列显示该行**总贡献** `percentage*monthlyCount`%。
4. **后端 PUT/submit 已能存** `payment_plan` JSONB —— 只要前端把 monthlyCount 一起传即可,
   `transformPaymentPlanToJson` 补一行透传 monthlyCount。

## 验收
- 编辑现有项目 → 加一条「1%/月 × 40月」+ 订金 20% + 尾款 40% → 合计 100% 绿;
- 保存后重开编辑页,recurring 行还在、可改;
- 买家项目页/报价单显示「1%/月 × 40月 = 40%」,不是「1%」;
- 三档截图验证编辑器。
