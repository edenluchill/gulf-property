# 🖼️ 图片显示完整指南

## ✅ 图片传输方式

### Base64 嵌入式传输

```javascript
// 后端提取图片
const images = extractImagesFromPdf(pdf);

// 转换为 base64
const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;

// 通过 SSE 发送
buildingData.images = {
  projectImages: [base64_1, base64_2, ...],
  floorPlanImages: [base64_3, base64_4, ...]
}

// 前端接收并显示
<img src={base64} />  // ✅ 直接可显示！
```

---

## 🎯 前端会收到并展示

### 1. 接收过程

```typescript
// SSE 事件
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.buildingData.images) {
    // ✅ 图片数据在这里！
    console.log('收到图片:', data.buildingData.images);
    
    setFormData({
      ...prev,
      projectImages: data.buildingData.images.projectImages,  // Base64 数组
      floorPlanImages: data.buildingData.images.floorPlanImages,
    });
  }
}
```

### 2. 显示过程

```tsx
{/* 项目图片画廊 */}
{formData.projectImages?.length > 0 && (
  <div className="grid grid-cols-3 gap-3">
    {formData.projectImages.map((base64, idx) => (
      <img 
        src={base64}  // ← data:image/jpeg;base64,/9j/4AAQ...
        alt={`Project ${idx + 1}`}
      />
    ))}
  </div>
)}
```

---

## 🔍 调试步骤

### 步骤 1：检查后端是否提取到图片

上传 PDF 后，查看后端日志：
```
🖼️ Extracting images from PDF...
   ✓ Saved: image_1_page1.jpg (120.5 KB)
   ✓ Saved: image_2_page2.png (85.2 KB)
   ✓ Saved: image_3_page3.jpg (150.8 KB)
   ...
   ✅ Extracted 15 images

   📦 12 small images (will include in response)
   🏢 Project images: 6
   📐 Floor plan images: 6
```

**如果看到这个** → 提取成功 ✅

### 步骤 2：检查前端是否收到

打开浏览器 Console (F12)，应该看到：
```
📸 Images received: { projectImages: 6, floorPlanImages: 6 }
```

**如果看到这个** → 传输成功 ✅

### 步骤 3：检查图片是否显示

查看页面，应该看到：
- **项目图片画廊**：3×2 网格，6 张图片
- **户型卡片**：展开后看到户型图

**如果看到这个** → 显示成功 ✅

---

## ⚠️ 可能的问题

### 问题 1：PDF 中没有嵌入图片

**症状**：
```
Extracted 0 images
```

**原因**：
- PDF 是扫描件（图片是页面本身）
- PDF 使用了矢量图形（不是图片）

**解决**：这种情况需要 PDF → 图片转换（需要 canvas）

### 问题 2：Base64 太大导致 SSE 失败

**症状**：
- 后端提取成功
- 前端没收到数据
- SSE 连接断开

**解决**：已添加大小过滤（只发送 <200KB 的图片）

### 问题 3：图片无法显示

**症状**：
- 前端收到数据
- `<img>` 显示不出来

**解决**：检查 base64 格式
```javascript
// 正确格式
"data:image/jpeg;base64,/9j/4AAQ..."

// 错误格式
"/9j/4AAQ..."  // 缺少前缀
```

---

## 🧪 测试指南

### 完整测试流程

```bash
# 1. 重启后端
cd backend
npm run dev

# 2. 打开浏览器 Console
F12 → Console 标签

# 3. 访问页面
http://localhost:5173/developer/upload

# 4. 上传 PDF
选择文件 → 点击"AI 智能提取"

# 5. 观察后端日志
应该看到:
  ✓ Extracted XX images
  📦 XX small images
  🏢 Project images: XX

# 6. 观察前端 Console
应该看到:
  📸 Images received: {...}

# 7. 查看页面
应该显示图片画廊
```

---

## 💡 优化方案（如果图片太多/太大）

### 方案 A：只发送缩略图

```typescript
// 后端压缩图片
import sharp from 'sharp';

const thumbnail = await sharp(imageBuffer)
  .resize(400, 400, { fit: 'inside' })
  .jpeg({ quality: 60 })
  .toBuffer();

const base64 = thumbnail.toString('base64');
```

### 方案 B：保存到服务器 + 发送 URL

```typescript
// 后端保存图片
const imageUrl = `/api/images/${jobId}/image_${index}.jpg`;
writeFileSync(`uploads/images/${jobId}/image_${index}.jpg`, buffer);

// 发送 URL
buildingData.images = {
  projectImages: [
    'http://localhost:3000/api/images/job123/img1.jpg',
    ...
  ]
}

// 前端使用 URL
<img src={imageUrl} />
```

---

## 🎯 当前策略（已优化）

```typescript
// 只发送小图片（<200KB）
const smallImages = images.filter(img => img.size < 200KB);

// 前 6 张作为项目图片
projectImages: smallImages.slice(0, 6)

// 第 7-16 张作为户型图
floorPlanImages: smallImages.slice(6, 16)
```

**效果**：
- 大约 10-15 张图片
- 每张 < 200KB
- 总共 ~2-3MB base64 数据
- SSE 可以传输 ✅

---

## 🚀 现在测试

**刷新页面并重新上传**

你应该看到：

1. **后端日志**：
   ```
   ✓ Extracted 15 images
   📦 12 small images
   🏢 Project images: 6
   ```

2. **前端 Console**：
   ```
   📸 Images received: { projectImages: 6, floorPlanImages: 6 }
   ```

3. **页面显示**：
   ```
   📸 项目图片 (6)
   [图1] [图2] [图3]
   [图4] [图5] [图6]
   ```

---

**图片应该能显示了！如果还是没有，查看 Console 的调试信息！** 📸✨
