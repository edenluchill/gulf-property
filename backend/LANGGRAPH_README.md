# LangGraph Multi-Agent PDF Processor

一个基于 LangGraph 和 Gemini AI 的多 Agent 系统，用于自动化解析房地产期房（Off-plan Project）PDF 文档。

## 🎯 功能特性

### 核心能力
- **高精度文档解析**: 300 DPI 图像转换，保证视觉信息完整性
- **并行处理**: Map-Reduce 架构，支持多页面并行分析
- **智能分类**: 自动识别页面类型（户型图、付款计划、位置图等）
- **结构化输出**: Zod Schema 验证，确保数据格式一致性
- **质量校验**: 自动检测数据完整性，支持重试机制
- **市场分析**: 集成市场研究，提供投资建议
- **多平台文案**: 自动生成小红书、Twitter、投资邮件等不同风格内容

### 提取数据
- ✅ 项目名称、开发商、地址
- ✅ 户型详情（面积、卧室、浴室、朝向）
- ✅ 付款计划（分期比例、时间节点）
- ✅ 设施配套
- ✅ 项目日期（开盘、交付）
- ✅ 图片分类（封面、效果图、户型图、地图）

## 🏗️ 系统架构

### Map-Reduce 工作流

```
┌─────────────┐
│ PDF Upload  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────┐
│ Phase 1: INGESTION      │
│ - Convert PDF to images │
│ - 300 DPI high quality  │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│ Phase 2: MAP (Parallel Processing)     │
│                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────┤
│  │ Page 1   │  │ Page 2   │  │ Page N │
│  │          │  │          │  │        │
│  │ Classify │  │ Classify │  │ ...    │
│  │ Extract  │  │ Extract  │  │        │
│  └────┬─────┘  └────┬─────┘  └───┬────┘
└───────┼─────────────┼────────────┼─────┘
        │             │            │
        └─────────────┴────────────┘
                      │
                      ▼
        ┌─────────────────────────┐
        │ Phase 3: REDUCE         │
        │ - Aggregate results     │
        │ - Merge duplicate data  │
        │ - Quality validation    │
        └──────────┬──────────────┘
                   │
                   ▼
        ┌─────────────────────────┐
        │ Phase 4: INSIGHT        │
        │ - Market research       │
        │ - Investment analysis   │
        │ - Marketing content     │
        └──────────┬──────────────┘
                   │
                   ▼
           ┌───────────────┐
           │ Final Output  │
           └───────────────┘
```

## 🤖 Agent 角色

### 1. Visual Classifier Agent (视觉分类器)
- **职责**: 快速页面分类
- **模型**: Gemini Flash (成本低、速度快)
- **分类**: Cover, Rendering, FloorPlan, PaymentPlan, LocationMap, Amenities, GeneralText

### 2. Floor Plan Auditor Agent (户型图审核员)
- **职责**: 精确提取户型信息
- **模型**: Gemini 2.0 Flash
- **提取**: 户型类型、面积、卧室数、浴室数、朝向、阳台面积

### 3. Financial Structurer Agent (财务结构师)
- **职责**: 付款计划提取
- **模型**: Gemini 2.0 Flash
- **输出**: 标准化 JSON 付款时间表

### 4. Market Intelligence Agent (市场情报员)
- **职责**: 市场研究与竞品分析
- **数据**: 地铁距离、竞品项目、区域房价、政府规划

### 5. Creative Copywriter Agent (创意文案师)
- **职责**: 多平台营销内容生成
- **输出**: 
  - 小红书：情感化、生活方式向
  - Twitter：专业、数据驱动
  - 投资邮件：详细分析、ROI 关注

### 6. Manager Agent (管理协调员)
- **职责**: 质量控制与流程编排
- **功能**: 数据验证、去重、重试决策

## 📁 代码结构

```
backend/src/
├── langgraph/
│   ├── state.ts              # 全局状态定义
│   ├── nodes.ts              # 工作流节点函数
│   ├── graph.ts              # LangGraph 工作流构建
│   └── executor.ts           # 主执行入口
│
├── agents/
│   ├── visual-classifier.agent.ts
│   ├── floor-plan-auditor.agent.ts
│   ├── financial-structurer.agent.ts
│   ├── market-intelligence.agent.ts
│   ├── copywriter.agent.ts
│   └── manager.agent.ts
│
├── schemas/
│   └── property.schema.ts    # Zod 验证 Schema
│
├── utils/
│   └── pdf/
│       ├── converter.ts      # PDF 转图片
│       ├── image-processor.ts # 图片处理
│       └── file-manager.ts   # 文件管理
│
└── routes/
    └── langgraph-processor.ts # API 路由
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd backend
npm install
```

依赖包括:
- `@langchain/langgraph` - 工作流编排
- `@langchain/google-genai` - Gemini AI 集成
- `pdf-img-convert` - PDF 转图片
- `sharp` - 图片处理
- `zod` - 数据验证

### 2. 配置环境变量

在 `backend/.env` 中添加:

```env
# Gemini API Key (必需)
GEMINI_API_KEY=your_gemini_api_key_here
```

获取 API Key: https://aistudio.google.com/app/apikey

### 3. 启动服务

```bash
npm run dev
```

## 📡 API 使用

### 处理 PDF

**端点**: `POST /api/langgraph/process-pdf`

**请求**:
```bash
curl -X POST http://localhost:3001/api/langgraph/process-pdf \
  -F "file=@your-brochure.pdf" \
  -F "simplified=false"
```

**参数**:
- `file` (required): PDF 文件
- `simplified` (optional): `true` 使用简化工作流（无重试），`false` 使用完整工作流

**响应**:
```json
{
  "success": true,
  "jobId": "job_1234567890_abc123",
  "data": {
    "building": {
      "name": "Example Tower",
      "developer": "Premium Developer",
      "address": "Business Bay, Dubai",
      "units": [
        {
          "id": "unit_1bed_a",
          "name": "1 BEDROOM TYPE A",
          "bedrooms": 1,
          "bathrooms": 1,
          "area": 650,
          "price": 1800000
        }
      ],
      "paymentPlans": [...]
    },
    "market": {
      "nearbyMetroStations": [...],
      "competitorProjects": [...],
      "areaInsights": {...}
    },
    "analysis": {
      "summary": "...",
      "strengths": [...],
      "appreciationPotential": "High"
    },
    "marketing": {
      "xiaohongshu": "...",
      "twitter": "...",
      "investorEmail": "...",
      "headline": "Your Dream Home Awaits",
      "highlights": [...]
    },
    "images": {
      "cover": ["path/to/cover1.png"],
      "floorPlans": ["path/to/floorplan1.png"],
      "renderings": [...]
    }
  },
  "metadata": {
    "processingTime": 45230,
    "processingTimeSeconds": "45.23",
    "outputDirectory": "uploads/langgraph-output/job_xxx",
    "workflow": "full"
  },
  "errors": [],
  "warnings": []
}
```

### 健康检查

**端点**: `GET /api/langgraph/health`

```bash
curl http://localhost:3001/api/langgraph/health
```

**响应**:
```json
{
  "status": "ok",
  "service": "LangGraph PDF Processor",
  "ready": true,
  "config": {
    "geminiConfigured": true,
    "models": {
      "classifier": "gemini-3-flash-preview",
      "extractor": "gemini-3-flash-preview"
    }
  }
}
```

### 工作流信息

**端点**: `GET /api/langgraph/info`

```bash
curl http://localhost:3001/api/langgraph/info
```

## 💡 使用示例

### TypeScript 代码调用

```typescript
import { executePdfWorkflow } from './langgraph/executor';
import { readFileSync } from 'fs';

async function processPdf() {
  const pdfBuffer = readFileSync('./brochure.pdf');
  
  const result = await executePdfWorkflow({
    pdfBuffer,
    outputBaseDir: './output',
    simplified: false, // 使用完整工作流
  });
  
  if (result.success) {
    console.log('Project:', result.buildingData.name);
    console.log('Units:', result.buildingData.units.length);
    console.log('Processing time:', result.processingTime, 'ms');
  } else {
    console.error('Errors:', result.errors);
  }
}
```

### 前端集成示例

```typescript
async function uploadAndProcessPdf(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('simplified', 'false');
  
  const response = await fetch('http://localhost:3001/api/langgraph/process-pdf', {
    method: 'POST',
    body: formData,
  });
  
  const result = await response.json();
  
  if (result.success) {
    // 显示提取的数据
    console.log(result.data.building);
    console.log(result.data.marketing);
  }
}
```

## 🎛️ 配置选项

### 工作流模式

#### 完整工作流 (Full Workflow)
- 包含质量校验和自动重试
- 处理时间较长但准确度更高
- 推荐用于生产环境

```typescript
executePdfWorkflow({ simplified: false })
```

#### 简化工作流 (Simplified Workflow)
- 跳过重试机制
- 处理速度更快
- 适合快速预览或测试

```typescript
executePdfWorkflow({ simplified: true })
```

### 输出目录

默认输出到 `backend/uploads/langgraph-output/{jobId}/`

目录结构:
```
langgraph-output/
└── job_1234567890_abc123/
    ├── pages/              # 原始页面图片
    │   ├── page_1.png
    │   ├── page_2.png
    │   └── ...
    └── categorized/        # 分类后的图片
        ├── cover/
        ├── floorplans/
        ├── renderings/
        ├── amenities/
        └── maps/
```

## 🔧 性能优化

### 并行处理
- 所有页面同时分类和提取
- 利用 LangGraph 的 `Send` API
- 理论加速比 = 页面数

### 缓存策略
- 考虑实现页面级缓存（相同 PDF 不重复处理）
- Redis 缓存提取结果

### 批处理
- 多个 PDF 可以并行处理
- 注意 API 速率限制（Gemini: 15 RPM 免费版）

## 📊 监控与日志

### 日志级别

```typescript
// 在 nodes.ts 中自动输出：
console.log('=== INGESTION PHASE ===')
console.log('Processing page 1...')
console.log('✓ Converted 10 pages to images')
```

### 错误追踪

所有错误存储在 `result.errors` 数组中：

```typescript
if (!result.success) {
  result.errors.forEach(error => {
    console.error('Error:', error);
  });
}
```

### 警告信息

非致命问题存储在 `result.warnings`：

```typescript
result.warnings.forEach(warning => {
  console.warn('Warning:', warning);
});
```

## 🧪 测试

### 单元测试 Agent

```typescript
import { classifyPage } from './agents/visual-classifier.agent';

const classification = await classifyPage('./test-page.png', 1);
console.log(classification);
```

### 集成测试工作流

```typescript
import { testWorkflow } from './langgraph/executor';

const result = await testWorkflow('./test-brochure.pdf');
```

## 🚨 故障排查

### PDF 转换失败
- **问题**: `pdf-img-convert` 依赖 canvas，可能在 Windows 上编译失败
- **解决**: 使用 `--ignore-scripts` 安装，或使用预编译二进制包

### Gemini API 错误
- **问题**: "API key not found" 或 "Rate limit exceeded"
- **解决**: 
  - 检查 `.env` 中的 `GEMINI_API_KEY`
  - 免费版限制 15 RPM，考虑付费版或添加速率控制

### 内存不足
- **问题**: 处理大 PDF 时内存溢出
- **解决**: 
  - 增加 Node.js 堆内存: `node --max-old-space-size=4096`
  - 使用简化工作流
  - 分批处理页面

### 数据提取不准确
- **问题**: 某些字段为空或错误
- **解决**:
  - 检查 PDF 质量（是否为扫描件）
  - 调整 prompt 提示词
  - 使用完整工作流（含重试）

## 🔄 后续优化建议

### 短期 (1-2 weeks)
- [ ] 添加 Tavily Search API 集成（更准确的市场研究）
- [ ] 实现结果缓存（Redis）
- [ ] 添加进度回调（WebSocket 实时反馈）
- [ ] 支持多语言 PDF

### 中期 (1 month)
- [ ] Fine-tune Gemini 模型（针对 Dubai 房地产）
- [ ] OCR 文本层提取（补充视觉分析）
- [ ] 图片增强预处理
- [ ] 批量处理队列系统

### 长期 (3+ months)
- [ ] 自定义模型训练（户型图识别）
- [ ] 知识图谱构建（开发商、区域关系）
- [ ] 历史价格趋势分析
- [ ] AR 户型图可视化

## 📚 相关文档

- [LangGraph 官方文档](https://langchain-ai.github.io/langgraphjs/)
- [Gemini API 文档](https://ai.google.dev/docs)
- [Zod Schema 验证](https://zod.dev/)
- [设计规范](../agent-design.md)

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 📄 License

MIT License - 详见 LICENSE 文件
