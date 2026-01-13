# 🚀 Google Gemini API 设置指南

## 为什么选择 Gemini Flash？

### ✅ 优势
- **🆓 免费额度：** 每天 1500 次请求（对大多数使用足够）
- **⚡ 速度快：** Gemini 2.0 Flash 是最快的模型
- **📄 PDF 支持：** 原生支持 PDF 文档分析
- **🖼️ 图片分析：** 支持图片提取和分类（Phase 2）
- **🌐 易获取：** Google 账号即可，无需信用卡
- **💰 成本低：** 超过免费额度后价格也很便宜

### 📊 与 Claude 对比

| 特性 | Gemini Flash | Claude Sonnet |
|------|--------------|---------------|
| 免费额度 | ✅ 1500 req/天 | ❌ 无免费额度 |
| PDF 支持 | ✅ 原生支持 | ✅ 原生支持 |
| 图片分析 | ✅ 优秀 | ✅ 优秀 |
| 处理速度 | ⚡ 极快 | 🚀 快 |
| 成本 | 💚 低 | 💛 中等 |
| API 获取 | ✅ 简单 | ⚠️ 需信用卡 |

## 🔑 获取 API Key（2分钟）

### 步骤 1：访问 Google AI Studio
```
https://aistudio.google.com/app/apikey
```

### 步骤 2：登录 Google 账号
- 使用你的 Google 账号登录
- 无需信用卡
- 无需付费

### 步骤 3：创建 API Key
1. 点击 **"Create API Key"** 按钮
2. 选择现有项目或创建新项目
3. 复制生成的 API Key

**API Key 格式示例：**
```
AIzaSyD1234567890abcdefghijklmnopqrstuvwxy
```

### 步骤 4：配置到项目
编辑 `backend/.env` 文件：

```env
# Google Gemini API
GEMINI_API_KEY=AIzaSyD1234567890abcdefghijklmnopqrstuvwxy
```

## ✅ 验证配置

### 测试 API Key
重启后端服务，上传 PDF 时查看日志：

```bash
cd backend
npm run dev
```

**成功日志：**
```
Processing PDF with Gemini Flash...
Received response from Gemini
Successfully processed PDF: Binghatti Skyrise
Extracted unit types: 4
Extracted payment plan items: 24
```

**失败日志（会自动使用模拟数据）：**
```
GEMINI_API_KEY not found, using mock data
```

## 📊 使用限制

### 免费额度（免费层）
```
每天:     1,500 次请求
每分钟:   15 次请求
每月:     免费（永久）
```

### 对于我们的应用
- **每个 PDF 处理 = 1 次请求**
- **每天可处理 1,500 个 PDF**
- **足够大部分使用场景**

### 超出限制后
- 价格：$0.00001875 / 1000 characters（超便宜）
- 自动计费（需绑定信用卡）
- 可以设置预算限制

## 🎯 快速测试

### 1. 使用模拟数据（0 配置）
不配置 API Key，系统自动使用模拟数据：

```bash
# 不设置 GEMINI_API_KEY
cd backend
npm run dev
```

上传任意 PDF → 立即返回模拟数据

### 2. 使用真实 API（2分钟配置）
配置 API Key 后：

```bash
# 设置 GEMINI_API_KEY
cd backend
npm run dev
```

上传 PDF → Gemini 处理 → 返回真实提取的数据

## 🔧 高级配置

### 使用不同的 Gemini 模型

在 `pdf-processor-gemini.ts` 中修改：

```typescript
const model = genAI.getGenerativeModel({ 
  model: 'gemini-3-flash-preview',  // 当前使用（最快）
  // model: 'gemini-1.5-pro',      // 更高精度
  // model: 'gemini-1.5-flash',    // 平衡速度和精度
})
```

### 模型选择建议

| 模型 | 速度 | 精度 | 成本 | 推荐场景 |
|------|------|------|------|----------|
| gemini-3-flash | ⚡⚡⚡ | ⭐⭐⭐ | 💚 | **开发测试**（当前） |
| gemini-1.5-flash | ⚡⚡ | ⭐⭐⭐⭐ | 💚 | **生产环境推荐** |
| gemini-1.5-pro | ⚡ | ⭐⭐⭐⭐⭐ | 💛 | 复杂文档 |

## 🖼️ Phase 2: 图片提取功能

Gemini 还可以提取和分类 PDF 中的图片：

### 功能预览
```typescript
// 未来功能
const images = await extractImagesFromPdf(pdfBuffer)
const classified = await classifyImages(images)
// classified = {
//   showcase: ['img1.jpg', 'img2.jpg'],
//   floorplans: ['floor1.jpg', 'floor2.jpg'],
//   amenities: ['pool.jpg', 'gym.jpg']
// }
```

### 实现成本
- 图片分析：免费额度内包含
- 每张图片 ≈ 1/10 请求
- 10 张图片的 PDF ≈ 1 次完整请求

## 📝 最佳实践

### 1. 开发阶段
```env
# 使用模拟数据，快速迭代
# GEMINI_API_KEY=  # 不设置
```

### 2. 测试阶段
```env
# 使用免费 API，真实测试
GEMINI_API_KEY=your_free_api_key
```

### 3. 生产阶段
```env
# 使用付费 API，设置配额
GEMINI_API_KEY=your_production_api_key
# 设置 Google Cloud 配额限制
```

## 🛡️ 安全建议

### 保护 API Key
```bash
# ✅ 正确：使用环境变量
GEMINI_API_KEY=your_key_here

# ❌ 错误：不要硬编码在代码中
const apiKey = 'AIzaSy...'  # 危险！

# ❌ 错误：不要提交到 Git
git add .env  # 危险！确保 .env 在 .gitignore 中
```

### 限制访问
```javascript
// 在 Google Cloud Console 中限制 API Key：
// 1. IP 限制（只允许你的服务器）
// 2. API 限制（只允许 Generative AI）
// 3. 设置配额上限
```

## 🔍 故障排查

### 问题 1：API Key 无效
```
Error: Invalid API key
```

**解决方案：**
- 检查 API Key 是否正确复制
- 确认没有多余的空格
- 重新生成 API Key

### 问题 2：超出配额
```
Error: Resource exhausted
```

**解决方案：**
- 等待配额重置（每天 UTC 0:00）
- 升级到付费计划
- 使用模拟数据继续开发

### 问题 3：PDF 太大
```
Error: Request payload too large
```

**解决方案：**
- PDF 限制在 20MB 以内
- 压缩 PDF 文件
- 减少图片质量

## 📊 监控使用情况

### Google Cloud Console
访问：https://console.cloud.google.com/apis/api/generativeai.googleapis.com/quotas

查看：
- 每日请求数
- 剩余配额
- 错误率
- 响应时间

## 💡 提示和技巧

### 提高提取准确率
1. **使用高质量 PDF**
   - 文本清晰
   - 表格结构完整
   - 避免扫描件

2. **优化提示词**
   - 在 `pdf-processor-gemini.ts` 中调整 prompt
   - 添加具体示例
   - 强调关键字段

3. **多次验证**
   - 对比提取结果
   - 标记常见错误
   - 迭代改进提示词

### 节省配额
```typescript
// 缓存结果避免重复处理
const cacheKey = `pdf_${fileHash}`
const cached = await cache.get(cacheKey)
if (cached) return cached

// 处理新 PDF
const result = await processPdfWithGemini(...)
await cache.set(cacheKey, result, 3600) // 缓存 1 小时
```

## 🎉 完成！

现在你可以：
1. ✅ 免费使用 Gemini API（每天 1500 次）
2. ✅ 处理 PDF 文档
3. ✅ 提取结构化数据
4. ✅ 未来扩展图片分析

**开始使用：**
```bash
# 1. 获取 API Key
# → https://aistudio.google.com/app/apikey

# 2. 配置环境变量
echo "GEMINI_API_KEY=your_key_here" >> backend/.env

# 3. 重启服务
cd backend
npm run dev

# 4. 上传 PDF 测试
# → http://localhost:5173/developer/upload
```

## 📚 相关资源

- **Gemini API 文档：** https://ai.google.dev/docs
- **定价：** https://ai.google.dev/pricing
- **配额管理：** https://console.cloud.google.com/
- **社区支持：** https://github.com/google/generative-ai-js

---

**推荐指数：** ⭐⭐⭐⭐⭐  
**难度等级：** ⭐☆☆☆☆ (非常简单)  
**成本效益：** 💚💚💚💚💚 (免费且强大)

**准备好了吗？** 2 分钟获取 API Key，立即开始！🚀
