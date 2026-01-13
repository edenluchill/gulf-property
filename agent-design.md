# 项目说明书：AI 房地产期房文档智能解析与分析系统

## 1. 项目愿景
构建一个基于 TypeScript 和 LangGraph 的多 Agent 系统，能够自动化解析期房（Off-plan Project）PDF 文档。系统需高精度识别图片分类、提取结构化建筑数据、分析户型与财务计划，并结合市场实时数据进行升值潜力分析。

## 2. 技术栈
- **语言**: TypeScript
- **核心框架**: `@langchain/langgraph` (用于流程编排与状态管理)
- **视觉/推理模型**: 
    - **Gemini 3 flash Sonnet**: 处理复杂户型图提取、财务报表解析（精度最高）。
    - **Gemini flash**: 处理页面快速分类（成本低、速度快）。
- **PDF 处理**: `pdf-img-convert` (将 PDF 转为高分辨率图片，保持视觉一致性)。
- **图像处理**: `sharp` (用于根据坐标裁剪户型图或提取素材)。
- **数据验证**: `zod` (定义 Schema 并强制执行结构化输出)。
- **搜索工具**: `Tavily Search API` (获取周边配套及实时房价)。

## 3. 核心架构：Map-Reduce 并行处理流
系统采用 **Map-Reduce** 模式以平衡“高精度”与“处理速度”：
1.  **Ingestion Phase**: PDF 拆分为单页图片。
2.  **Map Phase (Parallel)**: 每页图片并行进入 `Page Processor` 进行分类与局部提取。
3.  **Reduce Phase**: 汇总所有页面信息，去除重复项，补全建筑整体画像。
4.  **Insight Phase**: 外部数据补全与最终报告生成。

---

## 4. Agent 角色定义

### 4.1 Manager Agent (The Orchestrator & Critic)
*   **职责**: 
    *   控制 LangGraph 流程走向。
    *   **质量校验 (Self-Reflection)**：检查提取出的数据是否完整。如果识别出的 Building Name 为空或户型图数据不符合逻辑，触发重试。
    *   汇总各并行节点的输出。

### 4.2 Visual Classifier Agent (Fast Triage)
*   **职责**: 识别页面类型。
*   **分类标签**: `Cover`, `Rendering (Photo)`, `Floor Plan`, `Payment Plan`, `Location/Map`, `General Text`.
*   **输入**: 单页图片。
*   **输出**: 类别标签 + 简要内容描述。

### 4.3 Floor Plan Auditor (Precision Extraction)
*   **职责**: 专门处理户型图页面。
*   **任务**: 
    *   提取 Unit Type (1B, 2B等), Sqft, 朝向, 阳台面积。
    *   识别图片中的文字坐标，以便后续裁剪原始高清图。
*   **工具**: Gemini 3 flash Sonnet + Zod Schema。

### 4.4 Financial Structurer (Payment Plan Analyst)
*   **职责**: 识别复杂的付款比例表格。
*   **任务**: 将文字描述（如 "20% down payment, 30% during construction, 50% on handover"）转化为标准 JSON 数组。

### 4.5 Market Intelligence Agent (External Researcher)
*   **职责**: 拿着提取出的 `Address` 和 `Building Name` 到互联网搜索。
*   **任务**: 获取周边地铁站距离、竞品楼盘最近成交价、该区域未来政府规划。

### 4.6 Creative Copywriter (Content Producer)
*   **职责**: 基于所有结构化数据，生成营销文案。
*   **任务**: 针对小红书、推特、专业投资者邮件生成不同风格的文案。

---

## 5. LangGraph 状态定义 (State Annotation)
```typescript
interface GlobalState {
  pdfPath: string;
  // 存储所有页面处理结果
  pages: {
    pageNumber: number;
    imagePath: string;
    category: string;
    extractedData: any;
  }[];
  // 汇总后的建筑对象
  buildingData: {
    name: string;
    developer: string;
    address: string;
    units: UnitDetail[];
    paymentPlans: PaymentPlan[];
  };
  // 外部市场数据
  marketContext: any;
  // 最终产出
  analysisReport: string;
  marketingContent: string;
  // 错误重试计数
  retryCount: number;
}
```

---

## 6. 关键实现逻辑

1.  **高精度保障**: 
    *   **不要 OCR 文本层**，直接将 PDF 渲染为 300DPI 图片传给多模态模型。
    *   使用 **Structured Output (zod)**。若模型返回格式错误，Manager Agent 自动捕获错误并要求模型重新解析。
2.  **并行加速**: 
    *   使用 LangGraph 的 `Send` API。在 `Splitter` 节点之后，根据页面总数动态分发 N 个并行的 `Page Processor` 任务。
    *   Node.js 的 `Promise.all` 处理图片转换。
3.  **分类图片收集**: 
    *   根据 `Visual Classifier` 的结果，将对应的图片文件重命名并移动到分类文件夹（例如：`/output/floor_plans/1B_TypeA.png`）。

---

## 7. 给 AI 的后续 Prompt 指令
> "请基于以上架构，先为我编写一个 LangGraph 的核心逻辑骨架，使用 TypeScript 定义 State 和 Graph 的节点流。请重点展示如何并行处理 PDF 的每一页，并由 Manager Agent 进行结果汇总。"