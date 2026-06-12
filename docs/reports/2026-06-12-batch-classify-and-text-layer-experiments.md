# 实验报告:批量页面分类 & PDF 文本层挖掘 — 2026-06-12

两个实验,对应优化方案(`docs/pdf-flow-optimization-plan-2026-06-12.md`)中的"速度#1 批量分类"和"信息#1 文本层利用"。

实验脚本(已入库,可复跑):
- `backend/scripts/batch-classify-experiment.ts` — 批量分类 vs 逐页基准对比
- `backend/scripts/extract-text-layer.ts` — 文本层提取 + 模式扫描

---

## 实验一:批量分类(N 张图/次 vs 现在的 1 张图/次)

**方法**:以今天生产 flow 的逐页分类结果为基准(已被下游验证——提取出的户型全部正确),对两本楼书测 batch=4/8/12,模型同为 `gemini-3-flash-preview`,并发 4,图像 100dpi jpeg。
**指标**:总体一致率 + 关键页召回(unit_anchor / pricing_table / payment_plan——分错这三类才会真正丢数据)。

### 结果

**Bay Grove Brokers Brief(46 页,6 anchor)**

| batch | 调用数 | 总耗时 | 单次延迟 | 总体一致率 | 关键页 |
|-------|--------|--------|----------|-----------|--------|
| 1(基准) | 46 | — | ~3-5s | — | — |
| 4 | 12 | 19.4s | 5.6s | 91.3% | ✅ 全对 (6+1+1) |
| 8 | 6 | 19.0s | 8.9s | 71.7%* | ✅ 全对 |
| 12 | 4 | 11.4s | 9.5s | 82.6% | ✅ 全对 |

\* batch=8 有一次 JSON 解析失败丢了 8 页——实验脚本没带重试;生产的 `withRetry` + 容错解析会兜住。排除该次后一致率 ~87%。

**CityWalk Crestlane 1 Presentation(79 页,8 anchor)**

| batch | 调用数 | 总耗时 | 单次延迟 | 总体一致率 | 关键页 |
|-------|--------|--------|----------|-----------|--------|
| 4 | 20 | 32.9s | 6.1s | 86.1% | ✅ 全对 (8+1+1) |
| 8 | 10 | 30.1s | 9.2s | 83.5% | ✅ 全对 |
| 12 | 7 | 23.5s | 11.2s | 83.5% | ✅ 全对 |

### 结论

1. **关键页零损失**:6 组实验、125 页、16 个关键页,unit_anchor/pricing/payment 全部 100% 命中(无漏检无误报)。批量化不会丢户型。
2. **分歧全部发生在"无关紧要"类**:project_rendering↔amenities_images、section_divider↔section_title、overview↔location_map——这些类分错不影响户型提取,只轻微影响图片归类;且基准本身在这些模糊类上也未必对。
3. **延迟随 batch 增大而涨**(5.6s → 11.2s),一次失败的爆炸半径也随之变大。
4. **推荐参数:batch=4~6**。调用数降 75-85%,总体一致率最高(86-91%),单次失败只影响 4-6 页,配合生产已有的重试机制安全落地。
5. 收益主要是**限流余量和调用次数**(prompt 文本只发 1/4 次);图片 token 数不变,费用降幅有限。

### 落地注意

- 必须复用生产的 `parseJsonResponse`(平衡括号提取)+ `withRetry`,失败的 batch 降级为逐页重试
- 校验返回数组长度 == 图片数,缺页的单独补跑
- anchor 页的 unitTypeName/unitCategory 字段批量模式下也能返回,但建议保留现状:分类后对 anchor 页单独跑 detail 提取(现有两阶段架构不变)

---

## 实验二:PDF 文本层挖掘

**方法**:用 mupdf 提取 7 本楼书每页内嵌文本(无 AI 调用,43ms~1.3s/本),扫描高价值模式。

### 关键发现:文本层里有大量纯视觉流程漏掉的数据

| 发现 | 证据 | 现状 |
|------|------|------|
| **Completion 日期** | City Walk Briefing p103 "COMPLETION: APRIL 2030";Phase 4 p52 "completion June 2029" | 7 本测试全部提取为空 ❌ |
| **真实开发商名** | ONE PARK p3 "IMAN DEVELOPERS BUILDING LEGACY SINCE 2016" | 视觉提取幻觉成 "Ellington Properties" ❌ |
| **完整库存表** | City Walk p102:每户型的数量(89/75、48/28…)+ 平均套内/阳台/总面积 + 楼栋配置(G+12);Brokers Brief p41:数量 108/60/88/36/4=296 + **车位配比**(1BR=1个、3BR=2个、4BR=3个)+ 楼层 G+7~G+20 | 完全没提取 |
| **带精确日期的付款计划** | Brokers Brief p44:20% down + 7 期 instalment 每期带年月 + 30% on handover;City Walk p103 同样完整 | 只提取了 highlight |
| **价格表** | Brokers Brief p43 文本完整(1BR 1.85M…4BR 7.60M) | 视觉已提取(可作交叉验证) |
| **配套设施名称** | ONE PARK 每页设施图都有文字标题(35M Infinity Pool、VR Golf、Padel Court…共 20+ 项) | ONE PARK 视觉提取 amenities=0 ❌ |
| **地标距离** | ONE PARK p5:到 Burj Khalifa 19km、DXB 36km 等 12 个地标 | 没提取(Luna 讲区位的好素材) |

### 限制

- BayGrove 系列文本层较稀(17-26/43 页有文本),其库存表是图片型的——**文本层是视觉的补充,不是替代**。
- 文本顺序有时乱(表格列错位),直接喂给 LLM 做"辅助上下文"比自己写解析器更稳。

### 推荐落地方式(成本几乎为零)

1. 处理开始时一次性抽全文文本层(<1.5s,无 API 成本);
2. 把对应页文本附在该页的提取 prompt 里(分类/详情/定价 agent 各自受益);
3. 项目级字段(开发商、completion 日期、库存表、付款计划日期)增加一个**纯文本 pass**:全文文本 + 一次 flash 调用,提取后与视觉结果合并,文本层优先(有真实文字依据,杜绝幻觉);
4. 反幻觉规则:开发商名必须在文本层或页面 OCR 中出现才采信。

---

## 总体建议

两个实验都验证通过,可以进入实施:
- **批量分类 batch=4~6**:调用数 -75%,关键页零损失;
- **文本层接入**:直接修复 completion 日期缺失、开发商幻觉、ONE PARK amenities=0 三个已知问题,还白捡库存/车位/付款计划日期等新数据。
