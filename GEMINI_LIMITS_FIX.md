# 🔧 Gemini API 限制问题解决

## 问题诊断

从日志看到两个错误：

### 错误 1: JSON 解析失败
```
Failed to parse Gemini response
Error: AI response was not valid JSON
```
**原因**：文件太大（40MB），Gemini 返回了错误格式或被截断

### 错误 2: 400 Bad Request
```
Request contains an invalid argument
```
**原因**：第二个文件 77MB 超过 Gemini API 限制

---

## ⚠️ Gemini API 限制

| 限制项 | 值 |
|--------|-----|
| 单文件大小 | **~20MB** |
| 总 Token 数 | ~2M tokens |
| PDF 页数建议 | < 100 页 |

你的文件：
- 文件 1: **39.6MB** ❌ 超限
- 文件 2: **77.7MB** ❌ 超限

---

## ✅ 解决方案

### 1. 文件大小检查（已添加）

后端现在会自动检查：
```typescript
if (fileSize > 20MB) {
  return {
    error: "文档太大 (XXX MB)。请使用小于 20MB 的文件"
  };
}
```

### 2. PDF 分割建议

**选项 A：压缩 PDF**
```bash
# 使用在线工具
https://www.ilovepdf.com/compress_pdf

# 或使用 Ghostscript
gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 \
   -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH \
   -sOutputFile=output.pdf input.pdf
```

**选项 B：分割 PDF**
```bash
# 分成多个小文件
- FloorPlans-Part1.pdf (15MB)
- FloorPlans-Part2.pdf (15MB)  
- FloorPlans-Part3.pdf (10MB)

# 然后一起上传，系统会自动合并！
```

**选项 C：只上传关键页面**
- 提取封面、户型图、付款计划页面
- 忽略高分辨率效果图
- 控制在 20MB 以内

### 3. 使用更小的测试文件

先测试基本功能：
```bash
# 找一个小 PDF (< 5MB)
- 简单楼盘宣传册
- 单页户型图
- 付款计划表
```

---

## 🎯 推荐工作流

### 对于大型 PDF

```
原始文件: Edit-at-d3-Full.pdf (80MB, 150 pages)
            ↓
         分割成:
            ├─ Part1-Overview.pdf (8MB, 30 pages)
            ├─ Part2-FloorPlans.pdf (15MB, 50 pages)
            ├─ Part3-Amenities.pdf (12MB, 40 pages)
            └─ Part4-Payment.pdf (3MB, 10 pages)
            ↓
    上传所有 4 个文件到系统
            ↓
    AI 自动合并分析所有内容
            ↓
         ✅ 完整数据
```

### 对于标准 PDF

```
标准楼盘手册.pdf (10MB, 20 pages)
            ↓
      直接上传（无需分割）
            ↓
         AI 提取
            ↓
         ✅ 完成
```

---

## 🔧 已添加的保护措施

### 1. 文件大小检查
```typescript
// 后端自动检查每个文件
if (fileSize > 20MB) {
  return error with clear message
}
```

### 2. 友好的错误提示
```typescript
错误: "文档 2 太大 (77.69 MB)。
      Gemini 限制单文件 20MB。
      请分割 PDF 或使用更小的文件。"
```

### 3. 降级处理
```typescript
// 如果 JSON 解析失败，返回默认值而不是崩溃
if (parseError) {
  return {
    name: "Error extracting",
    units: [],
    // ... 用户可以手动填写
  };
}
```

---

## 🧪 测试建议

### 立即可测试（小文件）

1. 找一个 < 5MB 的 PDF
2. 上传测试基本功能
3. 验证：
   - 多选文件功能
   - 实时进度
   - 表单填充
   - 户型分组

### 处理你的大文件

**方案 A：压缩**
- 使用 https://www.ilovepdf.com/compress_pdf
- 目标：压缩到 15-20MB

**方案 B：提取关键页面**
- 只保留重要页面（户型图、付款计划）
- 删除高清效果图

**方案 C：使用文档摘要**
- 先手动整理关键信息到简单 PDF
- 后续再优化

---

## 🎯 快速测试步骤

### 1. 准备小 PDF
找一个 < 10MB 的楼盘 PDF

### 2. 测试多选功能
```
1. 点击上传按钮
2. 按住 Ctrl (Windows) 或 Cmd (Mac)
3. 点击选择多个文件
4. 看到所有文件添加到列表
5. 点击"AI 智能提取"
```

### 3. 观察效果
- ✨ 表单滑入
- 📊 进度更新
- 📝 数据填充
- 🏠 户型分组显示

---

## 💡 临时解决方案

如果文件太大，现在可以：

1. **手动填写表单**（不用 AI）
2. **压缩 PDF**后再上传
3. **提取关键页面**做成小 PDF

---

**现在试试小一点的 PDF，验证多选功能和其他特性！** 🚀