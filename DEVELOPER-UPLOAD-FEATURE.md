# Developer Property Upload Feature

## 概述

这个功能允许开发商通过上传 PDF 文档来提交他们的期房项目。系统使用 AI（Claude API）自动从 PDF 中提取所有相关信息，包括：

- 项目基本信息（名称、开发商、地址等）
- 价格和面积范围
- 户型详细信息（Studio, 1BR, 2BR, 3BR 等）
- 付款计划
- 项目图片分类（展示图、户型图、设施图）

## 文件结构

### 前端文件

```
frontend/src/
├── pages/
│   ├── MapPage2.tsx                    # MapPage 的克隆版本
│   └── DeveloperPropertyUploadPage.tsx # 新的开发商上传页面
├── components/
│   └── Header.tsx                       # 更新了导航链接
└── App.tsx                              # 添加了新路由
```

### 后端文件

```
backend/src/
├── routes/
│   └── developer.ts                     # 开发商 API 路由
├── services/
│   └── pdf-processor.ts                 # AI PDF 处理服务
├── db/
│   ├── developer-submissions-schema.sql # 数据库表结构
│   └── migrate-developer-submissions.ts # 迁移脚本
└── index.ts                             # 添加了新路由
```

## 数据库架构

### 主表：developer_property_submissions
存储开发商提交的物业基本信息

**字段：**
- `project_name` - 项目名称
- `developer` - 开发商名称
- `address` - 地址
- `latitude`, `longitude` - 坐标
- `min_price`, `max_price` - 价格范围（AED）
- `min_area`, `max_area` - 面积范围（平方英尺）
- `min_bedrooms`, `max_bedrooms` - 卧室数量范围
- `launch_date`, `completion_date` - 项目时间线
- `description` - 项目描述
- `amenities` - 设施列表（数组）
- `showcase_images`, `floorplan_images`, `amenity_images` - 分类图片
- `status` - 状态（pending, approved, rejected）

### 子表：developer_submission_unit_types
存储不同户型的详细信息（一对多）

**字段：**
- `submission_id` - 关联主表
- `name` - 户型名称（Studio, 1 Bedroom, 2 Bedroom 等）
- `min_area`, `max_area` - 面积范围
- `min_price`, `max_price` - 价格范围
- `bedrooms` - 卧室数量
- `bathrooms` - 浴室数量

### 子表：developer_submission_payment_plans
存储付款计划（一对多）

**字段：**
- `submission_id` - 关联主表
- `milestone` - 付款里程碑（如 "Down Payment", "December 2024"）
- `percentage` - 付款百分比
- `payment_date` - 付款日期（可选）
- `sequence_order` - 排序顺序

## 设置步骤

### 1. 数据库迁移

运行迁移脚本创建新表：

```bash
cd backend
npx ts-node src/db/migrate-developer-submissions.ts
```

### 2. 配置 AI API Key

在 `backend/.env` 文件中添加 Anthropic API Key：

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

获取 API Key：https://console.anthropic.com/

**注意：** 如果没有配置 API Key，系统会自动使用模拟数据进行测试。

### 3. 安装依赖

后端依赖已自动安装：
- `multer` - 文件上传处理
- `@types/multer` - TypeScript 类型定义
- `@anthropic-ai/sdk` - Claude AI SDK

### 4. 启动服务

```bash
# 后端
cd backend
npm run dev

# 前端
cd frontend
npm run dev
```

## 使用流程

### 开发商端使用流程

1. **访问上传页面**
   - 导航到 `/developer/upload` 路径
   - 或从 Header 点击 "For Developers"

2. **上传 PDF**
   - 点击上传区域或拖拽 PDF 文件
   - 支持的文件：PDF 格式，最大 50MB

3. **AI 处理**
   - 点击 "Extract Data with AI" 按钮
   - 等待 AI 分析 PDF 内容（通常 10-30 秒）
   - AI 会自动提取所有字段

4. **审核和编辑**
   - 检查 AI 提取的数据
   - 填写任何缺失的信息
   - 编辑或添加户型信息
   - 调整付款计划

5. **提交**
   - 点击 "Submit Property" 按钮
   - 数据保存到数据库
   - 状态为 "pending" 等待审核

### AI 提取的数据示例

根据你提供的 Binghatti Skyrise PDF，AI 能提取：

**基本信息：**
- 项目名称：Binghatti Skyrise
- 开发商：Binghatti
- 地址：Business Bay, Dubai

**户型信息：**
```json
[
  {
    "name": "STUDIO",
    "minArea": 422,
    "maxArea": 477,
    "bedrooms": 0
  },
  {
    "name": "1 BEDROOM",
    "minArea": 762,
    "maxArea": 1022,
    "bedrooms": 1
  },
  {
    "name": "2 BEDROOM",
    "minArea": 1277,
    "maxArea": 1667,
    "bedrooms": 2
  },
  {
    "name": "3 BEDROOM",
    "minArea": 1839,
    "maxArea": 1991,
    "bedrooms": 3
  }
]
```

**付款计划：**
```json
[
  {
    "milestone": "DOWN PAYMENT",
    "percentage": 20,
    "date": "2025-11-01"
  },
  {
    "milestone": "DECEMBER 2024",
    "percentage": 2
  },
  // ... 更多里程碑
  {
    "milestone": "ON COMPLETION",
    "percentage": 30,
    "date": "2026-12-31"
  }
]
```

## API 端点

### POST /api/developer/process-pdf
上传 PDF 并提取数据

**请求：**
- Content-Type: `multipart/form-data`
- Body: `pdf` (file)

**响应：**
```json
{
  "projectName": "Binghatti Skyrise",
  "developer": "Binghatti",
  "address": "Business Bay, Dubai",
  "minPrice": 1200000,
  "maxPrice": 3500000,
  "unitTypes": [...],
  "paymentPlan": [...],
  ...
}
```

### POST /api/developer/submit-property
提交物业到数据库

**请求体：**
```json
{
  "projectName": "string",
  "developer": "string",
  "address": "string",
  "latitude": number,
  "longitude": number,
  "minPrice": number,
  "maxPrice": number,
  "minArea": number,
  "maxArea": number,
  "minBedrooms": number,
  "maxBedrooms": number,
  "launchDate": "YYYY-MM-DD",
  "completionDate": "YYYY-MM-DD",
  "description": "string",
  "amenities": ["string"],
  "unitTypes": [...],
  "paymentPlan": [...],
  "images": {
    "showcase": ["url"],
    "floorplans": ["url"],
    "amenities": ["url"]
  }
}
```

**响应：**
```json
{
  "success": true,
  "submissionId": "uuid",
  "message": "Property submitted successfully"
}
```

### GET /api/developer/submissions
获取所有提交（管理员用）

**查询参数：**
- `status` - pending/approved/rejected
- `limit` - 分页限制（默认 50）
- `offset` - 分页偏移（默认 0）

### GET /api/developer/submissions/:id
获取单个提交详情

### PATCH /api/developer/submissions/:id/status
更新提交状态（管理员用）

**请求体：**
```json
{
  "status": "approved", // or "rejected"
  "rejectionReason": "optional reason",
  "reviewedBy": "admin_name"
}
```

## AI 提示词工程

PDF 处理使用了精心设计的提示词，指导 AI：

1. **识别所有户型** - Studio, 1BR, 2BR, 3BR, Penthouse 等
2. **提取表格数据** - 从表格中提取面积和价格范围
3. **解析付款计划** - 保留原始里程碑名称
4. **单位转换** - 自动转换所有面积为平方英尺
5. **日期格式化** - 统一为 ISO 8601 格式
6. **处理缺失数据** - 未找到的字段返回 null

## 测试

### 使用模拟数据测试
如果没有 API Key，系统会自动使用模拟数据：

```typescript
// 模拟数据包含：
- 4 种户型（Studio, 1BR, 2BR, 3BR）
- 完整的付款计划
- 典型的迪拜项目信息
```

### 使用真实 PDF 测试
1. 上传你的 Binghatti Skyrise PDF
2. 等待 AI 处理
3. 检查提取的数据准确性
4. 调整任何不准确的信息
5. 提交到数据库

## 路由和导航

### 新增路由

```
/map2                  - MapPage 的克隆版本（用于后续修改）
/developer/upload      - 新的开发商上传页面
/developer/submit      - 原有的简单提交表单（保留）
```

### Header 导航

```
Map Explore    -> /map
Map 2          -> /map2
Favorites      -> /favorites
For Developers -> /developer/submit
```

你可以手动访问 `/developer/upload` 来使用新的 AI 驱动的上传功能。

## 后续改进建议

1. **图片提取** - 从 PDF 中提取图片（需要 pdf-lib 或 pdfjs-dist）
2. **坐标自动填充** - 使用 Google Maps Geocoding API 自动获取经纬度
3. **审核工作流** - 创建管理员审核界面
4. **自动发布** - 审核通过后自动同步到 `off_plan_properties` 表
5. **PDF 预览** - 在上传前预览 PDF 内容
6. **批量上传** - 支持一次上传多个 PDF
7. **进度追踪** - 显示 AI 处理进度
8. **错误恢复** - 保存草稿，处理失败后可恢复

## 注意事项

⚠️ **重要提示：**

1. **API 成本** - Anthropic Claude API 按 token 计费，大型 PDF 可能产生较高费用
2. **处理时间** - 复杂 PDF 可能需要 30-60 秒处理
3. **准确性** - AI 提取不是 100% 准确，需要人工审核
4. **文件大小** - 建议 PDF 小于 20MB 以获得最佳性能
5. **语言支持** - 当前优化为英文和阿拉伯语混合的迪拜地产文档

## 故障排查

### 问题：AI 处理失败
**解决方案：**
- 检查 `.env` 中的 `ANTHROPIC_API_KEY` 是否正确
- 查看后端控制台错误日志
- 尝试使用较小的 PDF 文件

### 问题：提取的数据不准确
**解决方案：**
- 手动编辑不正确的字段
- PDF 格式可能与预期不同，需要调整 AI 提示词

### 问题：数据库错误
**解决方案：**
- 确保已运行迁移脚本
- 检查数据库连接配置
- 查看 PostgreSQL 日志

## 联系和支持

如有问题，请检查：
1. 后端日志：`npm run dev` 的控制台输出
2. 前端日志：浏览器开发者工具 Console
3. 数据库日志：PostgreSQL 错误日志

---

**创建日期：** 2025-01-09
**版本：** 1.0.0
**作者：** Gulf Property Development Team
