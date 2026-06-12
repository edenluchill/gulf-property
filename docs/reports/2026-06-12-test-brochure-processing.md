# 楼书处理 Pipeline 测试报告 — 2026-06-12

测试对象:`C:\Users\lzp65\Desktop\pinzos项目` 下全部 7 个楼书 PDF,走完整 langgraph 提取流水线(含本轮新增的 AI 重试、大小写归一合并、最终修复兜底)。

测试工具:`backend/scripts/test-pdf-processing.ts`(本轮新增,可复用):

```bash
cd backend && npx ts-node --transpile-only scripts/test-pdf-processing.ts "<pdf路径>"
```

## 结果总览:6/7 通过

| # | PDF | 户型 | SUBMITTABLE | 备注 |
|---|-----|------|-------------|------|
| 1 | City Walk Crestlane Project Briefing.pdf (214MB) | 7/7 完整 | ✅ YES | 80s |
| 2 | CityWalk Crestlane 1 Presentation.pdf | 8/8 完整 | ✅ YES | 29s |
| 3 | Bay Grove Residences Brokers Brief.pdf | 6/6 完整 | ✅ YES | 21s |
| 4 | Project Briefing Bay Grove Phase 4.pdf | 6/6 完整 | ✅ YES | Penthouse 缺价格(不阻塞提交) |
| 5 | BayGrove Project Briefing.pdf | 5/5 完整 | ✅ YES | 26s |
| 6 | BayGrove Residences Phase 3 Project Briefing.pdf | 5/5 完整 | ✅ YES | 77s |
| 7 | ONE PARK CENTRAL BROCHURE 2.pdf | 0 | ❌ NO | 见下 |

所有通过的 PDF:每个户型 bed/bath/area/price 齐全,项目名、开发商、地址、坐标、描述全部提取成功,上传后可立刻 submit。

## ONE PARK CENTRAL 失败原因(非 pipeline bug)

- 该 PDF 是**纯营销画册**:44 页全是效果图(卧室/泳池/楼体)、amenities 照片和品牌页,**没有任何平面图、户型规格或价格页**(已人工抽查页面图像确认)。
- 分类器 44 页零失败,0 anchor 页是正确判断。没有户型数据 → 按规则不可提交。
- **处置**:这本楼书无法单独成项目,需要补充含户型/价格的资料(比如对应的 "BROCHURE 1" 或 fact sheet)一起上传。

### 发现的真实 bug:开发商提取幻觉

提取结果为 `Developer: Ellington Properties`,但封底明确是 "ONE PARK CENTRAL **BY IMAN**"(实际开发商 Iman Developers)。AI 在没有明确开发商信息页时产生了幻觉。建议后续在 project-info 提取 prompt 中要求"开发商必须有页面文字依据,否则留空"。

## 本轮代码改动(未提交,工作区)

1. `backend/src/langgraph/utils/ai-retry.ts`(新增)— `withRetry` 通用重试 + 结果校验
2. 三个 agent(page-classifier / pricing-extractor / unit-detail-extractor)接入重试
3. `merge-units.ts` + `batch-processor.ts` — 户型名/类别大小写归一,防重复户型
4. `batch-processor.ts` — `repairIncompleteUnits` 三级修复兜底(sibling specs → 重提取 → 确定性推断)
5. `result-recorder.ts` — summary 报告新增 "🚦 SUBMIT READINESS" 一节
6. `json-parser.ts` — `extractFirstJsonObject` 平衡括号解析
7. `backend/scripts/test-pdf-processing.ts` + `render-pdf-pages.ts`(新增测试工具)

## 待办

- [ ] commit 本轮改动
- [ ] 部署 worker:`.\hetzner-deploy-worker.ps1`(生产 PDF 处理跑在 Pinzos-worker-1,未部署前线上仍是旧逻辑)
- [ ] (可选)修开发商幻觉问题
- [ ] (可选)ONE PARK CENTRAL 找含户型数据的资料补传
